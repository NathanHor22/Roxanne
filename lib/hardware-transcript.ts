import type { TranscriptSegment } from "@/lib/types";

interface Candidate {
  turnId?: string;
  speaker: string;
  text: string;
}

function cleanText(value: string) {
  return value.replace(/\s+/gu, " ").trim().slice(0, 50_000);
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" || typeof value === "number"
    ? String(value)
    : undefined;
}

function collect(value: unknown, inherited: { uid?: string; turnId?: string }, out: Candidate[]) {
  if (Array.isArray(value)) {
    for (const item of value) collect(item, inherited, out);
    return;
  }
  if (!value || typeof value !== "object") return;
  const record = value as Record<string, unknown>;
  const uid =
    asString(record.uid) ||
    asString(record.user_id) ||
    asString(record.userId) ||
    asString(record.publisher) ||
    inherited.uid;
  const turnId =
    asString(record.turn_id) || asString(record.turnId) || inherited.turnId;
  const directText = [record.text, record.transcript]
    .find((item): item is string => typeof item === "string" && Boolean(item.trim()));
  if (directText) {
    const text = cleanText(directText);
    if (text) out.push({ turnId, speaker: uid === "1000" ? "Lantern" : "You", text });
  }
  for (const child of Object.values(record)) {
    if (child !== directText) collect(child, { uid, turnId }, out);
  }
}

/** Converts newline-delimited Agora RTM payloads into final, de-duplicated turns. */
export function normalizeAgoraTranscript(raw: string): TranscriptSegment[] {
  const candidates: Candidate[] = [];
  for (const line of raw.split(/\r?\n/gu)) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      collect(JSON.parse(trimmed), {}, candidates);
    } catch {
      // Ignore non-JSON diagnostics; transcript RTM events are JSON.
    }
  }

  const byTurn = new Map<string, Candidate>();
  const withoutTurn: Candidate[] = [];
  for (const candidate of candidates) {
    if (!candidate.turnId) {
      if (!withoutTurn.some((item) => item.speaker === candidate.speaker && item.text === candidate.text)) {
        withoutTurn.push(candidate);
      }
      continue;
    }
    const key = `${candidate.speaker}:${candidate.turnId}`;
    const previous = byTurn.get(key);
    if (!previous || candidate.text.length >= previous.text.length) byTurn.set(key, candidate);
  }
  return [...byTurn.values(), ...withoutTurn]
    .filter((item) => item.text.length > 1)
    .slice(0, 500)
    .map(({ speaker, text }) => ({ speaker, text }));
}
