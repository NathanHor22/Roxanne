# Lantern hardware and device protocol

Production base URL:

```text
https://roxanne-assistant.vercel.app
```

## Current hardware gate

The target board is the ZHENGCHEN 1.54-inch M1307 ESP32-S3 variant with a
240 x 240 ST7789 display, microphone, speaker path, buttons, battery support,
and an ML307 cellular module. The repository also contains earlier Agora
firmware under `hardware/firmware`.

Do not flash the connected board yet. Windows exposes the ZHENGCHEN board as
`USB-SERIAL CH340K (COM5)`, with USB VID `1A86` and PID `7522`. A factory boot
log confirms ESP32-S3 revision 0.2, 8 MB octal PSRAM, and factory firmware
`xiaozhi` 2.4.0 built with ESP-IDF 5.5.2. Esptool also confirms 16 MB quad
flash at 3.3 V.

The recovery gate is complete. Holding the main/BOOT button on GPIO0 while
reconnecting enters the ROM downloader. The full 16,777,216-byte flash image is
stored under the Git-ignored `hardware/backups` directory and passed esptool's
digest verification. Its SHA-256 checksum is stored beside it. A final reset
successfully returned the board to the factory firmware.

The factory partition layout is preserved as CSV in the same ignored folder:

| Partition | Offset | Size |
| --- | ---: | ---: |
| NVS | `0x9000` | 16 KB |
| OTA metadata | `0xd000` | 8 KB |
| PHY data | `0xf000` | 4 KB |
| OTA slot 0 | `0x20000` | 4,032 KB |
| OTA slot 1 | `0x410000` | 4,032 KB |
| Assets | `0x800000` | 8 MB |

The remaining bench check is to photograph or transcribe the printed ESP32-S3
module and exact ML307 markings before cellular work begins.

The dashboard, state machine, and gateway can run before this gate. Firmware
integration and flashing wait until the gate passes.

## Network model

The ESP32-S3 needs an internet path to reach Roxanne. For the first release,
use 2.4 GHz Wi-Fi from a phone hotspot or trusted router. Hotspot credentials
stay in protected device storage; Roxanne's backend does not receive them.
The ML307 can become a later cellular fallback after its exact variant and SIM
behavior are verified.

Google, Ilmu, and other provider credentials stay on Roxanne's backend. The
device receives only its own Roxanne credential and, later, short-lived capture
session credentials. It never stores a Google refresh token or sends a Google
invitation directly.

## Pair once

Apply migrations 001 through 004 and open **Lantern** in the authenticated live
dashboard. Choose **Create pairing code**. The code lasts ten minutes and can be
claimed once.

The firmware claims it with a stable hardware identifier:

```http
POST /api/device/v1/claim
Content-Type: application/json

{
  "pairingCode": "24G7N-8R5XQ",
  "hardwareId": "esp32s3:<factory-mac>",
  "model": "ZHENGCHEN-1.54-M1307",
  "firmwareVersion": "0.1.0"
}
```

A successful claim returns the device UUID and a 32-byte secret once:

```json
{
  "device": {
    "id": "00000000-0000-4000-8000-000000000000",
    "name": "Nathan's Lantern"
  },
  "credential": {
    "scheme": "Device",
    "secret": "store-this-once-in-protected-nvs"
  }
}
```

Store both values in encrypted/protected NVS. Every later device request uses:

```http
Authorization: Device <device-uuid>.<device-secret>
```

The server stores only a SHA-256 digest of the secret. Revoking the device from
the dashboard clears that digest, so every subsequent device request fails.

## Heartbeat

Post telemetry every 15 seconds while connected and after every meaningful
state change:

```http
POST /api/device/v1/heartbeat
Authorization: Device <device-uuid>.<device-secret>
Content-Type: application/json

{
  "eventId": "11111111-1111-4111-8111-111111111111",
  "firmwareVersion": "0.1.0",
  "state": "ready",
  "stateVersion": 0,
  "batteryLevel": 82,
  "networkType": "wifi",
  "freeHeapBytes": 185000,
  "lastError": null
}
```

The response supplies server time, the accepted version, a 15-second heartbeat
interval, and a 30-second retry-buffer limit. A stale version receives `409`.

## Start Quick or Status mode

Generate a new UUID for every event. The same event UUID can be retried safely.

```http
POST /api/device/v1/sessions
Authorization: Device <device-uuid>.<device-secret>
Content-Type: application/json

{
  "eventId": "22222222-2222-4222-8222-222222222222",
  "mode": "quick"
}
```

Quick mode returns an `awaiting_recording_consent` session with a server-created
prompt ID and expiry. Status mode returns an `oath_listening` session. Persist
the returned session and version before sending the next event.

## Apply a transition

Send the exact session ID, a fresh event UUID, and the current version:

```http
POST /api/device/v1/sessions/<session-uuid>/events
Authorization: Device <device-uuid>.<device-secret>
Content-Type: application/json

{
  "eventId": "33333333-3333-4333-8333-333333333333",
  "expectedVersion": 1,
  "event": {
    "type": "RECORDING_CONSENT",
    "at": "2026-09-11T12:00:00+08:00",
    "promptId": "<prompt-id-from-session>",
    "accepted": true
  }
}
```

The backend replaces the event time with server time. The exact prompt must
still be active and unexpired. A random, stale, or replayed spoken "yes" cannot
start recording or approve an action. A valid response returns the new session
and version. A new event based on stale state receives `409`; retrying the same
event UUID returns its stored result.

The implemented transition types are defined in `lib/lantern-state.ts`. The
critical Quick path is:

```text
ready -> awaiting_recording_consent -> recording -> finalising
      -> processing -> report_ready
```

The Status path ends a voice-confirmed proposal at:

```text
status_report -> awaiting_action_confirmation -> pending_dashboard_approval
```

Voice confirmation never calls Google. The authenticated dashboard remains the
authority that sends a Calendar invitation.

## Still to connect

The gateway currently persists identity, telemetry, and state; the dashboard
simulates the flow without recording audio. The next hardware milestones are
display/buttons/audio bring-up, protected credential storage, Wi-Fi recovery,
and the device protocol client. Durable audio chunks, original-audio assembly,
Agora transcription, Ilmu extraction, and Google/Gmail execution follow behind
their existing provider boundaries.

The old `/api/devices/register` and `/api/hardware/*` routes belong to the
earlier speaking-agent experiment. New Lantern firmware should use the v1
device routes above.
