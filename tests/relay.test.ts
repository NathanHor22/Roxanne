import assert from "node:assert/strict";
import test from "node:test";

import { researchCompanyWithExa } from "../lib/providers/exa";
import {
  findRelayMatchesWithOpenAI,
  relayPairKey,
} from "../lib/providers/openai-relay";
import {
  buildRelayConversations,
  relayCalendarApprovalMatches,
  relayMatchSchema,
  sampleRelayMatches,
  type RelayConversation,
} from "../lib/relay";
import { createSampleWorkspace } from "../lib/workspace/sample";

const conversations: RelayConversation[] = [
  {
    conversationId: "conversation-a",
    contactId: "contact-a",
    name: "Aisyah Rahman",
    company: "Nusa Retail",
    role: "Head of Operations",
    email: "aisyah@example.com",
    occurredAt: "2026-09-13T10:00:00+08:00",
    needs: ["A rollout approach for three outlets"],
    offers: ["Retail operations experience"],
    evidence: [
      {
        kind: "transcript",
        text: "Nusa is opening three new outlets this quarter.",
      },
    ],
  },
  {
    conversationId: "conversation-b",
    contactId: "contact-b",
    name: "Mr Chung",
    company: "Chung & Co.",
    role: "Managing Director",
    email: "chung@example.com",
    occurredAt: "2026-09-13T11:00:00+08:00",
    needs: ["A low-disruption pilot"],
    offers: ["Experience sequencing a branch pilot"],
    evidence: [
      {
        kind: "memory",
        text: "Start with a pilot at the Bangsar and PJ branches.",
      },
    ],
  },
];

function modelOutput(primaryEvidence = conversations[0].evidence[0].text) {
  return {
    matches: [
      {
        primaryConversationId: "conversation-a",
        secondaryConversationId: "conversation-b",
        primaryContactId: "contact-a",
        secondaryContactId: "contact-b",
        score: 88,
        headline: "Compare multi-site rollout lessons",
        reason: "One operator needs a rollout plan and the other has relevant pilot experience.",
        primaryNeed: "A rollout approach for three outlets",
        secondaryOffer: "Experience sequencing a branch pilot",
        primaryEvidence,
        secondaryEvidence: conversations[1].evidence[0].text,
        suggestedAction: "Review a 30-minute introduction.",
      },
    ],
  };
}

test("Relay compacts ready conversations and excludes unrelated meeting fields", () => {
  const workspace = createSampleWorkspace(new Date("2026-09-13T12:00:00+08:00"));
  workspace.meetings[0].recordingUrl = "https://private.example/audio.wav";
  const compact = buildRelayConversations(workspace.meetings);

  assert.equal(compact.length, 3);
  assert.equal(compact.some((item) => item.conversationId.startsWith("sample:event:")), false);
  assert.equal(compact[0].occurredAt >= compact[1].occurredAt, true);
  assert.equal("title" in compact[0], false);
  assert.equal("recordingUrl" in compact[0], false);
  assert.equal(JSON.stringify(compact).includes("private.example"), false);
});

test("sample Relay proposal remains valid and evidence-backed", () => {
  const workspace = createSampleWorkspace(new Date("2026-09-13T12:00:00+08:00"));
  const matches = sampleRelayMatches(
    workspace.meetings,
    new Date("2026-09-13T12:05:00+08:00"),
  );

  assert.equal(matches.length, 1);
  assert.equal(relayMatchSchema.safeParse(matches[0]).success, true);
  assert.equal(matches[0].pairKey.length, 64);
  assert.equal(matches[0].status, "pending");
  assert.equal(
    relayCalendarApprovalMatches(matches[0], {
      attendees: ["chung@example.com", "aisyah@example.com"],
      meetingId: matches[0].primary.conversationId,
    }),
    true,
  );
  assert.equal(
    relayCalendarApprovalMatches(matches[0], {
      attendees: ["attacker@example.com", "aisyah@example.com"],
      meetingId: matches[0].primary.conversationId,
    }),
    false,
  );
  assert.equal(
    relayCalendarApprovalMatches(
      { ...matches[0], status: "dismissed" },
      {
        attendees: ["chung@example.com", "aisyah@example.com"],
        meetingId: matches[0].primary.conversationId,
      },
    ),
    false,
  );
});

test("OpenAI Relay uses Responses structured output without storing or sending emails", async () => {
  let inspected = false;
  const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
    inspected = true;
    assert.equal(String(input), "https://api.openai.com/v1/responses");
    assert.equal((init?.headers as Record<string, string>).authorization, "Bearer openai-test-key");
    const body = JSON.parse(String(init?.body)) as {
      model: string;
      store: boolean;
      input: string;
      text: { format: { type: string; strict: boolean; schema: { additionalProperties: boolean } } };
    };
    assert.equal(body.model, "gpt-5.4-mini");
    assert.equal(body.store, false);
    assert.equal(body.text.format.type, "json_schema");
    assert.equal(body.text.format.strict, true);
    assert.equal(body.text.format.schema.additionalProperties, false);
    assert.equal(body.input.includes("aisyah@example.com"), false);
    assert.equal(body.input.includes("chung@example.com"), false);
    assert.equal(body.input.includes(conversations[0].evidence[0].text), true);

    return new Response(JSON.stringify({ output_text: JSON.stringify(modelOutput()) }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  }) as typeof fetch;

  const matches = await findRelayMatchesWithOpenAI(conversations, [], {
    apiKey: "openai-test-key",
    model: "gpt-5.4-mini",
    eventName: "Agents, Everywhere",
    venue: "WORQ Bangsar",
    fetchImpl,
    now: new Date("2026-09-13T12:00:00+08:00"),
    idFactory: () => "relay-test-id",
  });

  assert.equal(inspected, true);
  assert.equal(matches.length, 1);
  assert.equal(matches[0].primary.email, "aisyah@example.com");
  assert.equal(matches[0].secondary.email, "chung@example.com");
  assert.equal(matches[0].pairKey, relayPairKey("conversation-a", "conversation-b"));
  assert.equal(matches[0].provider, "openai");
});

test("OpenAI Relay rejects invented or partial evidence after schema validation", async () => {
  const fetchImpl = (async () =>
    new Response(
      JSON.stringify({
        output_text: JSON.stringify(modelOutput("three new outlets")),
      }),
      { status: 200 },
    )) as typeof fetch;

  await assert.rejects(
    () =>
      findRelayMatchesWithOpenAI(conversations, [], {
        apiKey: "openai-test-key",
        fetchImpl,
      }),
    /without valid conversation evidence/u,
  );
});

test("OpenAI Relay drops model proposals below the product confidence floor", async () => {
  const lowConfidence = modelOutput();
  lowConfidence.matches[0].score = 69;
  const fetchImpl = (async () =>
    new Response(
      JSON.stringify({ output_text: JSON.stringify(lowConfidence) }),
      { status: 200 },
    )) as typeof fetch;

  const matches = await findRelayMatchesWithOpenAI(conversations, [], {
    apiKey: "openai-test-key",
    fetchImpl,
  });

  assert.deepEqual(matches, []);
});

test("Exa receives only a company query and filters non-public result URLs", async () => {
  const privateTranscriptMarker = "DO-NOT-SEND-TRANSCRIPT-93f12";
  const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
    assert.equal(String(input), "https://api.exa.ai/search");
    assert.equal((init?.headers as Record<string, string>)["x-api-key"], "exa-test-key");
    const body = String(init?.body);
    assert.match(body, /Nusa Retail/u);
    assert.equal(body.includes(privateTranscriptMarker), false);
    return new Response(
      JSON.stringify({
        results: [
          {
            title: "Nusa Retail expansion",
            url: "https://example.com/nusa-expansion",
            summary: "Nusa Retail publicly announced an outlet expansion plan.",
            publishedDate: "2026-09-01",
          },
          {
            title: "Unsafe",
            url: "javascript:alert(1)",
            summary: "This result must be removed.",
          },
        ],
      }),
      { status: 200 },
    );
  }) as typeof fetch;

  const sources = await researchCompanyWithExa("Nusa Retail", {
    apiKey: "exa-test-key",
    fetchImpl,
  });

  assert.equal(sources.length, 1);
  assert.equal(sources[0].url, "https://example.com/nusa-expansion");
  assert.equal(sources[0].company, "Nusa Retail");
});

test("Exa is optional and performs no request without a key", async () => {
  let called = false;
  const sources = await researchCompanyWithExa("Nusa Retail", {
    apiKey: null,
    fetchImpl: (async () => {
      called = true;
      throw new Error("should not run");
    }) as typeof fetch,
  });

  assert.deepEqual(sources, []);
  assert.equal(called, false);
});
