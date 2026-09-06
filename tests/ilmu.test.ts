import assert from "node:assert/strict";
import test from "node:test";

import type { MeetingExtraction } from "../lib/meeting-schema";
import { extractWithIlmu } from "../lib/providers/ilmu";
import type { TranscriptSegment } from "../lib/types";

const transcript: TranscriptSegment[] = [
  { speaker: "Unknown speaker", text: "Kita start with a pilot in Bangsar dulu. Maybe Friday afternoon?", startSeconds: 10, endSeconds: 20 },
  { speaker: "Mr Chung", text: "Actually Thursday at one works. Confirmed, forty-five minutes. Send it to chung@example.com.", startSeconds: 22, endSeconds: 34 },
];
const context = {
  title: "Chung pilot discussion",
  outputLanguage: "English",
  referenceDate: "2026-09-06T10:00:00+08:00",
  timezone: "Asia/Kuala_Lumpur",
};
const options = { apiKey: "test-only-ilmu-key", model: "test-ilmu-model" };

function extractionFixture(): MeetingExtraction {
  return {
    insight: {
      meetingType: "Client conversation",
      intent: "Plan a pilot at the Bangsar branch.",
      interestLevel: "high",
      wants: "Start with a single branch.",
      concern: "Not stated.",
      promised: "Send the follow-up invitation after approval.",
      next: "Review the agreed follow-up meeting.",
      keyPoints: ["Start the pilot at the Bangsar branch."],
      commitments: [],
      detectedLanguage: "English and Bahasa Malaysia",
    },
    participants: [{
      name: "Mr Chung", company: null, role: null,
      email: "chung@example.com", phone: null,
    }],
    followUps: [{
      type: "schedule",
      description: "Pilot review with Mr Chung",
      dueAt: "2026-09-10T13:00:00+08:00",
      draft: null,
      schedule: {
        agreement: "agreed",
        startAt: "2026-09-10T13:00:00+08:00",
        durationMinutes: 45,
        attendees: ["chung@example.com"],
        location: null,
        evidence: "Actually Thursday at one works. Confirmed, forty-five minutes.",
      },
    }],
  };
}

function modelResponse(content: unknown, finishReason = "stop") {
  return Response.json({
    choices: [{
      finish_reason: finishReason,
      message: { content: typeof content === "string" ? content : JSON.stringify(content) },
    }],
  });
}

test("Ilmu sends the supplied conversation time and unknown speakers with a strict schedule schema", async () => {
  let calls = 0;
  const fetchImpl: typeof fetch = async (url, init) => {
    calls += 1;
    assert.equal(url, "https://api.ilmu.ai/v1/chat/completions");
    assert.equal(init?.method, "POST");
    assert.equal(new Headers(init?.headers).get("authorization"), "Bearer test-only-ilmu-key");
    assert.ok(init?.signal);
    const request = JSON.parse(String(init?.body));
    assert.equal(request.model, "test-ilmu-model");
    assert.equal(request.response_format.type, "json_schema");
    assert.equal(request.response_format.json_schema.strict, true);
    const followUpSchema = request.response_format.json_schema.schema.properties.followUps.items;
    assert.equal(followUpSchema.additionalProperties, false);
    assert.ok(followUpSchema.required.includes("schedule"));
    assert.equal(followUpSchema.properties.schedule.additionalProperties, false);
    assert.ok(followUpSchema.properties.schedule.required.includes("evidence"));
    assert.match(request.messages[0].content, /untrusted data/u);
    assert.match(request.messages[0].content, /later corrections/u);
    assert.deepEqual(JSON.parse(request.messages[1].content), { context, transcript });
    return modelResponse(extractionFixture());
  };

  const result = await extractWithIlmu(transcript, context, { ...options, fetchImpl });
  assert.equal(calls, 1);
  assert.deepEqual(result, { ...extractionFixture(), provider: "ilmu" });
});

test("missing Ilmu credentials fail without a request or sample extraction", async () => {
  let calls = 0;
  const fetchImpl: typeof fetch = async () => {
    calls += 1;
    return modelResponse(extractionFixture());
  };
  await assert.rejects(
    () => extractWithIlmu(transcript, context, { apiKey: null, fetchImpl }),
    /Ilmu is not configured/u,
  );
  assert.equal(calls, 0);
});

test("provider errors, malformed output, and truncation fail without a fallback recap", async () => {
  const responses = [
    () => new Response("Unavailable", { status: 503 }),
    () => modelResponse("not JSON"),
    () => modelResponse({ insight: {} }),
    () => modelResponse(extractionFixture(), "length"),
    () => Response.json({ choices: [] }),
    () => { throw new Error("Network disconnected"); },
  ];
  for (const response of responses) {
    let calls = 0;
    const fetchImpl: typeof fetch = async () => {
      calls += 1;
      return response();
    };
    await assert.rejects(
      () => extractWithIlmu(transcript, context, { ...options, fetchImpl }),
    );
    assert.equal(calls, 1);
  }
});

test("a schedule needs an agreed state and a quote actually present in the supplied transcript", async () => {
  for (const patch of [
    { evidence: "Let's meet Monday at nine. Confirmed." },
    { evidence: null },
    { agreement: "tentative" as const },
    { evidence: "Maybe Friday afternoon? Actually Thursday at one works." },
  ]) {
    const fixture = extractionFixture();
    fixture.followUps[0]!.schedule = { ...fixture.followUps[0]!.schedule!, ...patch };
    await assert.rejects(
      () => extractWithIlmu(transcript, context, {
        ...options,
        fetchImpl: async () => modelResponse(fixture),
      }),
      /could not be verified against the transcript/u,
    );
  }
  const missingSchedule = extractionFixture();
  delete missingSchedule.followUps[0]!.schedule;
  await assert.rejects(
    () => extractWithIlmu(transcript, context, {
      ...options,
      fetchImpl: async () => modelResponse(missingSchedule),
    }),
    /could not be verified against the transcript/u,
  );
});

test("a verified agreement can retain missing details for review without inventing recipients or duration", async () => {
  const fixture = extractionFixture();
  fixture.followUps[0]!.schedule!.attendees = [];
  fixture.followUps[0]!.schedule!.durationMinutes = null;
  fixture.followUps[0]!.schedule!.startAt = null;
  const result = await extractWithIlmu(transcript, context, {
    ...options,
    fetchImpl: async () => modelResponse(fixture),
  });
  assert.deepEqual(result.followUps[0]?.schedule, fixture.followUps[0]?.schedule);
});

test("an ordinary follow-up may have no schedule and creates no meeting approval", async () => {
  const fixture = extractionFixture();
  fixture.followUps = [{
    type: "send_file", description: "Send the pilot quotation",
    dueAt: null, draft: null, schedule: null,
  }];
  const result = await extractWithIlmu(transcript, context, {
    ...options,
    fetchImpl: async () => modelResponse(fixture),
  });
  assert.equal(result.followUps[0]?.type, "send_file");
  assert.equal(result.followUps[0]?.schedule, null);
});
