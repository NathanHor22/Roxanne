export const devicePromptKinds = [
  "consent_request",
  "consent_success",
  "consent_failure",
  "wake_retry",
  "wake_failure",
  "command_error",
  "recording_uploading",
  "upload_complete",
  "session_error",
  "consent_error",
  "stop_error",
  "upload_error",
  "status_error",
  "local_recording",
  "processing_pending",
] as const;

export type DevicePromptKind = (typeof devicePromptKinds)[number];

const prompts: Record<DevicePromptKind, string> = {
  consent_request:
    "Recording requires consent. Do you consent to being recorded? Say yes or no.",
  consent_success:
    "Consent confirmed. Starting your recording.",
  consent_failure:
    "Consent was not given. Recording has not started. Please start another session.",
  wake_retry: "I did not catch that. Please try again.",
  wake_failure: "No command heard. Returning to ready.",
  command_error:
    "I couldn't understand the command. Tap or press to retry. Hold to cancel.",
  recording_uploading:
    "Recording stopped. Uploading now. Keep Quipus powered on.",
  upload_complete: "Recording uploaded. Session complete.",
  session_error:
    "I couldn't start the session. Tap or press to retry. Hold to cancel.",
  consent_error:
    "I couldn't verify consent. Tap or press to retry. Hold to cancel.",
  stop_error:
    "I couldn't close the recording session. Keep Quipus powered on. Tap or press to retry. Hold to cancel.",
  upload_error:
    "Upload paused. Keep Quipus powered on. Tap or press to retry. Hold to cancel.",
  status_error:
    "I couldn't load your status report. Tap or press to retry.",
  local_recording:
    "Live transcription is unavailable. Recording locally.",
  processing_pending:
    "Recording uploaded. Session complete. Your summary is still processing.",
};

export function devicePrompt(kind: DevicePromptKind) {
  return prompts[kind];
}
