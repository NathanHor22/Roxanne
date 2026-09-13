# Lantern firmware

This is the active firmware for the ZHENGCHEN 1.54-inch M1307/ML307 ESP32-S3
board. It uses the board manufacturer's proven pin map. The
`0.2.2-lantern-pilot` builds the first complete 29-second conversation path. The
`0.2.1` image was compiled and flashed successfully on 13 September 2026 with
every written block hash-verified; a release-and-reset boot produced the
corrected green screen. The `0.2.2` update is built and ready to flash. It always
uploads the captured WAV even when Agora captions are missing so the backend can
recover the transcript with OpenAI.

## What this build proves

- 240 x 240 ST7789 display with a corrected green Lantern palette
- Main-button short and long press handling
- I2S microphone level sampling at 16 kHz
- I2S speaker confirmation chimes at 24 kHz with a silent idle state
- A 30-second PCM retry buffer in the board's 8 MB PSRAM
- Battery ADC and charging-pin telemetry
- First-boot 2.4 GHz Wi-Fi setup portal
- One-time dashboard pairing and prototype NVS credential storage
- Authenticated 15-second device heartbeats
- Server-confirmed recording consent and Malaysia capture time
- 16 kHz mono publishing through the Agora IoT SDK
- Final Agora caption staging, unconditional private WAV upload, OpenAI
  transcription recovery and OpenAI extraction

Short-press the main button once to enter the explicit consent screen, again
to confirm consent and start the Agora-backed recording, and once more to stop.
The pilot also stops automatically at 29 seconds. It then uploads the final
captions and WAV, asks OpenAI to create the brief, and shows **Dashboard ready**.
Long-press for at least 1.2 seconds to enter the still-local Status Report mode.
On the saved screen, press volume-up to replay the latest five seconds through
the speaker. Hold both volume buttons for three seconds to clear Wi-Fi and
pairing settings.

The setup network is named `Lantern-XXXX`. Connect to it with password
`lanternsetup`, then open `http://192.168.4.1`. Enter a 2.4 GHz Wi-Fi or phone
hotspot and the required one-time pairing code from the live dashboard. A
paired device can later change Wi-Fi without claiming a second identity.

After a local recording, the setup page can download the buffered PCM as a WAV
file. This gives the bring-up build an independent mic/replay check before the
durable cloud archive is connected.

The setup page can also install a locally built `build/lantern.bin`
into the inactive OTA slot. This removes the repeated manual BOOT-button step
during prototype development. The local updater is a development mechanism;
production firmware still requires signed updates and rollback validation.

## Build and flash

The repository's ignored `.tools/esp-idf` checkout is ESP-IDF 5.2.3, matching
the later Agora embedded-SDK integration target.

```powershell
powershell -ExecutionPolicy Bypass -File .\setup-agora-sdk.ps1
powershell -ExecutionPolicy Bypass -File .\build.ps1
powershell -ExecutionPolicy Bypass -File .\flash.ps1 -Port COM5
```

This CH340K board may not enter the ROM loader through DTR/RTS. If automatic
flashing fails, hold the main/BOOT button while reconnecting USB, keep it held,
and run `flash.ps1 -Port COM5 -ManualBootloader`. Release the button after the
write completes.

The partition offsets intentionally match the verified factory layout. The
full 16 MB factory backup remains under the Git-ignored `hardware/backups`
directory and can restore the board with esptool.

## First end-to-end test

Before flashing, deploy migration 005 and the current web build with Supabase,
Agora Speech-to-Text and OpenAI configured. Google is not required to
capture a conversation or create a pending approval.

1. Open the authenticated live dashboard and keep the **Lantern** page visible.
2. Pair the device if it does not already appear as registered.
3. Tap the main button once, confirm everyone has agreed, then tap again.
4. Confirm the screen shows a green Lantern accent plus the current Malaysia
   date, start time, and elapsed recording timer beside `REC`.
5. Speak for 10 to 20 seconds. Include a relative date, for example: "Mr Chung,
   let's meet tomorrow at 1 PM Malaysia time for 30 minutes."
6. Tap once to stop, or let the 29-second pilot stop itself.
7. Wait for **Dashboard ready**. The open dashboard refreshes within ten
   seconds.
8. Open the new conversation. Verify the calendar date, OpenAI bullet points,
   pending meeting approval, timestamped transcript, and original-audio replay.

If provider processing fails after both uploads, the device keeps the same
completion ID. Press once on the error screen to retry processing without creating a
duplicate conversation.

## Provider boundary

Configure Agora and OpenAI only on the Lantern backend. The device
receives a short-lived Agora RTC token for its own session; it never receives
Agora REST, OpenAI, Google, or Supabase credentials. The backend stamps
`CAPTURE_STARTED` with its own clock and returns the local
`Asia/Kuala_Lumpur` date/time for the device screen and later OpenAI
interpretation.

This pilot keeps the whole WAV and final-caption batch in PSRAM. It proves the
end-to-end contract but does not claim hour-long reliability. Durable chunks,
acknowledgements, reconnect/resume, token renewal and explicit gap records are
required next. The prototype device credential is currently stored in ordinary
NVS; encrypted NVS, flash encryption, secure boot, and signed OTA are required
before a field pilot.
