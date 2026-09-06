-- Run before enabling structured meeting extraction or dismissing live approvals.
-- Existing conversations and Calendar action links remain in their current tables.
alter type public.follow_up_status add value if not exists 'dismissed';
alter table public.follow_ups add column if not exists schedule_details jsonb;
-- One approval can claim only one Calendar action, even across concurrent tabs.
-- Existing duplicate follow-up actions must be reconciled before this index applies.
create unique index if not exists actions_one_calendar_per_follow_up
  on public.actions (user_id, follow_up_id)
  where type = 'calendar_event' and follow_up_id is not null;
comment on column public.follow_ups.schedule_details is
  'Extracted meeting agreement, startAt, durationMinutes, attendees, location, and transcript evidence. Approval state is owned by the application.';
