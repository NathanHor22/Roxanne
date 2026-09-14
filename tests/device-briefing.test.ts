import assert from "node:assert/strict";
import test from "node:test";

import {
  buildBootBriefing,
  buildStatusBriefing,
  localDateKey,
  ownerSpokenName,
} from "../lib/device-briefing";
import { createOpenAISpeech } from "../lib/providers/openai-speech";

test("builds an owner-specific boot briefing with bounded battery", () => {
  assert.equal(ownerSpokenName("Nathan Hor", "nathan@example.com"), "Nathan Hor");
  assert.equal(ownerSpokenName(null, "nigel.tan@example.com"), "nigel tan");
  assert.equal(
    buildBootBriefing({ ownerName: "Nathan Hor", batteryLevel: 140 }),
    "Lantern. Sector twenty eight fourteen online. Battery at 100 percent. Welcome, Nathan Hor.",
  );
});

test("builds a concise daily status report and flags approvals", () => {
  const speech = buildStatusBriefing({
    ownerName: "Nathan Hor",
    meetings: [
      {
        title: "Mr Chung \u00b7 Acme",
        keyPoints: ["They want a pricing proposal next week."],
        nextAction: "Send the deck.",
      },
    ],
    pendingApprovals: 1,
  });
  assert.match(speech, /Today you recorded 1 conversation\./);
  assert.match(speech, /Mr Chung, Acme/);
  assert.match(speech, /1 meeting approval is waiting in the dashboard/);
  assert.match(speech, /before an invitation is sent/);
});

test("uses the owner timezone for the status-report day", () => {
  assert.equal(localDateKey("2026-09-13T16:30:00.000Z", "Asia/Kuala_Lumpur"), "2026-09-14");
});

test("OpenAI speech requests streamable 24 kHz PCM without exposing its key", async () => {
  let request: Request | undefined;
  const response = await createOpenAISpeech("Lantern online.", {
    apiKey: "test-secret-key",
    fetchImpl: async (input, init) => {
      request = new Request(input, init);
      return new Response(new Uint8Array([0, 0, 1, 0]), {
        status: 200,
        headers: { "content-type": "application/octet-stream" },
      });
    },
  });
  assert.equal(request?.url, "https://api.openai.com/v1/audio/speech");
  assert.equal(request?.headers.get("authorization"), "Bearer test-secret-key");
  const body = JSON.parse(await request!.text()) as Record<string, unknown>;
  assert.equal(body.model, "gpt-4o-mini-tts");
  assert.equal(body.voice, "cedar");
  assert.equal(body.response_format, "pcm");
  assert.deepEqual([...new Uint8Array(await response.arrayBuffer())], [0, 0, 1, 0]);
});

test("OpenAI speech falls back to tts-1 PCM when the project cannot access the preferred model", async () => {
  const requests: Request[] = [];
  const response = await createOpenAISpeech("Status report.", {
    apiKey: "test-secret-key",
    fetchImpl: async (input, init) => {
      const request = new Request(input, init);
      requests.push(request);
      if (requests.length === 1) {
        return Response.json(
          { error: { code: "model_not_found", message: "not available" } },
          { status: 403 },
        );
      }
      return new Response(new Uint8Array([2, 0]), { status: 200 });
    },
  });
  assert.equal(requests.length, 2);
  const preferred = JSON.parse(await requests[0].text()) as Record<string, unknown>;
  const fallback = JSON.parse(await requests[1].text()) as Record<string, unknown>;
  assert.equal(preferred.model, "gpt-4o-mini-tts");
  assert.equal(fallback.model, "tts-1");
  assert.equal(fallback.voice, "alloy");
  assert.equal(fallback.response_format, "pcm");
  assert.equal("instructions" in fallback, false);
  assert.deepEqual([...new Uint8Array(await response.arrayBuffer())], [2, 0]);
});

test("OpenAI speech can use Chat Completions audio when speech models are unavailable", async () => {
  const requests: Request[] = [];
  const pcm = new Uint8Array([0, 1, 2, 3]);
  const response = await createOpenAISpeech("Lantern online.", {
    apiKey: "test-secret-key",
    fetchImpl: async (input, init) => {
      const request = new Request(input, init);
      requests.push(request);
      if (request.url.endsWith("/audio/speech")) {
        return Response.json(
          { error: { code: "model_not_found", message: "not available" } },
          { status: 403 },
        );
      }
      return Response.json({
        choices: [{ message: { audio: { data: Buffer.from(pcm).toString("base64") } } }],
      });
    },
  });
  assert.equal(requests.length, 3);
  assert.equal(requests[2].url, "https://api.openai.com/v1/chat/completions");
  const body = JSON.parse(await requests[2].text()) as Record<string, unknown>;
  assert.equal(body.model, "gpt-audio-1.5");
  assert.deepEqual(body.modalities, ["text", "audio"]);
  assert.deepEqual(body.audio, { voice: "alloy", format: "pcm16" });
  assert.deepEqual([...new Uint8Array(await response.arrayBuffer())], [...pcm]);
});
