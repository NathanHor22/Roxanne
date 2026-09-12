# Lantern ESP32-S3 firmware

Legacy target: `zhengchen-1.54tft-ml307` / ESP32-S3 N16R8. This is the earlier
speaking-agent experiment, not the new Lantern v1 client. Read the repository
root `HARDWARE.md` before connecting or flashing it.

## Phase checklist

- [x] Exact board, mic, speaker, button, and backlight pins identified
- [x] Phone-hotspot Wi-Fi client
- [x] Short-lived Agora token retrieval from Lantern
- [x] Agora RTC microphone publish and speaker playback
- [x] Groq-powered Agora voice agent start/stop
- [x] Agora transcript return to dashboard and Qwen extraction
- [ ] Factory flash backup
- [ ] Compile, flash, and live audio verification

## Wi-Fi configuration

1. Enable the phone hotspot in **2.4 GHz / compatibility mode**.
2. Copy `main/secrets.example.h` to `main/secrets.h`.
3. Put the hotspot name and password in `main/secrets.h`. This file is ignored by Git.

## Build

Use ESP-IDF 5.2.3, which matches Agora's embedded SDK reference build.

```powershell
./setup-agora-sdk.ps1
idf.py set-target esp32s3
idf.py build
```

## Back up and flash

Hold the main/BOOT button, tap reset (or reconnect USB), then release BOOT when
the serial connection begins.

```powershell
python -m esptool --chip esp32s3 --port <confirmed-port> flash-id
python -m esptool --chip esp32s3 --port <confirmed-port> read-flash 0 <verified-flash-size> ../backups/factory.bin
idf.py -p <confirmed-port> flash monitor
```

`COM5` currently exposes a CH340K bridge, but do not substitute it above until
disconnecting the second board proves which ESP32 it belongs to. The old COM11
note was historical.

Press the main button once to start. The backlight turns on, Lantern greets you,
and the device becomes a two-way voice assistant. Press again to stop and send
the transcript through Qwen into the dashboard. The dashboard polls for new
hardware meetings every five seconds.
