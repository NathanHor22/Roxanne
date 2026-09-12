begin;

alter table public.lantern_sessions
  add column if not exists conversation_timezone text not null default 'Asia/Kuala_Lumpur',
  add column if not exists capture_ended_at timestamptz,
  add column if not exists agora_channel_name text,
  add column if not exists agora_publisher_uid bigint,
  add column if not exists agora_stt_bot_uid bigint,
  add column if not exists agora_stt_agent_id text,
  add column if not exists agora_token_expires_at timestamptz,
  add column if not exists transcript_segments jsonb,
  add column if not exists transcript_language text,
  add column if not exists transcript_received_at timestamptz,
  add column if not exists transcript_event_id uuid,
  add column if not exists recording_id uuid references public.recordings(id) on delete set null,
  add column if not exists audio_received_at timestamptz,
  add column if not exists audio_event_id uuid,
  add column if not exists completion_event_id uuid,
  add column if not exists meeting_id uuid references public.meetings(id) on delete set null,
  add column if not exists processing_error text;

create unique index if not exists lantern_sessions_agora_agent_idx
  on public.lantern_sessions (agora_stt_agent_id)
  where agora_stt_agent_id is not null;

comment on column public.lantern_sessions.conversation_timezone is
  'IANA timezone used with the server recording timestamp for relative-date extraction.';
comment on column public.lantern_sessions.transcript_segments is
  'Final Agora STT segments staged durably before Ilmu processing.';
comment on column public.lantern_sessions.recording_id is
  'Private diagnostic WAV for the initial vertical slice; cloud archive replaces this for long sessions.';

commit;
