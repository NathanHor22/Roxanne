# Roxanne

Roxanne turns Malaysian business conversations into a recap, follow-ups, and
meeting approvals. The dashboard combines captured conversations and upcoming
meetings in a calendar. Open an approved meeting to review the conversation
that led to it: bullet points, concerns, promises, and preparation tasks.

This first phase implements the dashboard, a completed-transcript API, Ilmu
extraction, and explicit Google Calendar actions. Passive wearable capture is
the next integration. See [ARCHITECTURE.md](ARCHITECTURE.md) for the boundaries,
request contract, data model, and remaining work.

## Run locally

1. Install Node.js 22.x, matching `package.json`.
2. Run `npm install`.
3. Run `npm run dev` and open `http://localhost:3000/dashboard?mode=sample`.

With no Supabase configuration, local development permits credential-free
access. The sample workspace uses fictional conversations and browser storage.
Approvals, dismissals, and checklist changes in sample mode make no provider
calls and send no invitations. Use **Reset sample** to restore the preview.
Sample mode does not bypass authentication on an authenticated deployment.

## Configure a live workspace

Copy `.env.example` to `.env.local` and configure the paths you want to exercise.
Keep server credentials out of `NEXT_PUBLIC_` variables.

Apply these migrations to the target Supabase project in order:

1. `supabase/migrations/001_initial.sql`
2. `supabase/migrations/002_worker_hardening.sql`
3. `supabase/migrations/003_meeting_approvals.sql`

Migration 003 adds structured schedule details and dismissed approvals. It also
adds a unique Calendar-action index per follow-up. Reconcile any existing
duplicate Calendar actions for the same follow-up before applying that index.

The live workspace requires `NEXT_PUBLIC_SUPABASE_URL`,
`NEXT_PUBLIC_SUPABASE_ANON_KEY`, and `SUPABASE_SERVICE_ROLE_KEY`. Use
`DEMO_USER_EMAIL` for the owner account; optionally set `DEMO_USER_ID` to an
existing Supabase Auth user UUID.

### Owner login

The current app is an owner-scoped demo, not a multiuser SaaS application. Keep
`DEMO_ACCESS_MODE=owner` for authenticated use. The existing `public` setting
bypasses owner login and is not a tenant-isolation mechanism.

Enable Google under **Supabase Auth > Providers**, then allow these redirects
under **Auth > URL Configuration**:

- `http://localhost:3000/auth/callback`
- `https://YOUR-APP-DOMAIN/auth/callback`

For the Google OAuth client used by Supabase Auth, register the Supabase
callback shown on its provider page, normally
`https://YOUR-PROJECT-REF.supabase.co/auth/v1/callback`. The app's
`/auth/callback` belongs in Supabase's redirect allowlist.

Production owner authentication requires both public Supabase values. Leaving
both unset disables authentication only in local development; incomplete
configuration fails closed.

### Ilmu understanding

Set `ILMU_API_KEY` and, optionally, `ILMU_MODEL` (default `ilmu-v3.1`). The adapter
calls `https://api.ilmu.ai/v1/chat/completions` with a JSON schema and validates
the result locally. Its schedule extraction requires an agreed meeting and a
supporting quote found in the supplied transcript. Human review still decides
whether the details are correct before an invitation is sent.

`POST /api/conversations` accepts a completed, normalized transcript and
requires Ilmu and workspace storage. It does not call a speech provider or
accept raw audio. The contract and an example are in
[ARCHITECTURE.md](ARCHITECTURE.md#completed-transcript-api).

Existing recording and legacy hardware processing use Ilmu when its key is
configured, otherwise the Qwen adapter. A configured Ilmu failure is reported;
it does not silently switch providers or return sample content. Qwen remains
configurable through `QWEN_API_KEY`, `QWEN_BASE_URL`, and `QWEN_MODEL` for those
older paths.

### Google Calendar

Enable the Calendar API for the Google Cloud project and configure an OAuth
web client with these server settings:

```dotenv
GOOGLE_CLIENT_ID=your-client-id
GOOGLE_CLIENT_SECRET=your-client-secret
GOOGLE_REDIRECT_URI=http://localhost:3000/api/google/callback
GOOGLE_CALENDAR_ID=primary
ACTION_APPROVAL_SECRET=your-random-secret-of-at-least-32-UTF8-bytes
```

Register `GOOGLE_REDIRECT_URI` in that OAuth client's authorized redirect URIs;
use the deployed app's `/api/google/callback` for deployment. This Calendar
connection is separate from Supabase's Google login flow. Open **Settings >
Google Calendar** in the live workspace to connect. Credentials are encrypted
in `provider_connections`. `GOOGLE_REFRESH_TOKEN` is also supported as an
environment-configured owner connection.

Review or complete the date, time, duration, and attendee emails, then approve.
The live action creates the Google event and sends attendee updates. Roxanne
saves the event and its source-conversation relationship through the action
record. The dashboard currently shows Roxanne's stored conversations and
events, not a two-way mirror of everything in Google Calendar. The existing
availability endpoint is not automatically called by this approval flow.

### Audio uploads and browser capture

**Add recording** uploads audio directly to the private Supabase `recordings`
bucket using a signed upload token. `/api/process-meeting` receives the storage
reference, verifies ownership, and downloads the audio server-side. The
current limit is 25 MiB. Enter the original capture time and duration so
relative dates can be interpreted against the conversation.

Audio transcription uses `ELEVENLABS_API_KEY` when configured, otherwise
`GROQ_API_KEY`; understanding then uses the extraction provider described
above. Browser microphone capture publishes through Agora and records a local
audio file for this same upload flow. It requires `NEXT_PUBLIC_AGORA_APP_ID`
and `AGORA_APP_CERTIFICATE`; it is not the future passive wearable transcript
transport. Ilmu transcript imports do not require these audio-provider keys.

Devin and the persistent WhatsApp worker remain legacy follow-up integrations.
They are not prerequisites for transcript import, recaps, or Calendar
approval. Their settings remain in `.env.example`; worker setup is documented
in [worker/README.md](worker/README.md).

## Checks

```text
npm run typecheck
npm test
npm run build
```

`npm run check` also checks and builds the persistent worker; install its
dependencies separately with `npm --prefix worker install` first. Automated
checks do not establish live Ilmu accuracy, Google account connectivity, or
hour-long wearable reliability.
