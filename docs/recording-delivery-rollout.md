# Complete recordings, spoken reports, and approved delivery

The product name is unchanged. These changes need a coordinated database, web,
worker, and firmware release; building the repository does not update live devices.

## What changes

- Vercel functions run in Singapore (`sin1`), close to the existing Singapore
  Supabase database and Malaysian devices. Static assets remain on Vercel's CDN.
- SD boards stream the complete 16 kHz mono WAV directly to private Supabase
  Storage using resumable 6 MiB TUS requests. Only 8 KiB is buffered in RAM.
  Upload retries query the confirmed storage offset. The backend verifies the
  complete file length, WAV structure, and SHA-256 before accepting the archive.
- Archive acceptance and a durable processing job free the device atomically.
  Transcription/extraction run afterward; they never change the physical device's
  state, so an older job cannot interrupt a newer recording. The original WAV is
  replayable while the brief is processing. SD cleanup follows archive and queue
  acceptance, not a speculative upload success.
- OpenAI performs final transcription/diarization of the original WAV. The live
  Agora transcript is a labelled fallback after repeated final-transcription
  failures. Exa is not used for speaker identification.
- Status reports read all today's completed meetings, their points, needs,
  concerns, promises, commitments, and next steps. Speech is paged without cutting
  off after the first point or the third meeting.
- A device asks whether to review pending actions, then reads each concrete
  invitation or email before accepting a specific yes/no. A general yes to
  reviewing actions does not authorize sending them. Missing dates, durations,
  addresses, or unsupported actions are left for review in the dashboard.
- WhatsApp delivery is opt-in to the owner's number. Each client share needs its
  own approval and sends the report, full transcript text file, and original WAV.
  A durable outbox is inserted with the completed meeting. Delivery outages do not
  downgrade completed transcription. Each file/message uses a stable delivery key.

If processing exhausts its retries, open the failed conversation and choose
**Retry transcript and brief**. It uses the preserved cloud WAV and does not
interrupt a newer recording on the device.

## Release order

1. Back up the database. Apply `supabase/migrations/009_audio_delivery.sql` then
   `010_reports_and_delivery.sql`, after migrations 001–008. These are one-time
   migrations; do not repeatedly paste them into an already-migrated database.
   Keep the `recordings` Storage bucket private. Its existing device-upload limits
   still apply. Realtime requires the owner-scoped SELECT policy on
   `lantern_sessions` from migration 007; migration 009 adds the table
   to the Realtime publication when available.
2. Configure the web deployment:
   - Existing Supabase server/browser keys, OpenAI, Agora, and Google credentials.
   - `PROCESSING_WORKER_SECRET`: a new random secret of at least 32 characters.
   - `WHATSAPP_OWNER_USER_ID`: the intended owner's Supabase Authentication user UUID.
   - `WHATSAPP_RELAY_URL` and `WHATSAPP_RELAY_TOKEN`: the existing Railway relay.
   - `WHATSAPP_ALLOWED_RECIPIENT=601154444038` for the current owner-bound prototype.
     Changing this alone does not change which phone can pair the relay.
3. Configure the single-replica Railway worker:
   - Keep its database, independent auth-encryption key, relay token, and existing
     workspace key. Do not change the workspace key of an already-paired relay.
   - `LANTERN_APP_URL=https://your-live-app`.
   - `PROCESSING_WORKER_SECRET`: the identical web secret.
   - `MEDIA_STORAGE_ORIGIN=https://your-project.supabase.co` (the project origin,
     not the direct upload hostname and not a signed recording URL).
   The worker calls `/api/internal/process-recordings` every minute. This recovers
   jobs interrupted by a serverless timeout. Without it, the initial request can
   process successfully, but delayed retries and automatic deliveries are not
   guaranteed. Allow this authenticated endpoint through any deployment protection.
4. Deploy the web app and worker. In Settings, pair WhatsApp if needed, then enable
   **Send my future reports to WhatsApp**. Existing meeting history is not sent
   automatically. This prototype uses the existing linked-device Baileys relay;
   it is not a multi-tenant WhatsApp Business integration.
5. Enable the Gmail API in the same Google Cloud project. The existing OAuth
   callback stays `/api/google/callback`. In Settings choose **Connect Gmail** to
   grant the additional `gmail.send` permission. Existing Calendar access alone
   does not permit sending Gmail messages. Check the Google consent screen's test
   users/publishing status for the accounts used in the demo.
6. Build/flash firmware `0.7.3-upload` for the correct board profile:
   `hardware/lantern-firmware/build-v2.ps1` for the touchscreen SD board;
   `build.ps1` for the original board. Never flash one board's image onto the other.
   Flashing is a separate step; these build scripts do not flash hardware.

## Acceptance test on the deployed system

Before flashing, run the read-only schema, storage, and settings check from an
environment containing the real production server credentials:

```sh
node scripts/check-recording-release.mjs /path/to/private-production.env
```

It prints no credentials or signed audio URLs. A Vercel environment export may
leave sensitive values blank, so a downloaded export alone may not be sufficient.
Keep the new production deployment staged with `vercel deploy --prod --skip-domain`
until the database is migrated, then promote that deployment and release the worker.

1. Record a 30-second conversation and then a five-minute conversation. Include
   two speakers, several distinct points, and a follow-up date with an email.
2. Stop capture. Watch upload progress; verify both complete WAV durations in the
   dashboard. Compare the stored file's SHA-256 against the upload manifest.
   A brief still processing must not prevent starting the next consent flow.
3. Interrupt Wi-Fi during upload, then restore it and retry. Confirm the upload
   resumes rather than attaching the 30-second RAM buffer. Keep the device powered
   during this test: automatic recovery of every SD file after a power loss is a
   separate backlog feature, not a guarantee of this release.
4. With owner delivery enabled, confirm the report, transcript, and full WAV arrive
   on the owner's WhatsApp without opening the dashboard. Disconnect the relay,
   finish another meeting, reconnect it, and verify the queued delivery retries.
5. Ask for a status report. Confirm the last point of the last meeting is spoken.
   Say yes to reviewing actions, then no to an individual invitation: nothing
   should be sent. Review again, approve the exact invitation, and check Calendar.
6. Approve a Gmail draft only after checking the spoken/displayed recipient,
   subject, and full body. Confirm it in Gmail Sent. If Gmail returns an ambiguous
   timeout, check Sent manually: the application deliberately blocks automatic
   resubmission because Gmail has no send idempotency key.
7. Share one completed meeting with a client from its detail view. Changing the
   recipient clears the approval checkbox. A different signed-in user must not
   see recordings, approve actions, or control the owner's relay.

## Limits

Automated checks: `npm run test` includes in-memory PostgreSQL migration and
queue tests, full-WAV integrity checks, speech pagination, and approval/replay
boundaries. `npm run worker:test` checks report media handling. Run `npm run check`
for web/worker types, tests, and production builds. Neither those checks nor the
firmware build scripts send live invitations, WhatsApp messages, or flash a board.

- The current archive/API limit is 25 MiB, about 13 minutes 39 seconds at 16 kHz
  mono PCM; firmware capture limits may be lower. This change does not increase
  the SD-less board's recording buffer. Five minutes fits on the SD board.
- Faster direct transfer removes repeated web-server proxy uploads and waiting
  for AI on the hardware. Network throughput and provider time still affect total
  latency; measure them with the real board before promising a latency figure.
- Complete report means the full generated meeting brief, not reading the entire
  verbatim transcript aloud. The transcript and original audio remain available.
- USB microphone host power/circuitry, four-mic hardware, and a final product name
  are separate work. No new hardware support or rebranding is claimed here.
- An automatic 90-day recording purge is not implemented in this release.
  WhatsApp copies already delivered to phones would also be outside server retention.
