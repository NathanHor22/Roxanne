# Quipus by Fovea

The mark is a central knot with curved threads spreading outward. It represents
recorded conversations becoming connected knowledge. The editable mark,
monochrome mark and wordmark live in `public/quipus-*.svg`. The wordmark keeps
editable text; convert it to outlines before a manufacturing export.

The default palette is charcoal green `#111916`, raised surfaces `#19231e`,
off-white text `#e9eee7` and muted sage `#b5d5b1`. Light mode uses warm paper
`#f4f5ef`, dark green text `#1f3328` and accent `#3f6d4b`.

Use glass on navigation and controls; reading surfaces stay solid. Dashboard
headings use restrained weight and generous spacing. Editorial emphasis uses
Georgia; the rest uses the installed system sans-serif stack. No font download
is required. The startup thread reveal lasts 850 ms and never blocks controls.
Page/tab transitions last 220 ms. Reduced-motion preferences disable decorative
motion. Hardware has no animation and draws only state changes.

Top navigation: Home, Conversations, Calendar, Devices. Profile/settings and
sign-out sit under the named account. Public samples stay separate from live
account data and cannot send real invitations. Calendar recordings open in a
popup; the Conversations tab provides a complete meeting page.

## Hardware voice script

- Boot: “Quipus ready, [first name]. Say Computer for a command, or tap or press to record.”
- Recording consent: “Do you consent to being recorded? Say yes or no.”
- Stop: “Recording stopped. Uploading now. Keep Quipus powered on.”
- Confirmed upload: “Recording uploaded. Session complete.”
- Processing pending: explicitly say the summary is still processing.
- Report playback: show “Tap to interrupt” or “Press to interrupt.” After the
  interruption and chime, listen for the requested date/meeting/detail level.
- Unknown battery telemetry says “Not measured”; it is never presented as 100%.

“Computer” remains the actual installed wake model. The Quipus name does not
imply a working Quipus wake model. Voice consent is permission to record, not
identity authentication. Invitation/email approvals are separate exchanges.

## Compatibility

The deployment URL, Google OAuth callbacks, `lantern_*` database tables,
`X-Lantern-*` device headers, environment keys, firmware source directory and
`roxanne` NVS namespace remain intact. New screens say Quipus. The setup SSID
is Quipus-XXXX on new firmware; older devices may still advertise Lantern-XXXX.
The prototype setup password remains unchanged. Existing accounts, paired
devices, SD files, recordings and action history are retained.

Historical engineering/release documents are evidence of earlier versions.
The custom PCB remains a draft; rebranding does not resolve its outstanding
electrical, acoustic-orientation or fabrication checks.
