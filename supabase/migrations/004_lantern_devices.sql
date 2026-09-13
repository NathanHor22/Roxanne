-- Standalone Lantern pairing and telemetry. External providers are not involved.
begin;

alter table public.devices
  add column if not exists hardware_id text,
  add column if not exists model text,
  add column if not exists credential_hash text,
  add column if not exists paired_at timestamptz,
  add column if not exists revoked_at timestamptz,
  add column if not exists device_state text not null default 'connecting',
  add column if not exists state_version bigint not null default 0,
  add column if not exists battery_level smallint,
  add column if not exists network_type text,
  add column if not exists free_heap_bytes integer,
  add column if not exists last_error text,
  add column if not exists updated_at timestamptz not null default now();

create unique index if not exists devices_hardware_id_idx
  on public.devices (hardware_id)
  where hardware_id is not null;

do $$
begin
  if not exists (
    select 1 from pg_constraint
     where conname = 'devices_lantern_state_valid'
       and conrelid = 'public.devices'::regclass
  ) then
    alter table public.devices add constraint devices_lantern_state_valid check (
      device_state in (
        'connecting', 'ready', 'awaiting_recording_consent', 'recording',
        'paused', 'offline_buffering', 'finalising', 'processing',
        'report_ready', 'oath_listening', 'status_report',
        'awaiting_action_confirmation', 'pending_dashboard_approval', 'error'
      )
    );
  end if;
  if not exists (
    select 1 from pg_constraint
     where conname = 'devices_battery_level_valid'
       and conrelid = 'public.devices'::regclass
  ) then
    alter table public.devices add constraint devices_battery_level_valid
      check (battery_level is null or battery_level between 0 and 100);
  end if;
  if not exists (
    select 1 from pg_constraint
     where conname = 'devices_network_type_valid'
       and conrelid = 'public.devices'::regclass
  ) then
    alter table public.devices add constraint devices_network_type_valid
      check (network_type is null or network_type in ('wifi', 'cellular', 'offline'));
  end if;
end
$$;

create table if not exists public.device_pairings (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  code_hash text not null unique,
  device_name text not null,
  expires_at timestamptz not null,
  claimed_at timestamptz,
  claimed_device_id uuid references public.devices(id) on delete set null,
  created_at timestamptz not null default now(),
  check (char_length(code_hash) = 64),
  check (expires_at > created_at)
);

create index if not exists device_pairings_user_created_idx
  on public.device_pairings (user_id, created_at desc);
create index if not exists device_pairings_expiry_idx
  on public.device_pairings (expires_at)
  where claimed_at is null;

alter table public.device_pairings enable row level security;

drop policy if exists "own device pairings" on public.device_pairings;
create policy "own device pairings" on public.device_pairings for all
using (
  user_id = auth.uid()
  and lower(coalesce(auth.jwt()->>'email', '')) = 'nathanhor2001@gmail.com'
)
with check (
  user_id = auth.uid()
  and lower(coalesce(auth.jwt()->>'email', '')) = 'nathanhor2001@gmail.com'
);

create or replace function public.claim_lantern_pairing(
  p_code_hash text,
  p_device_id uuid,
  p_hardware_id text,
  p_model text,
  p_firmware_version text,
  p_credential_hash text
)
returns table(device_id uuid, owner_id uuid, device_name text)
language plpgsql
security definer
set search_path = public
as $$
declare
  pairing public.device_pairings%rowtype;
  existing public.devices%rowtype;
  claimed public.devices%rowtype;
begin
  select * into pairing
    from public.device_pairings
   where code_hash = p_code_hash
     and claimed_at is null
     and expires_at > now()
   for update;

  if not found then
    return;
  end if;

  select * into existing
    from public.devices
   where hardware_id = p_hardware_id
   for update;

  if found and existing.user_id <> pairing.user_id then
    raise exception 'Lantern hardware is already paired to another owner';
  end if;

  if found then
    if existing.revoked_at is null and existing.credential_hash is not null then
      raise exception 'Lantern hardware is already paired; revoke it before pairing again';
    end if;

    update public.lantern_sessions
       set ended_at = coalesce(ended_at, now()), updated_at = now()
     where device_id = existing.id and ended_at is null;

    update public.devices
       set name = pairing.device_name,
           model = p_model,
           firmware_version = p_firmware_version,
           credential_hash = p_credential_hash,
           paired_at = now(),
           revoked_at = null,
           status = 'online',
           device_state = 'ready',
           state_version = 0,
           last_error = null,
           last_seen_at = now(),
           updated_at = now()
     where id = existing.id
     returning * into claimed;
  else
    insert into public.devices (
      id, user_id, name, hardware_id, model, firmware_version,
      credential_hash, paired_at, status, device_state, last_seen_at
    ) values (
      p_device_id, pairing.user_id, pairing.device_name, p_hardware_id,
      p_model, p_firmware_version, p_credential_hash, now(), 'online', 'ready', now()
    ) returning * into claimed;
  end if;

  update public.device_pairings
     set claimed_at = now(), claimed_device_id = claimed.id
   where id = pairing.id;

  return query select claimed.id, claimed.user_id, claimed.name;
end;
$$;

revoke all on function public.claim_lantern_pairing(text, uuid, text, text, text, text)
  from public, anon, authenticated;
grant execute on function public.claim_lantern_pairing(text, uuid, text, text, text, text)
  to service_role;

create table if not exists public.lantern_sessions (
  id uuid primary key,
  user_id uuid not null references public.profiles(id) on delete cascade,
  device_id uuid not null references public.devices(id) on delete cascade,
  mode text not null check (mode in ('quick', 'status')),
  state text not null,
  state_version bigint not null default 0,
  machine jsonb not null,
  started_at timestamptz not null,
  ended_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists lantern_one_open_session_per_device
  on public.lantern_sessions (device_id)
  where ended_at is null;
create index if not exists lantern_sessions_user_started_idx
  on public.lantern_sessions (user_id, started_at desc);

create table if not exists public.lantern_device_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  device_id uuid not null references public.devices(id) on delete cascade,
  session_id uuid not null references public.lantern_sessions(id) on delete cascade,
  event_id uuid not null,
  event_type text not null,
  state_version bigint not null,
  machine jsonb not null,
  created_at timestamptz not null default now(),
  unique (device_id, event_id)
);

create index if not exists lantern_events_session_created_idx
  on public.lantern_device_events (session_id, created_at);

alter table public.lantern_sessions enable row level security;
alter table public.lantern_device_events enable row level security;

drop policy if exists "own lantern sessions" on public.lantern_sessions;
create policy "own lantern sessions" on public.lantern_sessions for all
using (
  user_id = auth.uid()
  and lower(coalesce(auth.jwt()->>'email', '')) = 'nathanhor2001@gmail.com'
)
with check (
  user_id = auth.uid()
  and lower(coalesce(auth.jwt()->>'email', '')) = 'nathanhor2001@gmail.com'
);

drop policy if exists "own lantern device events" on public.lantern_device_events;
create policy "own lantern device events" on public.lantern_device_events for all
using (
  user_id = auth.uid()
  and lower(coalesce(auth.jwt()->>'email', '')) = 'nathanhor2001@gmail.com'
)
with check (
  user_id = auth.uid()
  and lower(coalesce(auth.jwt()->>'email', '')) = 'nathanhor2001@gmail.com'
);

create or replace function public.start_lantern_session(
  p_session_id uuid,
  p_user_id uuid,
  p_device_id uuid,
  p_mode text,
  p_state text,
  p_state_version bigint,
  p_machine jsonb,
  p_event_id uuid,
  p_event_type text,
  p_started_at timestamptz
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.lantern_sessions (
    id, user_id, device_id, mode, state, state_version, machine, started_at
  ) values (
    p_session_id, p_user_id, p_device_id, p_mode, p_state,
    p_state_version, p_machine, p_started_at
  );

  insert into public.lantern_device_events (
    user_id, device_id, session_id, event_id, event_type, state_version, machine
  ) values (
    p_user_id, p_device_id, p_session_id, p_event_id, p_event_type,
    p_state_version, p_machine
  );

  update public.devices
     set device_state = p_state,
         state_version = p_state_version,
         last_seen_at = p_started_at,
         status = 'online',
         updated_at = p_started_at
   where id = p_device_id
     and user_id = p_user_id
     and revoked_at is null;

  if not found then
    raise exception 'Lantern device is unavailable';
  end if;
end;
$$;

create or replace function public.apply_lantern_transition(
  p_session_id uuid,
  p_user_id uuid,
  p_device_id uuid,
  p_expected_version bigint,
  p_state text,
  p_state_version bigint,
  p_machine jsonb,
  p_event_id uuid,
  p_event_type text,
  p_ended_at timestamptz
)
returns table(applied boolean, duplicate boolean, stored_machine jsonb)
language plpgsql
security definer
set search_path = public
as $$
declare
  previous_machine jsonb;
  changed integer;
begin
  select e.machine into previous_machine
    from public.lantern_device_events e
   where e.device_id = p_device_id and e.event_id = p_event_id;
  if found then
    return query select true, true, previous_machine;
    return;
  end if;

  update public.lantern_sessions
     set state = p_state,
         state_version = p_state_version,
         machine = p_machine,
         ended_at = p_ended_at,
         updated_at = now()
   where id = p_session_id
     and user_id = p_user_id
     and device_id = p_device_id
     and state_version = p_expected_version
     and ended_at is null;
  get diagnostics changed = row_count;
  if changed = 0 then
    return query select false, false, null::jsonb;
    return;
  end if;

  insert into public.lantern_device_events (
    user_id, device_id, session_id, event_id, event_type, state_version, machine
  ) values (
    p_user_id, p_device_id, p_session_id, p_event_id, p_event_type,
    p_state_version, p_machine
  );

  update public.devices
     set device_state = p_state,
         state_version = p_state_version,
         last_seen_at = now(),
         status = 'online',
         last_error = p_machine->>'lastError',
         updated_at = now()
   where id = p_device_id
     and user_id = p_user_id
     and revoked_at is null;

  if not found then
    raise exception 'Lantern device is unavailable';
  end if;

  return query select true, false, p_machine;
end;
$$;

revoke all on function public.start_lantern_session(uuid, uuid, uuid, text, text, bigint, jsonb, uuid, text, timestamptz)
  from public, anon, authenticated;
revoke all on function public.apply_lantern_transition(uuid, uuid, uuid, bigint, text, bigint, jsonb, uuid, text, timestamptz)
  from public, anon, authenticated;
grant execute on function public.start_lantern_session(uuid, uuid, uuid, text, text, bigint, jsonb, uuid, text, timestamptz)
  to service_role;
grant execute on function public.apply_lantern_transition(uuid, uuid, uuid, bigint, text, bigint, jsonb, uuid, text, timestamptz)
  to service_role;

-- Make newly added device tables, columns, and RPCs visible to PostgREST as
-- soon as this transaction commits in hosted Supabase.
notify pgrst, 'reload schema';

commit;
