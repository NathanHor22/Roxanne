# Roxanne WhatsApp worker

This service owns Roxanne's one long-lived Baileys socket. Deploy it as a
**separate Railway service with exactly one replica**. Do not deploy this worker
to Vercel: serverless instances cannot reliably retain a WhatsApp Web socket.

## Railway checklist

1. Create a service from this repository and set its root directory to `worker`.
2. Set `DATABASE_URL` to the Supabase Postgres connection string (prefer the
   session pooler URL when IPv4 is required). The worker pins Supabase Root
   2021 CA from `certs/prod-ca-2021.crt` and keeps TLS verification enabled;
   never bypass certificate validation.
3. Generate a high-entropy value (at least 24 bytes) for
   `WHATSAPP_RELAY_TOKEN`; set the identical value in Vercel.
4. Generate a different high-entropy value of at least 32 bytes for
   `WHATSAPP_AUTH_ENCRYPTION_KEY`. Store it only in Railway and keep a secure
   backup: changing or losing it makes the persisted Baileys session unreadable.
5. Set `WHATSAPP_WORKSPACE_KEY=roxanne` and let Railway provide `PORT`.
6. Apply both `001_initial.sql` and `002_worker_hardening.sql`. The second
   migration adds atomic delivery leases. On first start, any legacy plaintext
   Baileys auth rows are encrypted transactionally before the socket opens.
7. Keep the service replica count at **1**. Multiple replicas would compete for
   the same WhatsApp session.
8. Set Vercel `WHATSAPP_RELAY_URL` to the Railway public URL.

The only permitted phone is hard-coded as `601154444038`. Both pairing and
sending reject any other destination.

## Pairing

All routes except `/health` require `Authorization: Bearer <token>`.

- Poll `GET /status`. When it says `qr_ready`, fetch `GET /qr` and scan its
  `data:image/png;base64,...` value from WhatsApp Linked Devices.
- Alternatively, call `POST /pair` with `{"phone":"01154444038"}` and enter
  the returned code in WhatsApp's **Link with phone number** flow.
- `POST /disconnect` logs out the linked device and deletes only Baileys auth
  keys. Delivery idempotency records remain intact.

`POST /send` accepts:

```json
{
  "to": "601154444038",
  "text": "Approved follow-up message",
  "idempotencyKey": "a-stable-key-at-least-8-characters"
}
```

The key is persisted in `whatsapp_delivery_keys`. Exactly one database claimant
may send at a time. Its two-minute lease is renewed while the send is active and
becomes claimable after a crash; restart retries reuse a deterministic WhatsApp
message ID. A concurrent caller receives `409` with a retry delay instead of
sending a duplicate.

Baileys credentials and Signal keys are encrypted with AES-256-GCM before they
reach Postgres. `WHATSAPP_AUTH_ENCRYPTION_KEY` is deliberately separate from the
HTTP relay bearer token. Never expose either value to Vercel client variables.
