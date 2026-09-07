import type { TranscriptSegment } from "../types";

export function formatAudioTime(seconds: number): string {
  const total = Math.floor(clampPlaybackTime(seconds));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const remainder = total % 60;
  const shortTime = `${String(minutes).padStart(2, "0")}:${String(remainder).padStart(2, "0")}`;
  return hours > 0 ? `${hours}:${shortTime}` : shortTime;
}

/** An unavailable media duration must not prevent seeking to a known timestamp. */
export function clampPlaybackTime(seconds: number, duration?: number): number {
  const position = Number.isFinite(seconds) ? Math.max(0, seconds) : 0;
  return duration !== undefined && Number.isFinite(duration) && duration > 0
    ? Math.min(position, duration)
    : position;
}

/**
 * Return the original array index for the most recently started active segment.
 * Explicit ends preserve silence gaps. A missing end lasts until the next later
 * valid segment starts; the final segment without an end stays active afterward.
 * Invalid timestamps are ignored. Equal starts favor the later array entry.
 * Two candidates avoid sorting or quadratic scans during playback updates.
 */
export function activeTranscriptIndex(
  segments: TranscriptSegment[],
  time: number,
): number {
  if (!Number.isFinite(time) || time < 0) return -1;

  let latestStartedAt = -Infinity;
  let knownIndex = -1;
  let knownStart = -Infinity;
  let unknownIndex = -1;
  let unknownStart = -Infinity;

  segments.forEach((segment, index) => {
    const start = segment.startSeconds;
    const end = segment.endSeconds;
    if (
      start === undefined ||
      !Number.isFinite(start) ||
      start < 0 ||
      start > time ||
      (end !== undefined && (!Number.isFinite(end) || end < start))
    )
      return;

    latestStartedAt = Math.max(latestStartedAt, start);
    if (end === undefined) {
      if (start >= unknownStart) {
        unknownStart = start;
        unknownIndex = index;
      }
    } else if (time < end && start >= knownStart) {
      knownStart = start;
      knownIndex = index;
    }
  });

  if (
    unknownIndex !== -1 &&
    unknownStart === latestStartedAt &&
    (unknownStart > knownStart ||
      (unknownStart === knownStart && unknownIndex > knownIndex))
  )
    return unknownIndex;
  return knownIndex;
}
