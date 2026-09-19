# Lantern firmware

This is the shared Lantern ESP32-S3 firmware. The default and currently tested
profile is **Lantern Original**, the ZHENGCHEN 1.54-inch M1307/ML307 board. It
uses the board manufacturer's proven display, microphone, speaker, battery,
and button pin map.

The second profile is **Lantern V2**, the LCDWiki ES3C28P. It uses the board's
240 x 320 ILI9341 display, FT6336G touchscreen, ES8311 microphone/audio codec,
native USB, and 16 MB flash. A battery and microSD card are not required to
flash or demonstrate the USB-powered prototype. Touching the screen provides
the same primary control as the centre button on Lantern Original.

The current V2 image deliberately reports USB power as 100% and keeps replay
fallback in PSRAM. Its battery ADC and SDIO pins are reserved in the board
profile, but battery telemetry and microSD recording remain disabled until
those parts are fitted and tested.

Hardware-specific pins and capabilities live under `main/boards`. Session,
voice, networking, and dashboard behavior remain in the shared firmware. Each
board gets its own build image; the original board does not need an SD card and
continues to use its PSRAM streaming/retry strategy.

Version `0.5.0-board-profiles` keeps the existing local WakeNet activation gate and
buffered, low-latency speech playback while keeping one consistent
centre-button fallback:

- say "Computer" while ready: open a voice-activity command window (four seconds maximum)
- say "start recording" or "status report" during that command window

- short press while ready: open a new session and ask for spoken consent
- short or long press while recording: stop and upload the session
- long press while ready: play today's status report
- short press on an error: retry the exact failed operation
- long press on an error: cancel the session and return to ready
- short or long press on complete/status: return to ready immediately

After pairing or reboot, Lantern announces Sector 2418, its battery level, the
paired owner's name, and the prototype wake phrase. The idle screen shows
**READY** and **SAY COMPUTER OR PRESS**. Spoken yes/no remains mandatory because
activation cannot provide consent for the other people in the conversation.

## What this build proves

- 240 x 240 ST7789 display with a green Lantern palette
- I2S microphone capture at 16 kHz and speaker playback at 24 kHz
- first-boot 2.4 GHz Wi-Fi or phone-hotspot setup through `Lantern-XXXX`
- one-time dashboard pairing and authenticated device heartbeats
- server-bound spoken consent with a second confirmation after the first no
- Malaysia server time stamped when capture begins
- live 16 kHz publishing and caption staging through the Agora IoT SDK
- automatic local WAV fallback if the device cannot join Agora
- private WAV upload, final OpenAI transcription, structured meeting summary,
  and dashboard follow-up approval generation
- direct spoken daily status reports from a long press while ready
- operation-specific saving, completion, status, and error screens
- idempotent stop, transcript, audio, and completion retries
- automatic stale-session reset and one fresh start attempt after HTTP 409
- background summary retries after the audio has safely uploaded
- local WakeNet9 activation while idle, with no wake-word cloud request loop

The bundled prototype WakeNet model recognises "Computer." The firmware keeps
the model selector isolated so a separately trained "Lantern" WakeNet model can
replace it later; changing the displayed name cannot retrain a wake model.

The board keeps a rolling 30-second WAV retry archive in PSRAM. A meeting may
continue beyond 30 seconds through Agora, but this prototype uploads only the
latest 30 seconds as replay audio. Full hour-long replay requires durable audio
chunks and is still a separate reliability phase.

Hold both volume buttons for three seconds to clear Wi-Fi and pairing settings.

## Wi-Fi and pairing

When no saved Wi-Fi is available, connect your phone or this laptop to the
device network named `Lantern-XXXX` using password `lanternsetup`, then open
`http://192.168.4.1`. Enter the 2.4 GHz phone hotspot name and password plus the
one-time pairing code from the live dashboard. The setup page can also install
a locally built `build/lantern.bin` into the inactive OTA slot.

After setup, reconnect the laptop to normal internet. The ESP32 connects to the
phone hotspot itself; the dashboard and ESP32 communicate through the deployed
Lantern backend and do not need to be on the same local network.

OpenAI, Agora, Google, Supabase, and Exa secrets stay on the backend. The device
stores only its own paired credential and receives a short-lived Agora session
token when a recording begins.

## Build and flash

The ignored `.tools/esp-idf` checkout is ESP-IDF 5.2.3, matching the Agora
embedded SDK integration. ESP-SR supplies only WakeNet; OpenAI recognises the
two commands after wake activation and verifies spoken consent.

```powershell
powershell -ExecutionPolicy Bypass -File .\setup-agora-sdk.ps1
powershell -ExecutionPolicy Bypass -File .\build.ps1
powershell -ExecutionPolicy Bypass -File .\flash.ps1 -Port COM5
```

Build and flash Lantern V2 as an independent image:

```powershell
powershell -ExecutionPolicy Bypass -File .\build-v2.ps1
powershell -ExecutionPolicy Bypass -File .\flash-v2.ps1 -Port COM10 -Monitor
```

The V2 build uses `sdkconfig.v2`, `build-v2`, and native USB logging. It does
not overwrite the original board's `sdkconfig` or `build` outputs. The first
V2 flash writes the bootloader, partition table, app, and WakeNet model.

This CH340K board may not enter the ROM loader through DTR/RTS. If automatic
flashing fails:

1. Unplug the ESP32.
2. Hold the large centre/BOOT button.
3. Reconnect USB while continuing to hold it.
4. Run:

   ```powershell
   powershell -ExecutionPolicy Bypass -File .\flash.ps1 -Port COM5 -ManualBootloader
   ```

5. Release the centre button once writing begins.
6. After the hash is verified, tap the small RESET/EN button once.

The first WakeNet installation requires a full manual flash so `srmodels.bin`
is written to the model partition. Later application-only flashes preserve the
installed model as well as Wi-Fi and pairing credentials.

## End-to-end hardware test

Before testing, deploy the current web build and migrations with Supabase,
Agora, and OpenAI configured. Google is needed only when approving a Calendar
invitation from the dashboard.

1. Open the live dashboard and confirm the paired device is online.
2. Restart the board. It should announce the sector, battery, owner, and
   "Ready," then show **SAY COMPUTER OR PRESS**.
3. Say "Computer." Confirm the screen changes once to **LISTENING**. Say
   "start recording" during the command window. It closes after you stop
   speaking, with a four-second maximum. The centre button remains available
   as a fallback.
4. Lantern asks for recording consent and shows **SAY YES OR NO**.
5. Say "yes." Lantern confirms consent and changes to **RECORDING** with an
   elapsed timer and **PRESS CENTRE TO STOP**.
6. Speak for 10 to 20 seconds. Include a clear agreement such as: "Mr Chung,
   let's meet tomorrow at 1 PM Malaysia time for 30 minutes."
7. Short-press the centre button. The display moves through finalising,
   uploading audio, and processing summary.
8. Confirm Lantern says "Recording uploaded. Session complete," shows
   **UPLOADED TO DASHBOARD**, then returns to **READY** after three seconds.
9. Open the new conversation in the dashboard. Verify the recording replay,
   timestamped transcript, bullet summary, and pending meeting approval.
10. Say "Computer," followed by "status report." Confirm Lantern plays today's
   report, shows **REPORT COMPLETE**, and returns to ready. Long-pressing the
   centre button while ready provides the same fallback.

To test refusal, say "no" to the first consent prompt. Lantern asks again. A
second no cancels the session; saying yes on the second prompt starts it.

If an operation fails, read the specific error text. Short-press to retry it.
Long-press to cancel and return to ready. If audio upload succeeded but summary
processing did not, Lantern still reports session completion and retries the
same completion request in the background without creating a duplicate.

## Provider boundary and remaining reliability work

Agora is the live transport and caption layer. OpenAI performs consent
transcription, final diarized transcription, Malaysian code-switching
extraction, and device speech. Exa enriches public company context in Lantern
Relay; it does not identify people or speakers.

Before a field pilot, add acknowledged audio chunk uploads, reconnect/resume,
Agora token renewal, durable incremental transcripts, and explicit gap
records. Production firmware also needs encrypted NVS, flash encryption,
secure boot, signed OTA updates, and rollback validation.
