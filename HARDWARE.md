# Roxanne hardware quickstart

Production base URL:

```text
https://roxanne-assistant.vercel.app
```

## Fastest working path

1. Join the phone hotspot in the device firmware/operating system using the
   hotspot SSID and password. Roxanne never receives or stores those values.
2. If the microphone appears as an input on the phone/laptop, open
   `/dashboard`, select that input in the browser, and press **Start live
   recording**. The browser joins Agora and publishes the microphone track.
3. For standalone firmware, register once and then request short-lived Agora
   publisher credentials as shown below.

## Register a device

```http
POST /api/devices/register
Content-Type: application/json

{"name":"Roxanne Wearable","firmwareVersion":"0.1.0"}
```

Persist the returned `device.id` UUID in the device configuration.

## Get Agora publisher credentials

```http
POST /api/hardware/bootstrap
Content-Type: application/json

{"deviceId":"<registered UUID>"}
```

The response contains `agora.appId`, `agora.channel`, `agora.uid`,
`agora.token`, and `agora.expiresAt`. Join as an RTC publisher and send the
microphone audio track before expiry; request a new token when reconnecting.

An Agora-compatible client or gateway is still required on the hardware side.
If the microcontroller cannot run an Agora RTC SDK, stream/cable its microphone
to the phone and use Roxanne's browser recorder as the gateway.
