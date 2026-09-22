import { env } from "@/lib/env";

function providerCode(body: string) {
  try {
    const decoded = JSON.parse(body) as { error?: { code?: unknown } };
    return typeof decoded.error?.code === "string" ? decoded.error.code : null;
  } catch {
    return null;
  }
}

type ChatAudioPayload = {
  choices?: Array<{
    message?: { audio?: { data?: unknown } };
  }>;
};

async function createChatAudioSpeech(
  input: string,
  apiKey: string,
  fetchImpl: typeof fetch,
  timeoutMs: number,
) {
  const models = ["gpt-audio-1.5", "gpt-audio-mini"];
  let failure = "";
  let status = 500;
  for (const model of models) {
    const response = await fetchImpl("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        authorization: `Bearer ${apiKey}`,
        "content-type": "application/json",
      },
      signal: AbortSignal.timeout(timeoutMs),
      body: JSON.stringify({
        model,
        store: false,
        modalities: ["text", "audio"],
        audio: { voice: "alloy", format: "pcm16" },
        messages: [
          {
            role: "developer",
            content:
              "Speak the user's supplied text exactly. Do not add, omit, paraphrase, or answer anything.",
          },
          { role: "user", content: input.slice(0, 4_096) },
        ],
      }),
    });
    const body = await response.text();
    status = response.status;
    if (!response.ok) {
      failure = body.slice(0, 300);
      if (response.status === 403 && providerCode(body) === "model_not_found") continue;
      break;
    }
    try {
      const payload = JSON.parse(body) as ChatAudioPayload;
      const data = payload.choices?.[0]?.message?.audio?.data;
      if (typeof data !== "string" || !data) throw new Error("Audio data is missing.");
      const pcm = Buffer.from(data, "base64");
      if (!pcm.length) throw new Error("Audio data is empty.");
      return new Response(pcm, {
        status: 200,
        headers: { "content-type": "audio/pcm" },
      });
    } catch {
      failure = "OpenAI audio output was invalid.";
      status = 502;
      break;
    }
  }
  throw new Error(
    `OpenAI audio speech failed (HTTP ${status})${failure ? `: ${failure}` : "."}`,
  );
}

export async function createOpenAISpeech(
  input: string,
  options: {
    apiKey?: string | null;
    model?: string;
    voice?: string;
    fetchImpl?: typeof fetch;
    timeoutMs?: number;
  } = {},
) {
  if (!input.trim() || input.length > 4096) throw new Error("Speech must contain 1 to 4096 characters; split long reports into pages.");
  const runtime = env();
  const apiKey = options.apiKey === undefined ? runtime.OPENAI_API_KEY : options.apiKey;
  if (!apiKey) {
    throw new Error("OpenAI speech is not configured. Add OPENAI_API_KEY.");
  }
  const requestedModel = options.model || runtime.OPENAI_SPEECH_MODEL;
  const requestedVoice = options.voice || runtime.OPENAI_SPEECH_VOICE;
  const attempts = [
    { model: requestedModel, voice: requestedVoice, instructions: true },
    ...(requestedModel === "tts-1"
      ? []
      : [{ model: "tts-1", voice: "alloy", instructions: false }]),
  ];
  let failure = "";
  let failureStatus = 500;
  let allSpeechModelsUnavailable = false;
  for (const [index, attempt] of attempts.entries()) {
    const body = {
      model: attempt.model,
      voice: attempt.voice,
      input: input.slice(0, 4_096),
      ...(attempt.instructions
        ? {
            instructions:
              "Speak warmly, clearly, and concisely as a calm wearable assistant. Use a natural Malaysian English cadence. Do not add words that are not in the input.",
          }
        : {}),
      response_format: "pcm",
      stream_format: "audio",
      speed: 1.08,
    };
    const response = await (options.fetchImpl || fetch)(
      "https://api.openai.com/v1/audio/speech",
      {
      method: "POST",
      headers: {
        authorization: `Bearer ${apiKey}`,
        "content-type": "application/json",
      },
      signal: AbortSignal.timeout(options.timeoutMs || 45_000),
      body: JSON.stringify(body),
      },
    );
    if (response.ok && response.body) return response;
    failure = (await response.text()).slice(0, 300);
    failureStatus = response.status;
    const canUseLegacyFallback =
      index < attempts.length - 1 &&
      response.status === 403 &&
      providerCode(failure) === "model_not_found";
    if (!canUseLegacyFallback) break;
    allSpeechModelsUnavailable = true;
  }
  if (
    allSpeechModelsUnavailable &&
    failureStatus === 403 &&
    providerCode(failure) === "model_not_found"
  ) {
    return createChatAudioSpeech(
      input,
      apiKey,
      options.fetchImpl || fetch,
      options.timeoutMs || 45_000,
    );
  }
  throw new Error(
    `OpenAI speech failed (HTTP ${failureStatus})${failure ? `: ${failure}` : "."}`,
  );
}
