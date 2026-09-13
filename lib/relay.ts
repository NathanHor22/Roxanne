import { z } from "zod";

import type { Meeting } from "./types";
import { isConversation } from "./workspace/model";

export const relayResearchSourceSchema = z
  .object({
    company: z.string().trim().min(1).max(160),
    title: z.string().trim().min(1).max(300),
    url: z.string().url().max(2_000),
    snippet: z.string().trim().min(1).max(1_200),
    publishedDate: z.string().trim().max(80).nullable(),
  })
  .strict();

export type RelayResearchSource = z.infer<typeof relayResearchSourceSchema>;

export const relayConversationSchema = z
  .object({
    conversationId: z.string().min(1).max(160),
    contactId: z.string().min(1).max(160),
    name: z.string().min(1).max(160),
    company: z.string().min(1).max(160).nullable(),
    role: z.string().min(1).max(160).nullable(),
    email: z.string().email().nullable(),
    occurredAt: z.string().datetime({ offset: true }),
    needs: z.array(z.string().min(1).max(500)).max(12),
    offers: z.array(z.string().min(1).max(500)).max(12),
    evidence: z
      .array(
        z
          .object({
            kind: z.enum(["transcript", "memory"]),
            text: z.string().min(1).max(2_000),
          })
          .strict(),
      )
      .min(1)
      .max(30),
  })
  .strict();

export type RelayConversation = z.infer<typeof relayConversationSchema>;

export const relayModelMatchSchema = z
  .object({
    primaryConversationId: z.string().min(1).max(160),
    secondaryConversationId: z.string().min(1).max(160),
    primaryContactId: z.string().min(1).max(160),
    secondaryContactId: z.string().min(1).max(160),
    score: z.number().int().min(0).max(100),
    headline: z.string().trim().min(1).max(160),
    reason: z.string().trim().min(1).max(800),
    primaryNeed: z.string().trim().min(1).max(500),
    secondaryOffer: z.string().trim().min(1).max(500),
    primaryEvidence: z.string().trim().min(8).max(2_000),
    secondaryEvidence: z.string().trim().min(8).max(2_000),
    suggestedAction: z.string().trim().min(1).max(500),
  })
  .strict();

export const relayModelOutputSchema = z
  .object({
    matches: z.array(relayModelMatchSchema).max(4),
  })
  .strict();

export const relayModelOutputJsonSchema = {
  type: "object",
  additionalProperties: false,
  required: ["matches"],
  properties: {
    matches: {
      type: "array",
      maxItems: 4,
      items: {
        type: "object",
        additionalProperties: false,
        required: [
          "primaryConversationId",
          "secondaryConversationId",
          "primaryContactId",
          "secondaryContactId",
          "score",
          "headline",
          "reason",
          "primaryNeed",
          "secondaryOffer",
          "primaryEvidence",
          "secondaryEvidence",
          "suggestedAction",
        ],
        properties: {
          primaryConversationId: { type: "string" },
          secondaryConversationId: { type: "string" },
          primaryContactId: { type: "string" },
          secondaryContactId: { type: "string" },
          score: { type: "integer", minimum: 0, maximum: 100 },
          headline: { type: "string" },
          reason: { type: "string" },
          primaryNeed: { type: "string" },
          secondaryOffer: { type: "string" },
          primaryEvidence: { type: "string" },
          secondaryEvidence: { type: "string" },
          suggestedAction: { type: "string" },
        },
      },
    },
  },
} as const;

const relayPartySchema = z
  .object({
    conversationId: z.string().min(1).max(160),
    contactId: z.string().min(1).max(160),
    name: z.string().min(1).max(160),
    company: z.string().min(1).max(160).nullable(),
    role: z.string().min(1).max(160).nullable(),
    email: z.string().email().nullable(),
  })
  .strict();

export const relayMatchSchema = z
  .object({
    id: z.string().min(1).max(200),
    pairKey: z.string().regex(/^[a-f0-9]{64}$/u),
    eventName: z.string().trim().min(1).max(160),
    venue: z.string().trim().min(1).max(200),
    primary: relayPartySchema,
    secondary: relayPartySchema,
    score: z.number().int().min(0).max(100),
    headline: z.string().trim().min(1).max(160),
    reason: z.string().trim().min(1).max(800),
    primaryNeed: z.string().trim().min(1).max(500),
    secondaryOffer: z.string().trim().min(1).max(500),
    primaryEvidence: z.string().trim().min(8).max(2_000),
    secondaryEvidence: z.string().trim().min(8).max(2_000),
    suggestedAction: z.string().trim().min(1).max(500),
    sources: z.array(relayResearchSourceSchema).max(12),
    status: z.enum(["pending", "dismissed", "scheduled"]),
    provider: z.enum(["openai", "sample"]),
    model: z.string().trim().min(1).max(120),
    createdAt: z.string().datetime({ offset: true }),
  })
  .strict();

export type RelayMatch = z.infer<typeof relayMatchSchema>;

export function relayCalendarApprovalMatches(
  match: RelayMatch,
  input: { attendees: readonly string[]; meetingId?: string },
) {
  if (match.status === "dismissed") return false;
  const expected = [match.primary.email, match.secondary.email]
    .filter((email): email is string => Boolean(email))
    .sort();
  const submitted = [...input.attendees].sort();
  return (
    expected.length === 2 &&
    submitted.length === 2 &&
    expected.every((email, index) => email === submitted[index]) &&
    input.meetingId === match.primary.conversationId
  );
}

function compact(values: Array<string | null | undefined>, limit = 12) {
  return [...new Set(values.map((value) => value?.trim()).filter(Boolean) as string[])].slice(
    0,
    limit,
  );
}

/** Converts saved conversation memory into the minimum DTO sent to providers. */
export function buildRelayConversations(
  meetings: readonly Meeting[],
  limit = 12,
): RelayConversation[] {
  return meetings
    .filter(
      (meeting) =>
        meeting.status === "ready" &&
        isConversation(meeting) &&
        Boolean(meeting.contacts[0]) &&
        Boolean(meeting.insight),
    )
    .sort((a, b) => Date.parse(b.startAt) - Date.parse(a.startAt))
    .slice(0, limit)
    .map((meeting) => {
      const contact = meeting.contacts[0]!;
      const insight = meeting.insight!;
      const transcriptEvidence = (meeting.transcript || [])
        .filter((segment) => segment.text.trim())
        .slice(0, 24)
        .map((segment) => ({
          kind: "transcript" as const,
          text: segment.text.trim(),
        }));
      const memoryEvidence = compact([
        insight.wants,
        insight.concern,
        insight.promised,
        insight.next,
        ...insight.keyPoints,
      ]).map((text) => ({ kind: "memory" as const, text }));

      return relayConversationSchema.parse({
        conversationId: meeting.id,
        contactId: contact.id,
        name: contact.name,
        company: contact.company || null,
        role: contact.role || null,
        email: contact.email || null,
        occurredAt: meeting.startAt,
        needs: compact([
          insight.wants,
          insight.concern,
          insight.next,
          ...insight.keyPoints,
        ]),
        offers: compact([
          insight.promised,
          ...insight.commitments.map((item) => item.description),
        ]),
        evidence: [...transcriptEvidence, ...memoryEvidence].slice(0, 30),
      });
    });
}

export function normalizedEvidence(value: string) {
  return value.replace(/\s+/gu, " ").trim().toLocaleLowerCase("en");
}

export function evidenceBelongsTo(
  evidence: string,
  conversation: RelayConversation,
) {
  const expected = normalizedEvidence(evidence);
  return conversation.evidence.some(
    (entry) => normalizedEvidence(entry.text) === expected,
  );
}

export function sampleRelayMatches(
  meetings: readonly Meeting[],
  now = new Date(),
): RelayMatch[] {
  const conversations = buildRelayConversations(meetings);
  const chung = conversations.find((item) => item.contactId === "sample:chung");
  const aisyah = conversations.find(
    (item) => item.contactId === "sample:aisyah",
  );
  if (!chung || !aisyah) return [];

  return [
    {
      id: "sample:relay:chung-aisyah",
      pairKey: "7a2ad687e317c28e7116567ff8b965711195f7ef32a180db062430629eebfae6",
      eventName: "AITKL · Agents, Everywhere",
      venue: "WORQ Bangsar",
      primary: {
        conversationId: aisyah.conversationId,
        contactId: aisyah.contactId,
        name: aisyah.name,
        company: aisyah.company,
        role: aisyah.role,
        email: aisyah.email,
      },
      secondary: {
        conversationId: chung.conversationId,
        contactId: chung.contactId,
        name: chung.name,
        company: chung.company,
        role: chung.role,
        email: chung.email,
      },
      score: 88,
      headline: "A practical multi-site rollout exchange",
      reason:
        "Aisyah is coordinating three outlet launches while Mr Chung is designing a two-branch pilot around operating-hour constraints. A focused introduction could help both compare rollout sequencing and disruption controls.",
      primaryNeed: "One reliable rollout approach across three new outlets.",
      secondaryOffer:
        "Direct experience planning a phased branch pilot around operating hours.",
      primaryEvidence: "Nusa is opening three new outlets this quarter.",
      secondaryEvidence:
        "Start with a pilot at the Bangsar and PJ branches.",
      suggestedAction:
        "Arrange a 30-minute introduction to exchange rollout lessons and supplier requirements.",
      sources: [],
      status: "pending",
      provider: "sample",
      model: "sample",
      createdAt: now.toISOString(),
    },
  ];
}
