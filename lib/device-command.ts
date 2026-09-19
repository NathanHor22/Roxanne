export type DeviceCommandContext =
  | "ready"
  | "wake"
  | "wake_word"
  | "wake_command"
  | "consent"
  | "consent_retry";
export type DeviceCommandIntent =
  | "wake_detected"
  | "status_report"
  | "start_recording"
  | "stop_recording"
  | "consent_yes"
  | "consent_no"
  | "unknown";

function normalizedCommand(value: string) {
  return value
    .normalize("NFKD")
    .toLocaleLowerCase("en")
    .replace(/[\u2018\u2019]/gu, "'")
    .replace(/[^\p{L}\p{N}']+/gu, " ")
    .replace(/\s+/gu, " ")
    .trim();
}

function containsOath(command: string) {
  const markers = [
    "brightest day",
    "blackest night",
    "escape my sight",
    "beware my power",
    "green lantern",
  ];
  return markers.filter((marker) => command.includes(marker)).length >= 3;
}

export function interpretDeviceCommand(
  transcript: string,
  context: DeviceCommandContext,
): DeviceCommandIntent {
  const command = normalizedCommand(transcript);
  if (!command) return "unknown";

  const hasWakeAddress = /\b(?:lantern|latern|green lantern|ring)\b/iu.test(command);

  if (context === "wake_word") {
    return hasWakeAddress ? "wake_detected" : "unknown";
  }

  if (context === "consent" || context === "consent_retry") {
    if (
      /\b(?:no|nope|cancel|don't|do not|tak|tidak|jangan|belum|batal)\b/iu.test(command)
    ) {
      return "consent_no";
    }
    if (
      /\b(?:yes|yeah|yep|agree|agreed|consent|okay|ok|boleh|setuju|ya|teruskan|go ahead)\b/iu.test(
        command,
      )
    ) {
      return "consent_yes";
    }
    return "unknown";
  }

  if (
    context === "wake" &&
    !hasWakeAddress
  ) {
    return "unknown";
  }

  if (
    containsOath(command) ||
    /\b(?:status report|daily report|daily briefing|today's meetings|todays meetings|what happened today|ring status|laporan status|laporan hari ini|ring report)\b/iu.test(
      command,
    )
  ) {
    return "status_report";
  }
  if (
    /\b(?:start recording|start the recording|start meeting|record now|we're talking now|we are talking now|mula rakam|mulakan rakaman|mula meeting|mula mesyuarat|ring start)\b/iu.test(
      command,
    )
  ) {
    return "start_recording";
  }
  if (context === "wake_command") return "unknown";
  if (
    /\b(?:stop recording|stop the recording|meeting done|we're done|we are done|tamat rakaman|habis rakam|ring stop|lantern stop)\b/iu.test(
      command,
    )
  ) {
    return "stop_recording";
  }
  return "unknown";
}

export function commandReply(
  intent: DeviceCommandIntent,
  context: DeviceCommandContext = "ready",
) {
  switch (intent) {
    case "wake_detected":
      return "Lantern verified. Say your command.";
    case "start_recording":
      return context === "wake_command"
        ? "Start recording selected."
        : "Recording requires consent. Do you consent to being recorded? Say yes or no.";
    case "stop_recording":
      return "There is no active recording to stop.";
    case "consent_yes":
      return "Understood. Device authenticated. Consent confirmed. Recording now.";
    case "consent_no":
      return context === "consent_retry"
        ? "Authentication failed. Recording was not started. Please start another session."
        : "Not authenticated. Please confirm again. Do you consent to being recorded?";
    case "unknown":
      if (context === "consent" || context === "consent_retry") {
        return "I did not hear a clear yes or no. Please confirm. Do you consent to being recorded?";
      }
      return context === "wake_command"
        ? "I did not catch that. Say start recording or status report."
        : "I did not catch that. Say Lantern, start recording, or Lantern, status report.";
    case "status_report":
      return "Preparing your status report.";
  }
}
