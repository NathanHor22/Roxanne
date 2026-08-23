# Roxanne delivery checklist

Last verified: 23 August 2026 (Asia/Kuala_Lumpur)

This file separates code-complete work from live infrastructure work. A phase is
only marked complete when its checks pass; a provider is not called "live"
until it has been exercised with real credentials.

## Phase 1 — Foundation and safety

- [x] Next.js application and persistent Baileys worker are separate services.
- [x] Hackathon production uses the explicitly requested public launch mode;
  owner-only Google Auth remains available with `DEMO_ACCESS_MODE=owner`.
- [x] WhatsApp pairing and sends are restricted to `601154444038`.
- [x] Provider secrets stay server-side.
- [x] External sends require an explicit approved action.

Reviewer check:

- Open `/`, click **Open dashboard**, and confirm `/dashboard` loads directly.
- Restore `DEMO_ACCESS_MODE=owner` before using this workspace beyond the demo.

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
- [x] Groq Whisper production transcription when ElevenLabs is not configured.
- [x] Qwen strict structured extraction for people, insights, and commitments.
- [x] Devin produces proposals only; it cannot execute a send.
- [x] Production rejects credential-free fixture fallbacks.
- [ ] Run one real audio through Groq Whisper → Qwen → Supabase.
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
- [x] 60/60 automated tests pass.
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
- [x] Current application code committed and pushed to `origin/main`.
- [x] Roxanne Supabase project created and linked as `cjogfunwcwytvooycjzv`.
- [x] Local Supabase configuration records the production URL and Auth redirects.
- [x] Remote migrations `001_initial.sql` and `002_worker_hardening.sql` applied;
  14 tables, 12 public RLS policies, and the private recording bucket verified.
- [x] Supabase Google Auth is enabled and email/password signup is disabled.
- [ ] Add the Supabase and Roxanne callback URLs to the Google Cloud OAuth client.
- [x] Provision and connect Vercel Marketplace Upstash Redis.
- [x] Add Supabase, application Google OAuth, WhatsApp relay, owner, timezone,
  and action-approval variables to Vercel Production.
- [x] Add and verify live Groq/Qwen, Agora, and Upstash variables in Vercel.
- [ ] Add Devin credentials if the proposal step is required for judging.
- [x] Deploy and health-check the one-replica Baileys worker on Railway; live
  state is `qr_ready` and awaits owner pairing.
- [ ] Pair WhatsApp from Roxanne Settings.
- [x] Initial Vercel production build deployed and assigned to
  `https://roxanne-assistant.vercel.app`.
- [x] Deploy and verify the public launch page, dashboard, live Groq/Qwen,
  secured Agora tokens, reachable Redis, and hardware bootstrap routes.
- [ ] Run the complete credential-backed golden path.
- [ ] Record the Railway URL and final golden-path verification time below.

Release record:

- Git branch: `origin/main`
- Vercel URL: `https://roxanne-assistant.vercel.app` (live)
- Railway worker URL: `https://roxanne-whatsapp-production.up.railway.app`
- Supabase project ref: `cjogfunwcwytvooycjzv` (schema applied)
- Infrastructure verified: 23 August 2026, 14:52 (Asia/Kuala_Lumpur)
- Registered hardware ID: `561bc32e-df1a-4b00-9f46-ef08cf2df9b9`
- Golden-path result: pending

### Owner-only actions

These steps require an account decision, secret, or physical confirmation and
cannot be completed by repository automation alone:

- [ ] Add Devin credentials if the proposal step will be demonstrated.
- [ ] Add `https://cjogfunwcwytvooycjzv.supabase.co/auth/v1/callback` and
  `https://roxanne-assistant.vercel.app/api/google/callback` to the existing Google
  Cloud OAuth client's authorized redirect URIs, then complete the one-time
  Google Calendar consent from Roxanne Settings.
- [ ] Scan the WhatsApp QR or enter the pairing code on the phone for
  `01154444038`.
- [ ] Approve the real WhatsApp self-send and Google Calendar invitation during
  the final golden-path test.

## Explicit MVP scope decisions

- [x] Gmail/email sending is replaced by the user-requested WhatsApp preview and
  approved self-send flow.
- [x] Browser Agora recording plus device registration and short-lived hardware
  Agora bootstrap endpoints are implemented.
- [ ] Existing Google Calendar event import and automatic recording matching
  are deferred; V0.1 includes free/busy input and invitation output.
- [ ] Daily cross-meeting aggregation, Redis vectors, Supabase Realtime, and
  background jobs are deferred beyond the credential-backed golden path.

## Live golden path — final gate

- [ ] Click **Open dashboard**; no Google login is required in hackathon mode.
- [ ] Record or upload real audio.
- [ ] Confirm live Groq Whisper transcription and live Qwen extraction.
- [ ] Reload and confirm the meeting, audio, transcript, and follow-ups persist.
- [ ] Generate a Devin proposal, review it, then approve WhatsApp send.
- [ ] Confirm the message arrives only at `01154444038`.
- [ ] Check Google free/busy, approve a slot, and receive the calendar invite.
- [ ] Verify Settings reports Supabase, Groq Whisper, Qwen, Devin, Google,
  WhatsApp, Agora, and Redis as connected.
