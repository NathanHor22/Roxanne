import { z } from "zod";

import { env } from "../env";
import {
  transcriptionResultSchema,
  type TranscriptionResult,
} from "../meeting-schema";

const GROQ_TRANSCRIPTION_URL =
  "https://api.groq.com/openai/v1/audio/transcriptions";
const DEFAULT_TIMEOUT_MS = 120_000;

const groqResponseSchema = z
  .object({
    text: z.string().min(1),
    language: z.string().min(1).optional(),
    segments: z
      .array(
        z
          .object({
            start: z.number().finite().nonnegative().optional(),
            end: z.number().finite().nonnegative().optional(),
            text: z.string(),
          })
          .passthrough(),
      )
      .optional(),
  })
  .passthrough();

export class GroqTranscriptionProviderError extends Error {
  readonly status?: number;

  constructor(message: string, options?: { status?: number; cause?: unknown }) {
    super(message, { cause: options?.cause });
    this.name = "GroqTranscriptionProviderError";
    this.status = options?.status;
  }
}

export async function transcribeWithGroq(
  audio: Blob,
  options: {
    fileName?: string;
    languageCode?: string;
    timeoutMs?: number;
    signal?: AbortSignal;
    fetchImpl?: typeof fetch;
    apiKey?: string | null;
    modelId?: string;
  } = {},
): Promise<TranscriptionResult> {
  const runtime = env();
  const apiKey =
    options.apiKey === undefined
      ? runtime.GROQ_API_KEY?.trim()
      : options.apiKey?.trim();
  if (!apiKey) {
    throw new GroqTranscriptionProviderError(
      "Groq transcription is not configured. Set GROQ_API_KEY.",
    );
  }
  if (!(audio instanceof Blob) || audio.size === 0) {
    throw new GroqTranscriptionProviderError(
      "Groq transcription requires a non-empty audio recording.",
    );
  }

  const controller = new AbortController();
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const abortFromCaller = () => controller.abort(options.signal?.reason);
  if (options.signal?.aborted) abortFromCaller();
  else options.signal?.addEventListener("abort", abortFromCaller, { once: true });

  const fileName = (options.fileName || "recording.webm")
    .replace(/[\r\n"\\/]/gu, "_")
    .slice(0, 180);
  const form = new FormData();
  form.append("file", audio, fileName || "recording.webm");
  form.append("model", options.modelId?.trim() || runtime.GROQ_TRANSCRIPTION_MODEL);
  form.append("response_format", "verbose_json");
  form.append("temperature", "0");
  if (options.languageCode) form.append("language", options.languageCode);

  let response: Response;
  try {
    response = await (options.fetchImpl ?? fetch)(GROQ_TRANSCRIPTION_URL, {
      method: "POST",
      headers: { authorization: `Bearer ${apiKey}` },
      body: form,
      signal: controller.signal,
    });
  } catch (error) {
    throw new GroqTranscriptionProviderError(
      controller.signal.aborted
        ? `Groq transcription timed out after ${timeoutMs}ms.`
        : "Could not reach Groq transcription.",
      { cause: error },
    );
  } finally {
    clearTimeout(timer);
    options.signal?.removeEventListener("abort", abortFromCaller);
  }

  const body = await response.text();
  if (!response.ok) {
    throw new GroqTranscriptionProviderError(
      `Groq transcription failed with HTTP ${response.status}.`,
      { status: response.status },
    );
  }

  let decoded: unknown;
  try {
    decoded = JSON.parse(body);
  } catch (error) {
    throw new GroqTranscriptionProviderError(
      "Groq returned a non-JSON transcription response.",
      { cause: error },
    );
  }
  const parsed = groqResponseSchema.safeParse(decoded);
  if (!parsed.success) {
    throw new GroqTranscriptionProviderError(
      "Groq returned an invalid transcription response.",
      { cause: parsed.error },
    );
  }

  const segments = (parsed.data.segments ?? [])
    .filter((segment) => segment.text.trim())
    .map((segment) => ({
      speaker: "Speaker 1",
      text: segment.text.trim(),
      ...(segment.start !== undefined ? { startSeconds: segment.start } : {}),
      ...(segment.end !== undefined ? { endSeconds: segment.end } : {}),
    }));

  return transcriptionResultSchema.parse({
    text: parsed.data.text.trim(),
    segments: segments.length
      ? segments
      : [{ speaker: "Speaker 1", text: parsed.data.text.trim() }],
    language: parsed.data.language || "unknown",
    provider: "groq",
  });
}
