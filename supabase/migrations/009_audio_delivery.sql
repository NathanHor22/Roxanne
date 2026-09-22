begin;

alter table public.lantern_sessions
  add column if not exists processing_stage text,
  add column if not exists upload_bytes bigint not null default 0,
  add column if not exists upload_total_bytes bigint not null default 0,
  add column if not exists final_transcription jsonb;
alter table public.lantern_sessions add column if not exists recording_started_at timestamptz;

-- These tables contain upload capabilities and worker leases. Only server code
-- can read/write them; dashboard notifications use the owner-scoped sessions.
create table public.lantern_audio_uploads (
  session_id uuid primary key references public.lantern_sessions(id) on delete cascade,
  event_id uuid not null,
  storage_path text not null unique,
  total_bytes bigint not null check (total_bytes > 44 and total_bytes <= 26214400),
  sha256 text not null check (sha256 ~ '^[0-9a-f]{64}$'),
  upload_url text,
  url_created_at timestamptz,
  created_at timestamptz not null default now()
);
alter table public.lantern_audio_uploads enable row level security;
revoke all on public.lantern_audio_uploads from anon, authenticated;
grant all on public.lantern_audio_uploads to service_role;

create table public.lantern_processing_jobs (
  session_id uuid primary key references public.lantern_sessions(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  state text not null default 'queued' check (state in ('queued','running','ready','failed')),
  attempts integer not null default 0,
  available_at timestamptz not null default now(),
  lease_token uuid,
  lease_until timestamptz,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.lantern_processing_jobs enable row level security;
revoke all on public.lantern_processing_jobs from anon, authenticated;
grant all on public.lantern_processing_jobs to service_role;
create index lantern_processing_pending on public.lantern_processing_jobs (available_at)
  where state in ('queued','running');

create function public.attach_lantern_direct_audio(p_session_id uuid, p_user_id uuid, p_device_id uuid)
returns uuid language plpgsql security definer set search_path = public as $$
declare s public.lantern_sessions; u public.lantern_audio_uploads;
begin
  select * into s from public.lantern_sessions where id=p_session_id
    and user_id=p_user_id and device_id=p_device_id for update;
  if not found then raise exception 'Session not found'; end if;
  select * into strict u from public.lantern_audio_uploads where session_id=s.id;
  if s.recording_id is not null then
    if s.audio_event_id is distinct from u.event_id then raise exception 'Different audio already attached'; end if;
    return s.recording_id;
  end if;
  if s.state <> 'finalising' then raise exception 'Recording must be stopped'; end if;
  insert into public.recordings(id,user_id,device_id,storage_path,duration_seconds,status,provider_status)
    values(u.event_id,s.user_id,s.device_id,u.storage_path,
      ceil((u.total_bytes-44)::numeric/32000),'processing',
      jsonb_build_object('archive','device-sd-wav-tus','bytes',u.total_bytes,'sha256',u.sha256));
  update public.lantern_sessions set recording_id=u.event_id, audio_event_id=u.event_id,
    audio_received_at=now(), upload_bytes=u.total_bytes, processing_error=null,
    processing_stage='queued', updated_at=now() where id=s.id;
  return u.event_id;
end $$;

-- Queue acceptance and freeing the physical device are one transaction. A
-- background job must never transition the device: it may already be recording
-- a newer conversation by the time AI finishes the older one.
create function public.enqueue_lantern_processing(p_session_id uuid, p_user_id uuid,
  p_device_id uuid, p_event_id uuid, p_expected_version bigint, p_machine jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare s public.lantern_sessions; t record;
begin
  select * into s from public.lantern_sessions where id=p_session_id
    and user_id=p_user_id and device_id=p_device_id for update;
  if not found or s.recording_id is null then raise exception 'Recording is not archived'; end if;
  if s.ended_at is not null then
    if s.completion_event_id = p_event_id then return s.machine; end if;
    raise exception 'Session already completed';
  end if;
  if s.state not in ('finalising','processing') or s.state_version <> p_expected_version then
    raise exception 'Session state changed';
  end if;
  if p_machine->>'state' <> 'ready' or (p_machine->>'version')::bigint <> s.state_version+1 then
    raise exception 'Invalid queue transition';
  end if;
  insert into public.lantern_processing_jobs(session_id,user_id) values(s.id,s.user_id)
    on conflict (session_id) do nothing;
  update public.lantern_sessions set recording_started_at=coalesce(recording_started_at,
    (s.machine->>'recordingStartedAt')::timestamptz,s.started_at) where id=s.id;
  select * into t from public.apply_lantern_transition(s.id,s.user_id,s.device_id,
    s.state_version,'ready',s.state_version+1,p_machine,p_event_id,'PROCESSING_QUEUED',now());
  if not t.applied then raise exception 'Session state changed'; end if;
  update public.lantern_sessions set completion_event_id=p_event_id,
    processing_stage='queued', processing_error=null where id=s.id;
  return p_machine;
end $$;

create function public.claim_lantern_processing(p_user_id uuid default null, p_session_id uuid default null)
returns setof public.lantern_processing_jobs
language plpgsql security definer set search_path = public as $$
begin
  return query with candidate as (
    select j.session_id from public.lantern_processing_jobs j
      where (p_user_id is null or j.user_id=p_user_id)
        and (p_session_id is null or j.session_id=p_session_id)
        and ((j.state='queued' and j.available_at<=now()) or
          (j.state='running' and j.lease_until<now()))
      order by j.available_at for update skip locked limit 1
  ) update public.lantern_processing_jobs j set state='running', attempts=j.attempts+1,
    lease_token=gen_random_uuid(), lease_until=now()+interval '6 minutes', updated_at=now()
    from candidate c where j.session_id=c.session_id returning j.*;
end $$;

revoke all on function public.attach_lantern_direct_audio(uuid,uuid,uuid) from public,anon,authenticated;
revoke all on function public.enqueue_lantern_processing(uuid,uuid,uuid,uuid,bigint,jsonb) from public,anon,authenticated;
revoke all on function public.claim_lantern_processing(uuid,uuid) from public,anon,authenticated;
grant execute on function public.attach_lantern_direct_audio(uuid,uuid,uuid) to service_role;
grant execute on function public.enqueue_lantern_processing(uuid,uuid,uuid,uuid,bigint,jsonb) to service_role;
grant execute on function public.claim_lantern_processing(uuid,uuid) to service_role;

create function public.retry_lantern_processing(p_recording_id uuid,p_user_id uuid)
returns uuid language plpgsql security definer set search_path=public as $$
declare s public.lantern_sessions; j public.lantern_processing_jobs;
begin
  select * into s from public.lantern_sessions where recording_id=p_recording_id
    and user_id=p_user_id and ended_at is not null for update;
  if not found then raise exception 'Archived session not found'; end if;
  if exists(select 1 from public.meetings where id=s.meeting_id and status='ready') then return null; end if;
  select * into j from public.lantern_processing_jobs where session_id=s.id for update;
  if found and j.state <> 'failed' then return null; end if;
  insert into public.lantern_processing_jobs(session_id,user_id) values(s.id,s.user_id)
    on conflict(session_id) do update set state='queued',attempts=0,available_at=now(),
      lease_token=null,lease_until=null,last_error=null,updated_at=now();
  update public.lantern_sessions set processing_stage='queued',processing_error=null where id=s.id;
  update public.meetings set status='processing' where id=s.meeting_id and user_id=s.user_id and status='failed';
  return s.id;
end $$;
revoke all on function public.retry_lantern_processing(uuid,uuid) from public,anon,authenticated;
grant execute on function public.retry_lantern_processing(uuid,uuid) to service_role;

do $$ begin
  if exists(select 1 from pg_publication where pubname='supabase_realtime') then
    if not exists(select 1 from pg_publication_tables where pubname='supabase_realtime'
      and schemaname='public' and tablename='lantern_sessions') then
      alter publication supabase_realtime add table public.lantern_sessions;
    end if;
  end if;
end $$;
notify pgrst, 'reload schema';
commit;
