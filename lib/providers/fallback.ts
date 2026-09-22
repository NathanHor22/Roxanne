import {
  extractionContextSchema,
  meetingExtractionResultSchema,
  transcriptionResultSchema,
  transcriptSegmentSchema,
  type ExtractedParticipant,
  type ExtractionContext,
  type MeetingExtractionResult,
  type TranscriptionResult,
} from "../meeting-schema";
import type { TranscriptSegment } from "../types";

export const FALLBACK_TRANSCRIPTION_WARNING =
  "ElevenLabs is not configured. This is a clearly labelled sample transcript, not a transcription of the uploaded audio.";

export const FALLBACK_EXTRACTION_WARNING =
  "Qwen is not configured. Insights were produced by Quipus's deterministic local rules and should be reviewed.";

const FALLBACK_SEGMENTS: TranscriptSegment[] = [
  {
    speaker: "Speaker 1",
    text: "Hi, I'm James from Acme Manufacturing. We're interested in a procurement automation pilot.",
    startSeconds: 0,
    endSeconds: 7.8,
  },
  {
    speaker: "Speaker 1",
    text: "ERP integration is our main concern. Please send the revised pricing by Friday, then let's meet again next Thursday.",
    startSeconds: 7.8,
    endSeconds: 17.2,
  },
];

export function createFallbackTranscription(): TranscriptionResult {
  const segments = FALLBACK_SEGMENTS.map((segment) => ({ ...segment }));

  return transcriptionResultSchema.parse({
    text: segments.map((segment) => segment.text).join(" "),
    segments,
    language: "English",
    provider: "fallback",
    warning: FALLBACK_TRANSCRIPTION_WARNING,
  });
}

function compact(value: string, maxLength = 240): string {
  const normalized = value.replace(/\s+/gu, " ").trim();
  if (normalized.length <= maxLength) return normalized;
  return `${normalized.slice(0, Math.max(1, maxLength - 1)).trimEnd()}…`;
}

function transcriptText(
  transcript: string | readonly TranscriptSegment[],
): { text: string; segments?: TranscriptSegment[] } {
  if (typeof transcript === "string") {
    const text = transcript.trim();
    if (!text) throw new Error("A non-empty transcript is required for extraction.");
    if (text.length > 250_000) {
      throw new Error("Transcript exceeds the 250,000 character processing limit.");
    }
    return { text };
  }

  const segments = transcript.map((segment) => transcriptSegmentSchema.parse(segment));
  if (segments.length === 0) {
    throw new Error("At least one transcript segment is required for extraction.");
  }
  const text = segments
    .map((segment) => `${segment.speaker}: ${segment.text}`)
    .join("\n")
    .trim();
  if (text.length > 250_000) {
    throw new Error("Transcript exceeds the 250,000 character processing limit.");
  }
  return { text, segments };
}

function splitSentences(text: string): string[] {
  return text
    .replace(/^\s*[^:\n]{1,80}:\s*/gmu, "")
    .split(/(?<=[.!?。！？])\s+|\n+/u)
    .map((sentence) => compact(sentence))
    .filter(Boolean);
}

function firstMatching(sentences: string[], pattern: RegExp): string | undefined {
  return sentences.find((sentence) => pattern.test(sentence));
}

function detectLanguage(text: string): string {
  const languages: string[] = [];
  if (/[\u0B80-\u0BFF]/u.test(text)) languages.push("Tamil");
  if (/[\u3400-\u9FFF]/u.test(text)) languages.push("Mandarin/Cantonese");
  if (
    /\b(?:saya|kami|awak|anda|nanti|dulu|boleh|mahu|nak|risau|mesyuarat|harga)\b/iu.test(
      text,
    )
  ) {
    languages.push("Bahasa Malaysia");
  }
  if (/[A-Za-z]/u.test(text)) languages.push("English");
  return [...new Set(languages)].join(" + ") || "Unknown";
}

function inferParticipants(
  text: string,
  context: ReturnType<typeof extractionContextSchema.parse>,
): ExtractedParticipant[] {
  if (context.contactHint) {
    return [
      {
        name: context.contactHint.name,
        company: context.contactHint.company ?? null,
        role: context.contactHint.role ?? null,
        email: context.contactHint.email ?? null,
        phone: context.contactHint.phone ?? null,
      },
    ];
  }

  const introduction = text.match(
    /\b(?:[Mm]y name is|[Ii]['’]?m|[Ii] am)\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)(?:\s+(?:from|at)\s+([A-Z][A-Za-z0-9&.-]*(?:\s+[A-Z][A-Za-z0-9&.-]*){0,3}))?/u,
  );
  if (!introduction?.[1]) return [];

  return [
    {
      name: introduction[1],
      company: introduction[2] ?? null,
      role: null,
      email: null,
      phone: null,
    },
  ];
}

function interestLevel(text: string): "low" | "medium" | "high" | "unknown" {
  if (
    /\b(?:very interested|strongly interested|keen|ready to proceed|let['’]?s proceed|berminat|setuju)\b|(?:很有兴趣|很有興趣|有兴趣|有興趣)/iu.test(
      text,
    )
  ) {
    return "high";
  }
  if (/\b(?:not interested|decline|reject|tidak berminat)\b|(?:没兴趣|沒興趣)/iu.test(text)) {
    return "low";
  }
  if (/\b(?:interested|open to|consider|maybe|mungkin)\b/iu.test(text)) {
    return "medium";
  }
  return "unknown";
}

export function createFallbackMeetingExtraction(
  transcript: string | readonly TranscriptSegment[],
  rawContext: ExtractionContext = {},
): MeetingExtractionResult {
  const context = extractionContextSchema.parse(rawContext);
  const { text } = transcriptText(transcript);
  const sentences = splitSentences(text);

  const wants = firstMatching(
    sentences,
    /\b(?:want|need|looking for|interested|pilot|procurement|mahu|nak|perlukan|berminat)\b|(?:需要|想要|有兴趣|有興趣)/iu,
  );
  const concern = firstMatching(
    sentences,
    /\b(?:concern|worried|risk|issue|problem|integration|risau|bimbang|masalah)\b|(?:担心|擔心|问题|問題)/iu,
  );
  const promisedSentences = sentences.filter((sentence) =>
    /\b(?:send|share|provide|prepare|email|hantar|kongsi|sediakan|follow up|follow-up)\b|(?:发送|發送|提供)/iu.test(
      sentence,
    ),
  );
  const nextStep = firstMatching(
    sentences,
    /\b(?:meet again|next meeting|schedule|next week|next month|follow up|follow-up|jump on a call|mesyuarat|minggu depan)\b|(?:下周|下週|再见面|再見面)/iu,
  );

  const commitments = promisedSentences.slice(0, 6).map((description) => ({
    ownerType: /\b(?:i|we|saya|kami)\s+(?:will|can|shall|akan|boleh)\b/iu.test(
      description,
    )
      ? ("user" as const)
      : ("user" as const),
    description,
    dueAt: null,
    status: "open" as const,
  }));

  const followUps: Array<{
    type: "message" | "email" | "schedule" | "call" | "send_file";
    description: string;
    dueAt: null;
    draft: null;
  }> = [];

  for (const sentence of promisedSentences.slice(0, 3)) {
    const type = /\b(?:pricing|quotation|quote|deck|file|document)\b/iu.test(sentence)
      ? "send_file"
      : /\bemail\b/iu.test(sentence)
        ? "email"
        : "message";
    followUps.push({ type, description: sentence, dueAt: null, draft: null });
  }
  if (nextStep) {
    followUps.push({
      type: "schedule",
      description: nextStep,
      dueAt: null,
      draft: null,
    });
  }

  const keyPoints = [...new Set([wants, concern, ...promisedSentences, nextStep])]
    .filter((value): value is string => Boolean(value))
    .slice(0, 8);

  return meetingExtractionResultSchema.parse({
    insight: {
      meetingType: /\b(?:sell|sales|pricing|quotation|quote|pilot|procurement)\b/iu.test(
        text,
      )
        ? "Sales"
        : "Business conversation",
      intent: wants ?? compact(sentences[0] ?? "Review the conversation"),
      interestLevel: interestLevel(text),
      wants: wants ?? "Not identified",
      concern: concern ?? "Not identified",
      promised:
        promisedSentences.length > 0
          ? compact(promisedSentences.join("; "))
          : "No commitment identified",
      next: nextStep ?? "Review and confirm the next step",
      keyPoints,
      commitments,
      detectedLanguage: detectLanguage(text),
    },
    participants: inferParticipants(text, context),
    followUps,
    provider: "fallback",
    warning: FALLBACK_EXTRACTION_WARNING,
  });
}

export { transcriptText as normalizeTranscriptInput };
