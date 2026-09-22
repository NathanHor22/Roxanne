# Recording release status — 21 September 2026

## Completed

- Vercel production build promoted to `https://roxanne-two.vercel.app`:
  `https://roxanne-72rzzvl35-nathans-projects-b0bfd21e.vercel.app`.
  Deployment `dpl_BaVs6zs9ALb73xZbQku6cjjBNiBs`. The build and TypeScript
  checks passed. Runtime functions were verified in Singapore (`sin1`).
- Supabase migrations 009 and 010 applied successfully through the authenticated
  SQL editor. Verified: private recordings bucket with 25 MiB limit, new private
  tables, archive/processing/delivery functions, service-role queue claims,
  anonymous claim denial, and session Realtime publication. Existing recording
  count at migration verification: 41.
- Railway worker deployment `a0890af2-4f78-4295-9851-5541b4cc31d0` succeeded.
- Matching `PROCESSING_WORKER_SECRET` configured on Vercel production and Railway.
  Railway also has `LANTERN_APP_URL` and `MEDIA_STORAGE_ORIGIN` configured.
- Railway health returned HTTP 200. Existing scheduled processing requests returned
  HTTP 202 in Vercel logs after promotion; no manual processing request was sent.
- Website deployment excludes generated V2 firmware and CAD artifacts.
- Added `scripts/check-recording-release.mjs` for read-only schema, storage,
  configuration, and device checks. Sensitive Vercel values are blank in exports;
  the script needs the actual server key in its execution environment.
- Touchscreen LCDWIKI-ES3C28P flashed on COM10, MAC `28:84:85:42:1c:38`,
  application partition only at `0x20000`, firmware `0.7.2-reports`.
  Application SHA-256:
  `d85ba61dfb72b31a4240222740325954bb450920cb8733ef40b60250736c9212`.
- Full 16 MiB pre-release flash backup saved in the ignored local path
  `hardware/backups/es3c28p/pre-reports-2026-09-21.bin`. SHA-256:
  `46d03c1a9f3c54d5fa02dfeb8f5c1f6a1efa8419bbe512dc68ff29b21c5191b3`.
  This contains credentials and must not be committed or shared.
- Post-flash inspection found saved Wi-Fi and pairing keys marked erased in NVS;
  the cause was not established. The namespace was correct, so no speculative
  loader change was made. Preserved the post-flash NVS for diagnosis, restored
  the original settings partition from the backup, and verified reconnection
  without requiring new pairing. No SD files were deleted.
- Verified on-device: SD mount, microphone/codec initialization, WakeNet
  `Computer`, Wi-Fi connection, complete boot speech playback, and acknowledged
  heartbeat. Supabase confirmed `0.7.0-reports` at 13:45:46 UTC on 21 September.
  The card reported 29,720 MiB capacity and 544 MiB free, with two existing WAVs.
- The first real recording attempt failed before capture: production logs showed
  HTTP 409 because the 30-second recording-consent deadline elapsed while speech
  was playing/being recognized. Increased the recording-only deadline to two
  minutes. Firmware 0.7.1 retries failed consent/start with a new prompt and a new
  spoken answer. Expired prompts and unrelated action approvals remain rejected.
  All 16 focused consent/action tests, TypeScript, production build, and both
  firmware profile builds passed. New web release deployed and V2 flashed.
  Supabase acknowledged firmware 0.7.1 at 14:03:11 UTC with no last error.
- The second attempt accepted spoken consent, joined Agora (including the STT
  bot), and captured an 82,604-byte SD WAV. Capture was stopped after about 2.6
  seconds, so this was not a long-recording test. Upload preparation then failed:
  signed TUS requests were incorrectly using the ordinary JWT endpoint. Corrected
  the endpoint to `/storage/v1/upload/resumable/sign`, retained origin/path
  validation, added HTTP status-only diagnostics, and deployed after upload tests
  and the production build passed. Source reference:
  https://github.com/supabase/storage/blob/master/src/http/routes/tus/lifecycle.ts
  An on-device retry then succeeded: all 82,604 bytes were accepted, the private
  cloud WAV passed verification, and the SD copy was removed only after archive
  and queue acceptance. The processing job completed in one attempt with no
  error; transcript and dashboard meeting records exist (rounded duration: 3s).
  Session: `efd458aa-da20-495d-8ff2-eacfce5c3ebe`.
  Recording: `5fafd679-af86-4600-8ff7-e7639ab5adff`.

## Remaining real-device acceptance checks

1. Run a fresh recording longer than 30 seconds, followed by the five-minute
   real-device checks in
   [recording-delivery-rollout.md](recording-delivery-rollout.md), including Wi-Fi
   interruption, complete replay, full spoken report, and individual approvals.
   The preserved short WAV and the long recording both passed. The long session
   (`f8c8853a-4e81-49cf-a3f9-eedd85ef4d54`) preserved 10,633,644 bytes, duration
   333 seconds rounded up, with a transcript and dashboard meeting. Processing
   completed in one attempt without error. Archive accepted at 14:29:08 UTC.
   The transfer on firmware 0.7.1 suffered connection resets, resumed from
   confirmed offsets including 3,338,240 and 6,311,936 bytes, and took roughly
   ten minutes including retries. This proves preservation/resume, not a speed
   improvement. The timed transfer after network tuning is recorded below.
   The final transcript contains 46 segments and 3,812 characters; the background
   job took 115.36 seconds and finished at 14:31:04 UTC. Dashboard meeting ID:
   `31d41a90-8242-43ce-aa96-2d8406077b7f`.
2. Verify actual owner WhatsApp delivery after owner binding and opt-in, and
   Calendar/Gmail actions after the required Google scopes and explicit approval.
   These have not been demonstrated with this release.

The live database was checked through SQL because sensitive server credentials
are blank in Vercel exports. The restricted Railway database role was not granted
broader access. The API release can be rolled back to the previous deployment
`dpl_9aQQk9Yo9jXWwQyhZRJ4dwb6eujv`; migrations are additive and must not be
reapplied or reversed casually. The old board was not flashed.

## Network tuning after the long-recording test

Firmware 0.7.2 increases the default TCP send buffer from 5,760 to 32,768 bytes,
the receive window to 16,384 bytes, and the receive mailbox to 16 entries. It adds
up to three automatic direct-upload attempts, each querying storage's confirmed
offset, and logs sent bytes separately from acknowledged bytes. No RAM-tail
substitution is allowed. Both board builds passed. V2 was flashed after the long
recording was safely archived; Supabase confirmed 0.7.2 online/ready with no error
at 14:35:29 UTC.

The follow-up on 0.7.2 also passed: session
`8c526ff9-ca04-4c9e-9ce7-609fbfc9b081`, 2,009,004 bytes, 63 seconds rounded up.
Cloud capture-end timestamp: 14:38:58.710 UTC. Archive acceptance:
14:40:26.382 UTC (87.67 seconds later, including upload preparation and
verification). The queued job completed at 14:41:04.624 UTC, 37.33 seconds after
enqueue. The device returned to idle with successful heartbeats; job/session and
recording are all ready with no error. Dashboard meeting ID:
`3b4ecbc0-a67b-4605-8e9e-da3d74f7fa02`.

Both recordings retain their full duration. This is not a controlled throughput
comparison: capture lengths and network conditions differ. Upload latency remains
substantial and needs further work; do not advertise a measured speed multiplier.

Official Meta WhatsApp
onboarding, audio compression, upload during capture, and SD recovery after power
loss remain separate unfinished features; this release does not claim them.

## Firmware upload optimization: 0.7.3

- Enabled `-O2` for both board profiles while retaining assertions. Verified the
  actual V2 compiler commands for the app, network, and display modules.
- Moved display rendering into a dedicated task with a one-item mailbox that
  copies the latest screen/detail. Callers no longer wait for LCD DMA. Identical
  frames are skipped; detail-only changes transfer the affected strips. Upload
  progress is capped at twice per second, with an immediate final update.
- Increased the SD transfer buffer from 8 to 16 KiB. The uploader still streams
  the complete WAV, handles partial writes, and resumes from confirmed offsets.
- Hashes each finalized WAV once per automatic retry sequence. A manual retry
  hashes again. Fresh uploads omit the pre-upload commit probe; retries retain
  it to recover a lost acknowledgement. Final server hashing is unchanged.
- Added per-stage `WAV timing` and `Save timing` diagnostics. Sent byte counts
  are distinct from storage-acknowledged bytes; network write time includes
  socket waits. No signed upload URLs or credentials are logged by these metrics.
- Both Original and V2 builds and all three archive/integrity tests passed.
  The Original board was not flashed. The V2 app-only flash at
  `0x20000` verified successfully; post-flash serial logs confirmed idle state
  and repeated authenticated heartbeats. Pairing, models, and SD data were kept.
  The flashed image is 1,674,928 bytes, SHA-256
  `c770e9068f00fb2a314d6d221b4cb3417e73312d52624024935e917f6497fd11`.
- The previous 0.7.2 app is preserved under ignored hardware backups, with
  SHA-256 `d85ba61dfb72b31a4240222740325954bb450920cb8733ef40b60250736c9212`.
  Current NVS was separately backed up before the flash. These backups remain
  local; NVS contains private device configuration and must not be published.

### Live 0.7.3 recording result

Session `b81893bc-4a17-464c-b193-a595beceb0e6` passed consent, captured a full
2,084,524-byte WAV (65.14 seconds; dashboard rounds up to 66), uploaded without
retry, and returned to idle. The SD original was removed only after archive and
queue acceptance. The dashboard meeting, recording, and processing job are all
ready with no error. Meeting ID: `cd9b0c7a-a48e-407a-9290-da068dae924d`.

- Server-stamped capture end: 15:12:41.455 UTC on 21 September 2026.
- Cloud archive accepted: 15:13:52.112 UTC, 70.66 seconds later.
- Processing queued: 15:13:53.116 UTC; ready at 15:14:35.866 UTC, 42.75 seconds.
- Firmware upload routine: 64.362 seconds. Its timing breakdown in milliseconds:
  checksum SD reads 3,972; hash CPU 104; preparation 1,428; TLS connection 837;
  upload SD reads 4,076; TLS writes 51,273; storage acknowledgement 1,046;
  final verification 1,602. No recovery or intermediate progress POST was needed.
- The pre-upload spoken announcement took 6.199 seconds. Queue acceptance took
  0.952 seconds. The final spoken message completed and the device stayed idle
  with acknowledged heartbeats; no display failures or watchdog resets appeared.

The comparable server-stamped archive delay was 70.66 seconds versus 87.67 on
0.7.2 (roughly 19% shorter), with a slightly larger new recording. This is one
live comparison, not a controlled benchmark or guaranteed speed multiplier.
The dominant remaining wait is in TLS writes/network transfer. This firmware
update does not change the deployed backend, original recording format, duration
limits, consent, or cloud acceptance rules.
