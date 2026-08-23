# Roxanne delivery checklist

Last verified: 23 August 2026 (Asia/Kuala_Lumpur)

This file separates code-complete work from live infrastructure work. A phase is
only marked complete when its checks pass; a provider is not called "live"
until it has been exercised with real credentials.

## Phase 1 — Foundation and safety

- [x] Next.js application and persistent Baileys worker are separate services.
- [x] Production authentication fails closed when Supabase Auth is missing.
- [x] Access is restricted to `nathanhor2001@gmail.com`.
- [x] WhatsApp pairing and sends are restricted to `601154444038`.
- [x] Provider secrets stay server-side.
- [x] External sends require an explicit approved action.

Reviewer check:

- Open `/login` while signed out; the calendar must not be visible.
- Try any Google account other than the owner; access must be rejected.

## Phase 2 — Product experience

- [x] Six-week August 2026 calendar, meeting drawer, people view, and settings.
- [x] English, Bahasa Melayu, Simplified Chinese, Cantonese, and Tamil switching.
- [x] Manual meeting creation includes client name, company, email, and time.
- [x] Audio upload and Agora microphone recording enter the same processing flow.
- [x] Transcript, insight, commitments, follow-ups, audio, and reload persistence.
- [x] Responsive desktop/mobile layouts.

Reviewer check:

- Switch through all five languages and confirm the main navigation changes.
- Open the James Tan meeting and inspect transcript, insight, and follow-ups.
- Create a meeting, reload, and confirm it remains after Supabase is connected.

## Phase 3 — Recording and intelligence pipeline

- [x] Browser uploads audio directly to the private Supabase bucket.
- [x] Owner/path validation, 25 MB limit, MIME allowlist, and failed-state handling.
- [x] ElevenLabs Scribe v2 transcription adapter with diarization.
- [x] Qwen strict structured extraction for people, insights, and commitments.
- [x] Devin produces proposals only; it cannot execute a send.
- [x] Production rejects credential-free fixture fallbacks.
- [ ] Run one real audio through ElevenLabs → Qwen → Supabase.
- [ ] Prepare one real Devin follow-up proposal.

Reviewer check:

- Upload a short clear recording under 25 MB.
- Wait for `Ready`, reload, and confirm transcript and insights still exist.
- Confirm a provider error shows `Failed` instead of fabricated success data.

## Phase 4 — Approved actions

- [x] Google OAuth credentials are encrypted at rest.
- [x] Free/busy lookup returns available 30-minute Malaysia-time slots.
- [x] Calendar invitations are idempotent and persisted as meetings.
- [x] WhatsApp relay uses bearer authentication and delivery idempotency.
- [x] WhatsApp follow-up is completed only after a successful delivery.
- [ ] Connect the owner Google Calendar and send one invitation.
- [ ] Pair the owner WhatsApp and send one message to `01154444038`.

Reviewer check:

- Cancel an action and verify nothing is sent.
- Repeat the same approved action and verify no duplicate event/message is made.

## Phase 5 — Automated verification

- [x] Application TypeScript check passes.
- [x] Worker TypeScript check passes.
- [x] 59/59 automated tests pass.
- [x] 2/2 worker hardening tests pass.
- [x] Next.js production build passes.
- [x] Baileys worker build passes.
- [x] Local multipart smoke request returns HTTP 200.
- [x] Direct private-upload route is used in production.

Run locally:

```powershell
npm.cmd run check
```

## Phase 6 — Live infrastructure and release

- [x] Vercel account authenticated and `nathans-projects-b0bfd21e/roxanne` linked.
- [x] GitHub repository connected to the Vercel project.
- [ ] Create the Roxanne Supabase project in the approved organization/region.
- [ ] Apply `supabase/migrations/001_initial.sql`.
- [ ] Enable Supabase Google Auth and add local/production redirect URLs.
- [ ] Provision Vercel Marketplace Upstash Redis after owner accepts its terms.
- [ ] Add ElevenLabs, Qwen, Devin, Agora, Google, and Supabase secrets.
- [ ] Deploy the one-replica Baileys worker to Railway.
- [ ] Pair WhatsApp from Roxanne Settings.
- [ ] Deploy the Vercel production build.
- [ ] Run the complete credential-backed golden path.
- [ ] Record final production URLs and verification time below.

Release record:

- Vercel URL: pending
- Railway worker URL: pending
- Supabase project ref: pending
- Golden-path result: pending

## Explicit MVP scope decisions

- [x] Gmail/email sending is replaced by the user-requested WhatsApp preview and
  approved self-send flow.
- [x] Hardware is simulated by browser upload/Agora recording, as allowed by
  the V0.1 specification.
- [ ] Existing Google Calendar event import and automatic recording matching
  are deferred; V0.1 includes free/busy input and invitation output.
- [ ] Daily cross-meeting aggregation, Redis vectors, Supabase Realtime, and
  background jobs are deferred beyond the credential-backed golden path.

## Live golden path — final gate

- [ ] Sign in as `nathanhor2001@gmail.com`.
- [ ] Record or upload real audio.
- [ ] Confirm live ElevenLabs transcription and live Qwen extraction.
- [ ] Reload and confirm the meeting, audio, transcript, and follow-ups persist.
- [ ] Generate a Devin proposal, review it, then approve WhatsApp send.
- [ ] Confirm the message arrives only at `01154444038`.
- [ ] Check Google free/busy, approve a slot, and receive the calendar invite.
- [ ] Verify Settings reports Supabase, ElevenLabs, Qwen, Devin, Google,
  WhatsApp, Agora, and Redis as connected.
