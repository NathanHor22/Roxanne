import type { Meeting } from "@/lib/types";

export interface ArchivedLanternSession {
  id: string;
  started_at: string;
  capture_ended_at: string | null;
  recording_id: string;
  processing_error: string | null;
}

/**
 * Keep an archived hardware recording visible even when its AI processing did
 * not produce a transcript or a normal meetings row.
 */
export function archivedLanternSessionMeeting(
  session: ArchivedLanternSession,
  recordingUrl: string | null,
): Meeting {
  const started = Date.parse(session.started_at);
  const capturedEnd = session.capture_ended_at
    ? Date.parse(session.capture_ended_at)
    : Number.NaN;
  const endAt = Number.isFinite(capturedEnd) && capturedEnd > started
    ? new Date(capturedEnd).toISOString()
    : new Date(started + 1_000).toISOString();

  return {
    id: `hardware:${session.id}`,
    title: "Lantern recording",
    startAt: session.started_at,
    endAt,
    status: session.processing_error ? "failed" : "processing",
    source: "hardware",
    contacts: [],
    recordingId: session.recording_id,
    recordingUrl,
    transcript: [],
    insight: null,
    followUps: [],
  };
}
