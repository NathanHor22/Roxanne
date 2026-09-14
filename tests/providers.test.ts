import assert from "node:assert/strict";
import test from "node:test";

import {
  meetingExtractionSchema,
  transcriptSegmentSchema,
} from "../lib/meeting-schema";
import {
  ElevenLabsProviderError,
  transcribeAudio,
} from "../lib/providers/elevenlabs";
import { transcribeWithGroq } from "../lib/providers/groq-transcription";
import {
  OpenAITranscriptionProviderError,
  transcribeWithOpenAI,
} from "../lib/providers/openai-transcription";
import {
  FALLBACK_EXTRACTION_WARNING,
  FALLBACK_TRANSCRIPTION_WARNING,
  createFallbackMeetingExtraction,
} from "../lib/providers/fallback";
import {
  QwenProviderError,
  extractMeetingInsights,
  parseQwenMeetingExtraction,
} from "../lib/providers/qwen";

function validExtraction() {
  return {
    insight: {
      meetingType: "Sales",
      intent: "Evaluate procurement automation",
      interestLevel: "high" as const,
      wants: "A procurement automation pilot",
      concern: "ERP integration",
      promised: "Send revised pricing by Friday",
      next: "Schedule a demo next Thursday",
      keyPoints: ["Pilot requested", "ERP integration must be supported"],
      commitments: [
        {
          ownerType: "user" as const,
          description: "Send revised pricing",
          dueAt: "2026-08-28",
          status: "open" as const,
        },
      ],
      detectedLanguage: "English + Bahasa Malaysia",
    },
    participants: [
      {
        name: "James Tan",
        company: "Acme Manufacturing",
        role: null,
        email: "james@example.com",
        phone: null,
      },
    ],
    followUps: [
      {
        type: "send_file" as const,
        description: "Send revised pricing",
        dueAt: "2026-08-28",
        draft: null,
      },
    ],
  };
}

test("meeting schemas reject unknown keys and invalid timing", () => {
  assert.equal(
    meetingExtractionSchema.safeParse({ ...validExtraction(), invented: true }).success,
    false,
  );
  assert.equal(
    transcriptSegmentSchema.safeParse({
      speaker: "Speaker 1",
      text: "Hello",
      startSeconds: 4,
      endSeconds: 2,
    }).success,
    false,
  );
});

test("credential-free transcription is deterministic and clearly labelled", async () => {
  const audio = new Blob(["not-real-audio"], { type: "audio/webm" });
  const first = await transcribeAudio(audio, { apiKey: null });
  const second = await transcribeAudio(audio, { apiKey: null });

  assert.deepEqual(first, second);
  assert.equal(first.provider, "fallback");
  assert.equal(first.warning, FALLBACK_TRANSCRIPTION_WARNING);
  assert.match(first.text, /James.+Acme/isu);
});

test("ElevenLabs fails closed without credentials in production", async () => {
  await assert.rejects(
    () =>
      transcribeAudio(new Blob(["audio"]), {
        apiKey: null,
        runtimeEnvironment: "production",
      }),
    (error: unknown) => {
      assert.ok(error instanceof ElevenLabsProviderError);
      assert.match(error.message, /ELEVENLABS_API_KEY/u);
      assert.doesNotMatch(error.message, /fixture|fallback/iu);
      return true;
    },
  );

  const local = await transcribeAudio(new Blob(["audio"]), {
    apiKey: null,
    runtimeEnvironment: "test",
  });
  assert.equal(local.provider, "fallback");
});

test("ElevenLabs sends multipart Scribe audio and groups diarized words", async () => {
  let inspected = false;
  const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
    inspected = true;
    assert.equal(String(input), "https://api.elevenlabs.io/v1/speech-to-text");
    assert.equal(init?.method, "POST");
    assert.equal((init?.headers as Record<string, string>)["xi-api-key"], "test-key");
    assert.equal((init?.headers as Record<string, string>)["Content-Type"], undefined);
    assert.ok(init?.body instanceof FormData);
    const form = init.body;
    assert.equal(form.get("model_id"), "scribe_v2");
    assert.equal(form.get("diarize"), "true");
    assert.equal(form.get("timestamps_granularity"), "word");
    assert.ok(form.get("file") instanceof Blob);

    return new Response(
      JSON.stringify({
        language_code: "en",
        language_probability: 0.99,
        text: "Hello, Nathan. Hi there.",
        words: [
          {
            text: "Hello",
            start: 0,
            end: 0.4,
            type: "word",
            speaker_id: "speaker_0",
          },
          {
            text: ",",
            start: 0.4,
            end: 0.45,
            type: "word",
            speaker_id: "speaker_0",
          },
          {
            text: "Nathan.",
            start: 0.46,
            end: 0.9,
            type: "word",
            speaker_id: "speaker_0",
          },
          {
            text: "Hi",
            start: 1.1,
            end: 1.3,
            type: "word",
            speaker_id: "speaker_1",
          },
          {
            text: "there.",
            start: 1.31,
            end: 1.7,
            type: "word",
            speaker_id: "speaker_1",
          },
        ],
      }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    );
  }) as typeof fetch;

  const result = await transcribeAudio(
    new Blob(["audio"], { type: "audio/webm" }),
    {
      apiKey: "test-key",
      modelId: "scribe_v2",
      fileName: "conversation.webm",
      fetchImpl,
    },
  );

  assert.equal(inspected, true);
  assert.equal(result.provider, "elevenlabs");
  assert.equal(result.language, "en");
  assert.deepEqual(result.segments, [
    {
      speaker: "Speaker 1",
      text: "Hello, Nathan.",
      startSeconds: 0,
      endSeconds: 0.9,
    },
    {
      speaker: "Speaker 2",
      text: "Hi there.",
      startSeconds: 1.1,
      endSeconds: 1.7,
    },
  ]);
});

test("configured ElevenLabs failures throw and never become fixture data", async () => {
  const fetchImpl = (async () =>
    new Response(JSON.stringify({ detail: "invalid test-secret" }), {
      status: 401,
    })) as typeof fetch;

  await assert.rejects(
    () =>
      transcribeAudio(new Blob(["audio"]), {
        apiKey: "test-secret",
        fetchImpl,
      }),
    (error: unknown) => {
      assert.ok(error instanceof ElevenLabsProviderError);
      assert.equal(error.status, 401);
      assert.doesNotMatch(error.message, /test-secret/u);
      assert.match(error.message, /\[redacted\]/u);
      return true;
    },
  );
});

test("Groq Whisper sends multipart audio and maps verbose segments", async () => {
  const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
    assert.equal(String(input), "https://api.groq.com/openai/v1/audio/transcriptions");
    assert.equal((init?.headers as Record<string, string>).authorization, "Bearer groq-key");
    assert.ok(init?.body instanceof FormData);
    assert.equal(init.body.get("model"), "whisper-large-v3-turbo");
    assert.equal(init.body.get("response_format"), "verbose_json");
    return new Response(
      JSON.stringify({
        text: "James wants a pilot.",
        language: "en",
        segments: [{ start: 0, end: 1.4, text: " James wants a pilot. " }],
      }),
      { status: 200 },
    );
  }) as typeof fetch;

  const result = await transcribeWithGroq(new Blob(["audio"]), {
    apiKey: "groq-key",
    modelId: "whisper-large-v3-turbo",
    fileName: "meeting.wav",
    fetchImpl,
  });

  assert.equal(result.provider, "groq");
  assert.equal(result.language, "en");
  assert.deepEqual(result.segments, [
    {
      speaker: "Speaker 1",
      text: "James wants a pilot.",
      startSeconds: 0,
      endSeconds: 1.4,
    },
  ]);
});

test("OpenAI fallback sends WAV audio and preserves diarized speakers", async () => {
  const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
    assert.equal(String(input), "https://api.openai.com/v1/audio/transcriptions");
    assert.equal((init?.headers as Record<string, string>).authorization, "Bearer openai-key");
    assert.ok(init?.body instanceof FormData);
    assert.equal(init.body.get("model"), "gpt-4o-transcribe-diarize");
    assert.equal(init.body.get("response_format"), "diarized_json");
    assert.equal(init.body.get("chunking_strategy"), "auto");
    assert.ok(init.body.get("file") instanceof Blob);
    return new Response(
      JSON.stringify({
        task: "transcribe",
        duration: 4.2,
        text: "Jumpa esok pukul satu. Boleh, confirm.",
        segments: [
          {
            type: "transcript.text.segment",
            id: "seg_001",
            start: 0,
            end: 2.1,
            text: "Jumpa esok pukul satu.",
            speaker: "A",
          },
          {
            type: "transcript.text.segment",
            id: "seg_002",
            start: 2.2,
            end: 4.2,
            text: "Boleh, confirm.",
            speaker: "B",
          },
        ],
      }),
      { status: 200 },
    );
  }) as typeof fetch;

  const result = await transcribeWithOpenAI(
    new Blob(["wav-audio"], { type: "audio/wav" }),
    {
      apiKey: "openai-key",
      modelId: "gpt-4o-transcribe-diarize",
      fileName: "lantern.wav",
      fetchImpl,
    },
  );

  assert.equal(result.provider, "openai");
  assert.equal(result.language, "multilingual");
  assert.deepEqual(result.segments, [
    {
      id: "seg_001",
      speaker: "Speaker A",
      text: "Jumpa esok pukul satu.",
      startSeconds: 0,
      endSeconds: 2.1,
    },
    {
      id: "seg_002",
      speaker: "Speaker B",
      text: "Boleh, confirm.",
      startSeconds: 2.2,
      endSeconds: 4.2,
    },
  ]);
});

test("OpenAI fallback reports a safe provider error code", async () => {
  const fetchImpl = (async () =>
    new Response(
      JSON.stringify({
        error: {
          message: "Sensitive provider detail must not be surfaced.",
          type: "invalid_request_error",
          code: "model_not_found",
        },
      }),
      { status: 403 },
    )) as typeof fetch;

  await assert.rejects(
    transcribeWithOpenAI(new Blob(["audio"]), {
      apiKey: "openai-key",
      fetchImpl,
    }),
    (error: unknown) => {
      assert.ok(error instanceof OpenAITranscriptionProviderError);
      assert.equal(error.status, 403);
      assert.equal(error.providerCode, "model_not_found");
      assert.equal(
        error.message,
        "OpenAI transcription failed with HTTP 403 (model_not_found).",
      );
      assert.ok(!error.message.includes("Sensitive provider detail"));
      return true;
    },
  );
});

test("OpenAI fallback uses standard transcription when diarization is unavailable", async () => {
  const requests: FormData[] = [];
  const fetchImpl = (async (_input: RequestInfo | URL, init?: RequestInit) => {
    assert.ok(init?.body instanceof FormData);
    requests.push(init.body);
    if (requests.length === 1) {
      return new Response(
        JSON.stringify({
          error: { type: "invalid_request_error", code: "model_not_found" },
        }),
        { status: 403 },
      );
    }
    return new Response(JSON.stringify({ text: "Jumpa esok pukul satu." }), {
      status: 200,
    });
  }) as typeof fetch;

  const result = await transcribeWithOpenAI(new Blob(["audio"]), {
    apiKey: "openai-key",
    modelId: "gpt-4o-transcribe-diarize",
    fetchImpl,
  });

  assert.equal(requests.length, 2);
  assert.equal(requests[0]?.get("model"), "gpt-4o-transcribe-diarize");
  assert.equal(requests[0]?.get("response_format"), "diarized_json");
  assert.equal(requests[1]?.get("model"), "gpt-transcribe");
  assert.equal(requests[1]?.get("response_format"), "json");
  assert.equal(requests[1]?.has("chunking_strategy"), false);
  assert.deepEqual(result.segments, [
    { speaker: "Conversation", text: "Jumpa esok pukul satu." },
  ]);
});

test("credential-free extraction uses deterministic transcript-derived rules", () => {
  const transcript = [
    {
      speaker: "Speaker 1",
      text: "Hi, I'm James from Acme Manufacturing. We're interested in a pilot.",
    },
    {
      speaker: "Speaker 1",
      text: "ERP integration is a concern. Please send pricing, then let's meet again next week.",
    },
  ];
  const first = createFallbackMeetingExtraction(transcript);
  const second = createFallbackMeetingExtraction(transcript);

  assert.deepEqual(first, second);
  assert.equal(first.provider, "fallback");
  assert.equal(first.warning, FALLBACK_EXTRACTION_WARNING);
  assert.equal(first.participants[0]?.name, "James");
  assert.equal(first.insight.concern.includes("ERP"), true);
  assert.equal(first.followUps.some((item) => item.type === "schedule"), true);
});

test("Qwen fails closed without credentials in production", async () => {
  await assert.rejects(
    () =>
      extractMeetingInsights("A real transcript", {}, {
        apiKey: null,
        runtimeEnvironment: "production",
      }),
    (error: unknown) => {
      assert.ok(error instanceof QwenProviderError);
      assert.match(error.message, /QWEN_API_KEY/u);
      assert.doesNotMatch(error.message, /fixture|fallback/iu);
      return true;
    },
  );

  const local = await extractMeetingInsights("A real transcript", {}, {
    apiKey: null,
    runtimeEnvironment: "test",
  });
  assert.equal(local.provider, "fallback");
});

test("Qwen uses strict OpenAI-compatible JSON Schema and validates its output", async () => {
  const extraction = validExtraction();
  let inspected = false;
  const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
    inspected = true;
    assert.equal(
      String(input),
      "https://dashscope-intl.aliyuncs.com/compatible-mode/v1/chat/completions",
    );
    assert.equal((init?.headers as Record<string, string>).Authorization, "Bearer qwen-key");
    const body = JSON.parse(String(init?.body)) as {
      response_format: {
        type: string;
        json_schema: { strict: boolean; schema: { additionalProperties: boolean } };
      };
      enable_thinking: boolean;
      messages: Array<{ content: string }>;
    };
    assert.equal(body.response_format.type, "json_schema");
    assert.equal(body.response_format.json_schema.strict, true);
    assert.equal(body.response_format.json_schema.schema.additionalProperties, false);
    assert.equal(body.enable_thinking, false);
    assert.match(body.messages[0].content, /Bahasa Malaysia.+Mandarin.+Cantonese.+Tamil/u);

    return new Response(
      JSON.stringify({
        choices: [
          {
            finish_reason: "stop",
            message: { content: JSON.stringify(extraction) },
          },
        ],
      }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    );
  }) as typeof fetch;

  const result = await extractMeetingInsights(
    "James wants a pilot. We will send pricing by Friday.",
    {
      outputLanguage: "ms",
      referenceDate: "2026-08-23T12:00:00+08:00",
    },
    { apiKey: "qwen-key", fetchImpl },
  );

  assert.equal(inspected, true);
  assert.equal(result.provider, "qwen");
  assert.deepEqual(result.insight, extraction.insight);
});

test("Qwen retries unsupported JSON Schema with JSON-object mode", async () => {
  let calls = 0;
  const fetchImpl = (async (_input: RequestInfo | URL, init?: RequestInit) => {
    calls += 1;
    const body = JSON.parse(String(init?.body)) as {
      response_format: { type: string };
    };
    if (calls === 1) {
      assert.equal(body.response_format.type, "json_schema");
      return new Response(
        JSON.stringify({ error: { message: "response_format json_schema is not supported" } }),
        { status: 400 },
      );
    }
    assert.equal(body.response_format.type, "json_object");
    return new Response(
      JSON.stringify({
        choices: [
          { finish_reason: "stop", message: { content: JSON.stringify(validExtraction()) } },
        ],
      }),
      { status: 200 },
    );
  }) as typeof fetch;

  const result = await extractMeetingInsights("A real transcript", {}, {
    apiKey: "qwen-key",
    fetchImpl,
  });

  assert.equal(calls, 2);
  assert.equal(result.provider, "qwen");
  assert.match(result.warning ?? "", /strict local validation/u);
});

test("strict Qwen parsing rejects hallucinated fields", () => {
  const invalid = {
    ...validExtraction(),
    insight: { ...validExtraction().insight, confidence: 0.99 },
  };
  assert.throws(
    () => parseQwenMeetingExtraction(JSON.stringify(invalid)),
    (error: unknown) => {
      assert.ok(error instanceof QwenProviderError);
      assert.match(error.message, /invalid meeting data/u);
      return true;
    },
  );
});

test("configured Qwen HTTP failures throw and never use local extraction", async () => {
  const fetchImpl = (async () =>
    new Response(JSON.stringify({ error: { message: "bad qwen-secret" } }), {
      status: 401,
    })) as typeof fetch;

  await assert.rejects(
    () =>
      extractMeetingInsights("James wants a pilot", {}, {
        apiKey: "qwen-secret",
        fetchImpl,
      }),
    (error: unknown) => {
      assert.ok(error instanceof QwenProviderError);
      assert.equal(error.status, 401);
      assert.doesNotMatch(error.message, /qwen-secret/u);
      assert.match(error.message, /\[redacted\]/u);
      return true;
    },
  );
});
