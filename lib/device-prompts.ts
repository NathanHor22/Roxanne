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
    "Understood. Device authenticated. Consent confirmed. Recording now.",
  consent_failure:
    "Authentication failed. Recording was not started. Please start another session.",
  wake_retry: "Verification failed. Please try again.",
  wake_failure: "Verification failed. Please verify yourself.",
  command_error:
    "I couldn't understand the command. Press the centre button to retry, or hold it to cancel.",
  recording_uploading:
    "Recording stopped. Uploading now. Keep Lantern powered on.",
  upload_complete: "Recording uploaded. Session complete.",
  session_error:
    "I couldn't start the session. Press the centre button to retry, or hold it to cancel.",
  consent_error:
    "I couldn't verify consent. Press the centre button to retry, or hold it to cancel.",
  stop_error:
    "I couldn't close the recording session. Keep Lantern powered on. Press the centre button to retry, or hold it to cancel.",
  upload_error:
    "Upload paused. Keep Lantern powered on. Press the centre button to retry, or hold it to cancel.",
  status_error:
    "I couldn't load your status report. Press the centre button to retry.",
  local_recording:
    "Live transcription is unavailable. Recording locally.",
  processing_pending:
    "Recording uploaded. Session complete. Your summary is still processing.",
};

export function devicePrompt(kind: DevicePromptKind) {
  return prompts[kind];
}
