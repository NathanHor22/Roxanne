begin;

-- The device emits 1.92 MB/minute at 16 kHz mono PCM. This archive ceiling
-- accommodates roughly 140 minutes while OpenAI requests are split separately.
update storage.buckets
set file_size_limit = 268435456
where id = 'recordings';

alter table public.lantern_audio_uploads
  drop constraint if exists lantern_audio_uploads_total_bytes_check;
alter table public.lantern_audio_uploads
  add constraint lantern_audio_uploads_total_bytes_check
  check (total_bytes > 44 and total_bytes <= 268435456);
alter table public.lantern_audio_uploads
  add column if not exists verified_at timestamptz;

alter table public.recordings
  add column if not exists audio_quality jsonb not null default '{}'::jsonb;

alter table public.meeting_insights
  add column if not exists executive_summary text,
  add column if not exists deal_stage text not null default 'unknown'
    check (deal_stage in ('discovery','evaluation','proposal','negotiation','closed_won','closed_lost','unknown')),
  add column if not exists risks jsonb not null default '[]'::jsonb,
  add column if not exists open_questions jsonb not null default '[]'::jsonb;

create table if not exists public.meeting_evidence (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  meeting_id uuid not null references public.meetings(id) on delete cascade,
  category text not null check (category in (
    'need','decision','commitment','objection','budget','timeline','stakeholder',
    'competitor','follow_up','product','company','open_question','context'
  )),
  statement text not null,
  speaker text,
  start_seconds numeric,
  end_seconds numeric,
  quote text not null,
  confidence numeric not null check (confidence >= 0 and confidence <= 1),
  importance integer not null check (importance between 1 and 5),
  source_kind text not null default 'conversation' check (source_kind in ('conversation','research')),
  created_at timestamptz not null default now(),
  check (start_seconds is null or start_seconds >= 0),
  check (end_seconds is null or end_seconds >= coalesce(start_seconds, 0))
);
create index if not exists meeting_evidence_meeting_idx
  on public.meeting_evidence(meeting_id, importance desc);
alter table public.meeting_evidence enable row level security;
drop policy if exists "own meeting evidence" on public.meeting_evidence;
create policy "own meeting evidence" on public.meeting_evidence for all to authenticated
using (user_id = auth.uid()) with check (user_id = auth.uid());
grant select, insert, update, delete on public.meeting_evidence to authenticated;
grant all on public.meeting_evidence to service_role;

create table if not exists public.meeting_research_sources (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  meeting_id uuid not null references public.meetings(id) on delete cascade,
  company text not null,
  title text not null,
  url text not null,
  snippet text not null,
  published_date text,
  created_at timestamptz not null default now(),
  unique(meeting_id, url)
);
create index if not exists meeting_research_sources_meeting_idx
  on public.meeting_research_sources(meeting_id);
alter table public.meeting_research_sources enable row level security;
drop policy if exists "own meeting research" on public.meeting_research_sources;
create policy "own meeting research" on public.meeting_research_sources for all to authenticated
using (user_id = auth.uid()) with check (user_id = auth.uid());
grant select, insert, update, delete on public.meeting_research_sources to authenticated;
grant all on public.meeting_research_sources to service_role;

notify pgrst, 'reload schema';
commit;
