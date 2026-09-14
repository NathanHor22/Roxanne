export type DeviceCommandContext = "ready" | "consent";
export type DeviceCommandIntent =
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
    .replace(/[’']/gu, "'")
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

  if (context === "consent") {
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
  if (
    /\b(?:stop recording|stop the recording|meeting done|we're done|we are done|tamat rakaman|habis rakam|ring stop|lantern stop)\b/iu.test(
      command,
    )
  ) {
    return "stop_recording";
  }
  return "unknown";
}

export function commandReply(intent: DeviceCommandIntent) {
  switch (intent) {
    case "start_recording":
      return "I am ready to record. I need consent from everyone present. After the tone, say yes to continue, or no to cancel.";
    case "stop_recording":
      return "There is no active recording to stop.";
    case "consent_yes":
      return "Consent confirmed. Recording will begin now.";
    case "consent_no":
      return "Understood. The recording was cancelled.";
    case "unknown":
      return "I did not catch that. Say Lantern, start recording, or Lantern, status report.";
    case "status_report":
      return "Preparing your status report.";
  }
}
