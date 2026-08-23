import { z } from "zod";

import type {
  InterestLevel,
  MeetingInsight,
  TranscriptSegment,
} from "./types";

const compactText = (label: string, maxLength = 240) =>
  z
    .string({ required_error: `${label} is required` })
    .trim()
    .min(1, `${label} cannot be empty`)
    .max(maxLength, `${label} must be ${maxLength} characters or fewer`);

/** Accepts either a calendar date or an RFC 3339 timestamp with an explicit zone. */
export const dueAtSchema = z
  .string()
  .refine(
    (value) =>
      /^\d{4}-\d{2}-\d{2}$/.test(value) ||
      /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?(?:Z|[+-]\d{2}:\d{2})$/.test(
        value,
      ),
    "dueAt must be YYYY-MM-DD or an RFC 3339 timestamp with a timezone",
  );

const transcriptSegmentObjectSchema = z
  .object({
    speaker: compactText("speaker", 80),
    text: compactText("transcript text", 50_000),
    startSeconds: z.number().finite().nonnegative().optional(),
    endSeconds: z.number().finite().nonnegative().optional(),
  })
  .strict();

export const transcriptSegmentSchema = transcriptSegmentObjectSchema.superRefine(
  (segment, context) => {
    if (
      segment.startSeconds !== undefined &&
      segment.endSeconds !== undefined &&
      segment.endSeconds < segment.startSeconds
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "endSeconds cannot be before startSeconds",
        path: ["endSeconds"],
      });
    }
  },
);

export const transcriptionResultSchema = z
  .object({
    text: compactText("transcript", 250_000),
    segments: z.array(transcriptSegmentSchema).min(1).max(10_000),
    language: compactText("language", 40),
    provider: z.enum(["elevenlabs", "groq", "fallback"]),
    warning: compactText("warning", 500).optional(),
  })
  .strict();

export const extractedParticipantSchema = z
  .object({
    name: compactText("participant name", 120),
    company: compactText("participant company", 160).nullable(),
    role: compactText("participant role", 120).nullable(),
    email: z.string().trim().email().max(254).nullable(),
    phone: compactText("participant phone", 40).nullable(),
  })
  .strict();

export const extractedCommitmentSchema = z
  .object({
    ownerType: z.enum(["user", "contact"]),
    description: compactText("commitment description", 240),
    dueAt: dueAtSchema.nullable(),
    status: z.enum(["open", "completed"]),
  })
  .strict();

export const meetingInsightSchema = z
  .object({
    meetingType: compactText("meeting type", 80),
    intent: compactText("intent", 240),
    interestLevel: z.enum(["low", "medium", "high", "unknown"]),
    wants: compactText("wants", 240),
    concern: compactText("concern", 240),
    promised: compactText("promised", 240),
    next: compactText("next", 240),
    keyPoints: z.array(compactText("key point", 240)).max(8),
    commitments: z.array(extractedCommitmentSchema).max(20),
    detectedLanguage: compactText("detected language", 80),
  })
  .strict();

export const extractedFollowUpSchema = z
  .object({
    type: z.enum(["message", "email", "schedule", "call", "send_file"]),
    description: compactText("follow-up description", 240),
    dueAt: dueAtSchema.nullable(),
    draft: compactText("follow-up draft", 2_000).nullable(),
  })
  .strict();

/** The exact object requested from Qwen before provider metadata is attached. */
export const meetingExtractionSchema = z
  .object({
    insight: meetingInsightSchema,
    participants: z.array(extractedParticipantSchema).max(20),
    followUps: z.array(extractedFollowUpSchema).max(20),
  })
  .strict();

export const meetingExtractionResultSchema = meetingExtractionSchema
  .extend({
    provider: z.enum(["qwen", "fallback"]),
    warning: compactText("warning", 500).optional(),
  })
  .strict();

export const contactHintSchema = z
  .object({
    name: compactText("contact name", 120),
    company: compactText("contact company", 160).nullable().optional(),
    role: compactText("contact role", 120).nullable().optional(),
    email: z.string().trim().email().max(254).nullable().optional(),
    phone: compactText("contact phone", 40).nullable().optional(),
  })
  .strict();

export const extractionContextSchema = z
  .object({
    title: compactText("meeting title", 200).optional(),
    contactHint: contactHintSchema.optional(),
    outputLanguage: compactText("output language", 40).default("English"),
    referenceDate: z.string().datetime({ offset: true }).optional(),
    timezone: compactText("timezone", 80).optional(),
  })
  .strict();

export type TranscriptionResult = z.infer<typeof transcriptionResultSchema>;
export type ExtractedParticipant = z.infer<typeof extractedParticipantSchema>;
export type MeetingExtraction = z.infer<typeof meetingExtractionSchema>;
export type MeetingExtractionResult = z.infer<
  typeof meetingExtractionResultSchema
>;
export type ExtractionContext = z.input<typeof extractionContextSchema>;

// Compile-time compatibility checks with the shared domain types.
type AssertAssignable<T, U extends T> = U;
type _TranscriptCompatibility = AssertAssignable<
  TranscriptSegment,
  z.infer<typeof transcriptSegmentSchema>
>;
type _InsightCompatibility = AssertAssignable<
  MeetingInsight,
  z.infer<typeof meetingInsightSchema>
>;
type _InterestCompatibility = AssertAssignable<
  InterestLevel,
  z.infer<typeof meetingInsightSchema>["interestLevel"]
>;

/**
 * JSON Schema sent to Qwen's OpenAI-compatible strict structured-output mode.
 * Every property is required because strict providers reject optional properties;
 * absence is represented with null or an empty array.
 */
export const meetingExtractionJsonSchema = {
  type: "object",
  additionalProperties: false,
  required: ["insight", "participants", "followUps"],
  properties: {
    insight: {
      type: "object",
      additionalProperties: false,
      required: [
        "meetingType",
        "intent",
        "interestLevel",
        "wants",
        "concern",
        "promised",
        "next",
        "keyPoints",
        "commitments",
        "detectedLanguage",
      ],
      properties: {
        meetingType: { type: "string", minLength: 1, maxLength: 80 },
        intent: { type: "string", minLength: 1, maxLength: 240 },
        interestLevel: {
          type: "string",
          enum: ["low", "medium", "high", "unknown"],
        },
        wants: { type: "string", minLength: 1, maxLength: 240 },
        concern: { type: "string", minLength: 1, maxLength: 240 },
        promised: { type: "string", minLength: 1, maxLength: 240 },
        next: { type: "string", minLength: 1, maxLength: 240 },
        keyPoints: {
          type: "array",
          maxItems: 8,
          items: { type: "string", minLength: 1, maxLength: 240 },
        },
        commitments: {
          type: "array",
          maxItems: 20,
          items: {
            type: "object",
            additionalProperties: false,
            required: ["ownerType", "description", "dueAt", "status"],
            properties: {
              ownerType: { type: "string", enum: ["user", "contact"] },
              description: {
                type: "string",
                minLength: 1,
                maxLength: 240,
              },
              dueAt: {
                type: ["string", "null"],
                description:
                  "YYYY-MM-DD or an RFC 3339 timestamp with timezone; null if ambiguous",
              },
              status: { type: "string", enum: ["open", "completed"] },
            },
          },
        },
        detectedLanguage: { type: "string", minLength: 1, maxLength: 80 },
      },
    },
    participants: {
      type: "array",
      maxItems: 20,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["name", "company", "role", "email", "phone"],
        properties: {
          name: { type: "string", minLength: 1, maxLength: 120 },
          company: {
            type: ["string", "null"],
            description: "Company stated in the transcript, otherwise null",
          },
          role: {
            type: ["string", "null"],
            description: "Role stated in the transcript, otherwise null",
          },
          email: {
            type: ["string", "null"],
            description: "Valid stated email address, otherwise null",
          },
          phone: {
            type: ["string", "null"],
            description: "Stated phone number, otherwise null",
          },
        },
      },
    },
    followUps: {
      type: "array",
      maxItems: 20,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["type", "description", "dueAt", "draft"],
        properties: {
          type: {
            type: "string",
            enum: ["message", "email", "schedule", "call", "send_file"],
          },
          description: { type: "string", minLength: 1, maxLength: 240 },
          dueAt: {
            type: ["string", "null"],
            description:
              "YYYY-MM-DD or an RFC 3339 timestamp with timezone; null if ambiguous",
          },
          draft: {
            type: ["string", "null"],
            description: "A compact draft when appropriate, otherwise null",
          },
        },
      },
    },
  },
} as const;
