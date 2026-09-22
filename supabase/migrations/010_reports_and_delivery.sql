begin;
alter table public.lantern_sessions add column if not exists recording_started_at timestamptz;

create table public.device_reports (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  device_id uuid not null references public.devices(id) on delete cascade,
  pages jsonb not null,
  review_token uuid,
  expires_at timestamptz not null default now()+interval '2 hours'
);
create table public.device_voice_prompts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  device_id uuid not null references public.devices(id) on delete cascade,
  kind text not null check (kind in ('review','calendar','email_draft','email_send','skip')),
  remaining_ids jsonb not null default '[]',
  payload jsonb not null default '{}',
  status text not null default 'pending' check(status in ('pending','executing','completed','failed')),
  result jsonb,
  expires_at timestamptz not null default now()+interval '2 hours'
);
create table public.meeting_delivery_preferences (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  enabled boolean not null default false,
  phone text not null,
  approved_at timestamptz not null default now()
);
create table public.meeting_deliveries (
  id uuid primary key default gen_random_uuid(),
  meeting_id uuid not null references public.meetings(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  phone text not null,
  kind text not null check(kind in ('self','client')),
  payload jsonb not null,
  state text not null default 'queued' check(state in ('queued','running','sent','failed')),
  attempts integer not null default 0,
  lease_token uuid,
  lease_until timestamptz,
  available_at timestamptz not null default now(),
  last_error text,
  sent_at timestamptz,
  approved_at timestamptz not null default now(),
  unique(user_id,meeting_id,phone)
);
alter table public.device_reports enable row level security;
alter table public.device_voice_prompts enable row level security;
alter table public.meeting_delivery_preferences enable row level security;
alter table public.meeting_deliveries enable row level security;
revoke all on public.device_reports,public.device_voice_prompts,public.meeting_delivery_preferences,public.meeting_deliveries from anon,authenticated;
grant all on public.device_reports,public.device_voice_prompts,public.meeting_delivery_preferences,public.meeting_deliveries to service_role;

-- Commit the opted-in owner's outbox entry atomically with the ready meeting.
-- WhatsApp/network failures cannot roll back or downgrade the completed report.
-- Only future completions are queued; enabling delivery does not share history.
create function public.queue_completed_meeting_delivery() returns trigger
language plpgsql security definer set search_path=public as $$
begin
  if new.status='ready' and (tg_op='INSERT' or old.status is distinct from 'ready') then
    insert into public.meeting_deliveries(meeting_id,user_id,phone,kind,payload)
      select new.id,new.user_id,p.phone,'self','{}'::jsonb
      from public.meeting_delivery_preferences p where p.user_id=new.user_id and p.enabled
      on conflict(user_id,meeting_id,phone) do nothing;
  end if;
  return new;
end $$;
revoke all on function public.queue_completed_meeting_delivery() from public,anon,authenticated;
create trigger meeting_ready_delivery after insert or update of status on public.meetings
  for each row execute function public.queue_completed_meeting_delivery();

create function public.claim_meeting_delivery() returns setof public.meeting_deliveries
language plpgsql security definer set search_path=public as $$
begin
  return query with candidate as (
    select d.id from public.meeting_deliveries d
    left join public.meeting_delivery_preferences p on p.user_id=d.user_id
    where (d.kind='client' or p.enabled) and
      ((d.state='queued' and d.available_at<=now()) or (d.state='running' and d.lease_until<now()))
    order by d.available_at for update of d skip locked limit 1
  ) update public.meeting_deliveries d set state='running', attempts=d.attempts+1,
    lease_token=gen_random_uuid(), lease_until=now()+interval '6 minutes'
    from candidate c where d.id=c.id returning d.*;
end $$;
revoke all on function public.claim_meeting_delivery() from public,anon,authenticated;
grant execute on function public.claim_meeting_delivery() to service_role;
create unique index actions_one_email_per_follow_up on public.actions(user_id,follow_up_id)
  where type='send_email' and follow_up_id is not null;
notify pgrst,'reload schema';
commit;
