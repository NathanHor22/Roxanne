import { z } from "zod";

import { env } from "../env";
import {
  transcriptionResultSchema,
  type TranscriptionResult,
} from "../meeting-schema";

const OPENAI_TRANSCRIPTION_URL = "https://api.openai.com/v1/audio/transcriptions";
const DEFAULT_TIMEOUT_MS = 120_000;
const DIARIZATION_MODEL = "gpt-4o-transcribe-diarize";
const TRANSCRIPTION_FALLBACK_MODELS = [
  "gpt-transcribe",
  "gpt-4o-transcribe",
  "gpt-4o-mini-transcribe",
  "whisper-1",
] as const;

const openAIResponseSchema = z
  .object({
    // Diarized responses can contain valid segment text while leaving the
    // aggregate text field empty. Rebuild it from segments below.
    text: z.string().default(""),
    segments: z
      .array(
        z
          .object({
            id: z.string().optional(),
            start: z.number().finite().nonnegative(),
            end: z.number().finite().nonnegative(),
            text: z.string(),
            speaker: z.string().trim().min(1),
          })
          .passthrough(),
      )
      .optional(),
  })
  .passthrough();

export class OpenAITranscriptionProviderError extends Error {
  readonly status?: number;
  readonly providerCode?: string;

  constructor(
    message: string,
    options?: { status?: number; providerCode?: string; cause?: unknown },
  ) {
    super(message, { cause: options?.cause });
    this.name = "OpenAITranscriptionProviderError";
    this.status = options?.status;
    this.providerCode = options?.providerCode;
  }
}

function readProviderErrorCode(body: string) {
  try {
    const decoded = JSON.parse(body) as { error?: { code?: unknown; type?: unknown } };
    const candidate = decoded.error?.code ?? decoded.error?.type;
    if (typeof candidate !== "string") return undefined;
    const safeCode = candidate.trim().slice(0, 80);
    return /^[a-zA-Z0-9._-]+$/u.test(safeCode) ? safeCode : undefined;
  } catch {
    return undefined;
  }
}

function createTranscriptionForm(
  audio: Blob,
  fileName: string,
  model: string,
  prompt?: string,
) {
  const form = new FormData();
  form.append("file", audio, fileName || "lantern.wav");
  form.append("model", model);
  if (model === DIARIZATION_MODEL) {
    form.append("response_format", "diarized_json");
    form.append("chunking_strategy", "auto");
  } else {
    form.append("response_format", "json");
    const guidance = prompt?.trim().slice(0, 1_000);
    if (guidance) form.append("prompt", guidance);
  }
  return form;
}

export async function transcribeWithOpenAI(
  audio: Blob,
  options: {
    fileName?: string;
    timeoutMs?: number;
    signal?: AbortSignal;
    fetchImpl?: typeof fetch;
    apiKey?: string | null;
    modelId?: string;
    prompt?: string;
  } = {},
): Promise<TranscriptionResult> {
  const runtime = env();
  const apiKey =
    options.apiKey === undefined
      ? runtime.OPENAI_API_KEY?.trim()
      : options.apiKey?.trim();
  if (!apiKey) {
    throw new OpenAITranscriptionProviderError(
      "OpenAI transcription is not configured. Set OPENAI_API_KEY.",
    );
  }
  if (!(audio instanceof Blob) || audio.size === 0) {
    throw new OpenAITranscriptionProviderError(
      "OpenAI transcription requires a non-empty audio recording.",
    );
  }

  const controller = new AbortController();
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const abortFromCaller = () => controller.abort(options.signal?.reason);
  if (options.signal?.aborted) abortFromCaller();
  else options.signal?.addEventListener("abort", abortFromCaller, { once: true });

  const fileName = (options.fileName || "lantern.wav")
    .replace(/[\r\n"\\/]/gu, "_")
    .slice(0, 180);
  const requestedModel =
    options.modelId?.trim() || runtime.OPENAI_TRANSCRIPTION_MODEL;
  const models = [
    requestedModel,
    ...TRANSCRIPTION_FALLBACK_MODELS.filter((model) => model !== requestedModel),
  ];

  let body = "";
  try {
    for (const [index, model] of models.entries()) {
      let response: Response;
      try {
        response = await (options.fetchImpl ?? fetch)(OPENAI_TRANSCRIPTION_URL, {
          method: "POST",
          headers: { authorization: `Bearer ${apiKey}` },
          body: createTranscriptionForm(audio, fileName, model, options.prompt),
          signal: controller.signal,
        });
      } catch (error) {
        throw new OpenAITranscriptionProviderError(
          controller.signal.aborted
            ? `OpenAI transcription timed out after ${timeoutMs}ms.`
            : "Could not reach OpenAI transcription.",
          { cause: error },
        );
      }

      body = await response.text();
      if (response.ok) break;

      const providerCode = readProviderErrorCode(body);
      const canTryAnotherModel =
        index < models.length - 1 &&
        response.status === 403 &&
        providerCode === "model_not_found";
      if (canTryAnotherModel) continue;

      throw new OpenAITranscriptionProviderError(
        `OpenAI transcription failed with HTTP ${response.status}${
          providerCode ? ` (${providerCode})` : ""
        }.`,
        { status: response.status, providerCode },
      );
    }
  } finally {
    clearTimeout(timer);
    options.signal?.removeEventListener("abort", abortFromCaller);
  }

  let decoded: unknown;
  try {
    decoded = JSON.parse(body);
  } catch (error) {
    throw new OpenAITranscriptionProviderError(
      "OpenAI returned a non-JSON transcription response.",
      { cause: error },
    );
  }
  const parsed = openAIResponseSchema.safeParse(decoded);
  if (!parsed.success) {
    throw new OpenAITranscriptionProviderError(
      "OpenAI returned an invalid diarized transcription response.",
      { cause: parsed.error },
    );
  }

  const segments = (parsed.data.segments ?? [])
    .filter((segment) => segment.text.trim())
    .map((segment) => ({
      ...(segment.id ? { id: segment.id } : {}),
      speaker: `Speaker ${segment.speaker}`,
      text: segment.text.trim(),
      startSeconds: segment.start,
      endSeconds: segment.end,
    }));
  const text =
    parsed.data.text.trim() ||
    segments.map((segment) => segment.text).join(" ").trim();
  if (!text) {
    throw new OpenAITranscriptionProviderError(
      "OpenAI did not detect speech in this recording.",
    );
  }

  return transcriptionResultSchema.parse({
    text,
    segments: segments.length
      ? segments
      : [{ speaker: "Conversation", text }],
    language: "multilingual",
    provider: "openai",
  });
}
