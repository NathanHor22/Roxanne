-- Net-new event relationship proposals produced by Lantern Relay.
begin;

create table if not exists public.relay_matches (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  pair_key text not null check (pair_key ~ '^[a-f0-9]{64}$'),
  primary_conversation_ref text not null,
  secondary_conversation_ref text not null,
  check (primary_conversation_ref <> secondary_conversation_ref),
  snapshot jsonb not null check (jsonb_typeof(snapshot) = 'object'),
  status text not null default 'pending'
    check (status in ('pending', 'dismissed', 'scheduled')),
  provider text not null default 'openai' check (provider = 'openai'),
  model text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, pair_key)
);

create index if not exists relay_matches_user_status_created_idx
  on public.relay_matches (user_id, status, created_at desc);

alter table public.relay_matches enable row level security;

drop policy if exists "own relay matches" on public.relay_matches;
create policy "own relay matches" on public.relay_matches for all
using (user_id = auth.uid())
with check (user_id = auth.uid());

commit;
