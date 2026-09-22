begin;
-- Short-lived, owner/device-scoped snapshots keep ordinals stable during playback.
create table if not exists public.device_report_sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  device_id uuid not null references public.devices(id) on delete cascade,
  state jsonb not null,
  expires_at timestamptz not null default now() + interval '2 hours'
);
alter table public.device_report_sessions enable row level security;
revoke all on public.device_report_sessions from anon, authenticated;
grant all on public.device_report_sessions to service_role;
create index if not exists device_report_sessions_expiry on public.device_report_sessions(expires_at);
notify pgrst, 'reload schema';
commit;
