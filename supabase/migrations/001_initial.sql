-- Roxanne V0.1 — permanent relationship memory.
create extension if not exists pgcrypto;

create type public.meeting_status as enum ('upcoming', 'processing', 'ready', 'failed');
create type public.meeting_source as enum ('manual', 'calendar', 'hardware', 'upload', 'agora');
create type public.follow_up_status as enum ('pending', 'approved', 'completed', 'failed');
create type public.action_status as enum ('proposed', 'approved', 'executing', 'completed', 'failed');

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text not null,
  name text,
  timezone text not null default 'Asia/Kuala_Lumpur',
  locale text not null default 'en' check (locale in ('en', 'ms', 'zh-CN', 'yue', 'ta')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.contacts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  name text not null,
  company text,
  role text,
  email text,
  phone text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.recordings (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  device_id uuid,
  storage_path text,
  duration_seconds integer,
  language text,
  status text not null default 'uploading' check (status in ('uploading', 'processing', 'ready', 'failed')),
  error_message text,
  provider_status jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.meetings (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  calendar_event_id text,
  client_reference text,
  title text not null,
  start_at timestamptz not null,
  end_at timestamptz not null,
  status public.meeting_status not null default 'upcoming',
  source public.meeting_source not null default 'manual',
  recording_id uuid references public.recordings(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.meeting_contacts (
  meeting_id uuid not null references public.meetings(id) on delete cascade,
  contact_id uuid not null references public.contacts(id) on delete cascade,
  is_primary boolean not null default false,
  primary key (meeting_id, contact_id)
);

create table public.transcripts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  recording_id uuid not null unique references public.recordings(id) on delete cascade,
  text text not null,
  segments jsonb not null default '[]'::jsonb,
  language_data jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table public.meeting_insights (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  meeting_id uuid not null unique references public.meetings(id) on delete cascade,
  meeting_type text,
  intent text,
  interest_level text check (interest_level in ('low', 'medium', 'high', 'unknown')),
  wants text,
  concern text,
  promised text,
  next_action text,
  key_points jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now()
);

create table public.commitments (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  meeting_id uuid not null references public.meetings(id) on delete cascade,
  owner_type text not null check (owner_type in ('user', 'contact')),
  description text not null,
  due_at timestamptz,
  status text not null default 'open' check (status in ('open', 'completed')),
  created_at timestamptz not null default now()
);

create table public.follow_ups (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  meeting_id uuid not null references public.meetings(id) on delete cascade,
  contact_id uuid references public.contacts(id) on delete set null,
  type text not null,
  description text not null,
  draft text,
  due_at timestamptz,
  status public.follow_up_status not null default 'pending',
  created_at timestamptz not null default now(),
  completed_at timestamptz
);

create table public.actions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  meeting_id uuid references public.meetings(id) on delete set null,
  follow_up_id uuid references public.follow_ups(id) on delete set null,
  type text not null,
  provider text not null,
  payload jsonb not null default '{}'::jsonb,
  status public.action_status not null default 'proposed',
  idempotency_key text not null unique,
  approved_at timestamptz,
  executed_at timestamptz,
  external_id text,
  error_message text,
  created_at timestamptz not null default now()
);

create table public.devices (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  name text not null,
  firmware_version text,
  last_seen_at timestamptz,
  status text not null default 'offline',
  created_at timestamptz not null default now()
);

create table public.provider_connections (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  provider text not null,
  encrypted_credentials text not null,
  expires_at timestamptz,
  scopes text[] not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, provider)
);

-- Read only by the single persistent Baileys worker over its private Postgres URL.
create table public.roxanne_whatsapp_auth (
  workspace_key text not null,
  data_key text not null,
  data_value text not null,
  updated_at timestamptz not null default now(),
  primary key (workspace_key, data_key)
);

create table public.whatsapp_delivery_keys (
  workspace_key text not null,
  idempotency_key text not null,
  provider_message_id text,
  created_at timestamptz not null default now(),
  primary key (workspace_key, idempotency_key)
);

create index contacts_user_id_idx on public.contacts(user_id);
create index meetings_user_start_idx on public.meetings(user_id, start_at);
create unique index meetings_user_client_reference_idx on public.meetings(user_id, client_reference);
create index follow_ups_user_due_idx on public.follow_ups(user_id, due_at);
create index recordings_user_created_idx on public.recordings(user_id, created_at desc);

alter table public.profiles enable row level security;
alter table public.contacts enable row level security;
alter table public.recordings enable row level security;
alter table public.meetings enable row level security;
alter table public.meeting_contacts enable row level security;
alter table public.transcripts enable row level security;
alter table public.meeting_insights enable row level security;
alter table public.commitments enable row level security;
alter table public.follow_ups enable row level security;
alter table public.actions enable row level security;
alter table public.devices enable row level security;
alter table public.provider_connections enable row level security;
alter table public.roxanne_whatsapp_auth enable row level security;
alter table public.whatsapp_delivery_keys enable row level security;

-- V0.1 is deliberately single-owner. App middleware is the first boundary;
-- these email checks keep the public Supabase API owner-only as well.
create policy "own profile" on public.profiles for all
using (id = auth.uid() and lower(coalesce(auth.jwt()->>'email', '')) = 'nathanhor2001@gmail.com')
with check (id = auth.uid() and lower(coalesce(auth.jwt()->>'email', '')) = 'nathanhor2001@gmail.com');

do $$
declare table_name text;
begin
  foreach table_name in array array['contacts','recordings','meetings','transcripts','meeting_insights','commitments','follow_ups','actions','devices']
  loop
    execute format(
      'create policy "own %1$s" on public.%1$I for all using (user_id = auth.uid() and lower(coalesce(auth.jwt()->>''email'', '''')) = ''nathanhor2001@gmail.com'') with check (user_id = auth.uid() and lower(coalesce(auth.jwt()->>''email'', '''')) = ''nathanhor2001@gmail.com'')',
      table_name
    );
  end loop;
end $$;

create policy "own meeting contacts" on public.meeting_contacts for all
using (
  lower(coalesce(auth.jwt()->>'email', '')) = 'nathanhor2001@gmail.com'
  and exists (select 1 from public.meetings m where m.id = meeting_id and m.user_id = auth.uid())
)
with check (
  lower(coalesce(auth.jwt()->>'email', '')) = 'nathanhor2001@gmail.com'
  and exists (select 1 from public.meetings m where m.id = meeting_id and m.user_id = auth.uid())
);

create policy "own provider connections" on public.provider_connections for all
using (user_id = auth.uid() and lower(coalesce(auth.jwt()->>'email', '')) = 'nathanhor2001@gmail.com')
with check (user_id = auth.uid() and lower(coalesce(auth.jwt()->>'email', '')) = 'nathanhor2001@gmail.com');

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('recordings', 'recordings', false, 26214400, array['audio/mpeg','audio/mp4','audio/x-m4a','audio/wav','audio/webm','audio/ogg'])
on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

create policy "users upload own recordings" on storage.objects for insert to authenticated
with check (
  bucket_id = 'recordings'
  and (storage.foldername(name))[1] = auth.uid()::text
  and lower(coalesce(auth.jwt()->>'email', '')) = 'nathanhor2001@gmail.com'
);
create policy "users read own recordings" on storage.objects for select to authenticated
using (
  bucket_id = 'recordings'
  and (storage.foldername(name))[1] = auth.uid()::text
  and lower(coalesce(auth.jwt()->>'email', '')) = 'nathanhor2001@gmail.com'
);
create policy "users delete own recordings" on storage.objects for delete to authenticated
using (
  bucket_id = 'recordings'
  and (storage.foldername(name))[1] = auth.uid()::text
  and lower(coalesce(auth.jwt()->>'email', '')) = 'nathanhor2001@gmail.com'
);

create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if lower(coalesce(new.email, '')) <> 'nathanhor2001@gmail.com' then
    return new;
  end if;
  insert into public.profiles (id, email, name)
  values (new.id, coalesce(new.email, ''), coalesce(new.raw_user_meta_data->>'full_name', new.raw_user_meta_data->>'name'))
  on conflict (id) do nothing;
  return new;
end;
$$;

create trigger on_auth_user_created after insert on auth.users
for each row execute procedure public.handle_new_user();
