# Roxanne

Roxanne is a multilingual memory layer for business development conversations.

## Local setup

1. Install Node.js 20 or newer.
2. Copy `.env.example` to `.env.local` and add the integrations you want to exercise.
3. Run `npm install`.
4. Apply `supabase/migrations/001_initial.sql` to the target Supabase project.
5. Run `npm run dev` and open `http://localhost:3000`.

The app reports each integration as live or needing configuration. Secrets are server-only; the only public provider values are the Supabase anon key and Agora App ID.

Production processing fails closed: `ELEVENLABS_API_KEY`, `QWEN_API_KEY`,
`DEVIN_API_KEY`, `NEXT_PUBLIC_SUPABASE_URL`, and
`SUPABASE_SERVICE_ROLE_KEY` must be configured. Credential-free deterministic
results are intentionally restricted to local development and tests, so a live
deployment cannot report fixture content as a successful meeting.

## Owner authentication

Production access is restricted to `DEMO_USER_EMAIL` through Supabase Google Auth. Enable Google in **Supabase Auth → Providers**, then allow these redirects in **Auth → URL Configuration**:

- `http://localhost:3000/auth/callback`
- `https://YOUR-VERCEL-DOMAIN/auth/callback`

In Google Cloud, use the Supabase callback shown on the Google provider page (normally `https://YOUR-PROJECT-REF.supabase.co/auth/v1/callback`) as the OAuth client's authorized redirect URI. The app-level `/auth/callback` URLs belong in Supabase's redirect allowlist, not Google Cloud's.

Set both `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY` in Vercel. Production fails closed when public Auth configuration is missing or incomplete. For local development only, leaving both values blank preserves the credential-free workflow.

`SUPABASE_SERVICE_ROLE_KEY` remains server-only and must never use a `NEXT_PUBLIC_` prefix.

## Recording uploads

Production audio never passes through a Vercel request body. The browser first
requests a short-lived, owner-scoped signed upload token, uploads the file
directly to the private Supabase `recordings` bucket, and then sends only the
recording ID/path plus meeting metadata to `/api/process-meeting`. The server
verifies the owner and exact path before privately downloading the object for
ElevenLabs and Qwen. The maximum recording size is 25 MB.

Multipart processing exists only for credential-free local development and
small deterministic smoke tests. Production rejects it, so both
`NEXT_PUBLIC_SUPABASE_ANON_KEY` and the server-side Supabase credentials are
required for deployed uploads.

## Safety

External actions are proposed first and require an explicit approval request. WhatsApp sending is hard-allowlisted to `WHATSAPP_ALLOWED_RECIPIENT` for the hackathon build.
