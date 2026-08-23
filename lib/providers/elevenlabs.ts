import { z } from "zod";

import { env } from "../env";
import {
  transcriptionResultSchema,
  type TranscriptionResult,
} from "../meeting-schema";
import type { TranscriptSegment } from "../types";
import { createFallbackTranscription } from "./fallback";

const ELEVENLABS_SPEECH_TO_TEXT_URL =
  "https://api.elevenlabs.io/v1/speech-to-text";
const DEFAULT_TIMEOUT_MS = 120_000;

const speechWordSchema = z
  .object({
    text: z.string(),
    start: z.number().finite().nonnegative().nullable().optional(),
    end: z.number().finite().nonnegative().nullable().optional(),
    type: z.string().min(1),
    speaker_id: z.string().min(1).nullable().optional(),
    channel_index: z.number().int().nonnegative().optional(),
  })
  .passthrough();

const speechToTextResponseSchema = z
  .object({
    language_code: z.string().min(1).nullable(),
    language_probability: z.number().min(0).max(1).nullable().optional(),
    text: z.string(),
    words: z.array(speechWordSchema).nullable().optional(),
  })
  .passthrough();

export interface TranscribeAudioOptions {
  /** Let Scribe auto-detect when omitted; accepts ISO-639-1/3 codes. */
  languageCode?: string;
  fileName?: string;
  numSpeakers?: number;
  timeoutMs?: number;
  signal?: AbortSignal;
  /** Server-side test/config override. null simulates missing configuration. */
  apiKey?: string | null;
  /** Test hook for exercising production fail-closed behavior without mutating process.env. */
  runtimeEnvironment?: string;
  modelId?: string;
  fetchImpl?: typeof fetch;
}

export class ElevenLabsProviderError extends Error {
  readonly status?: number;

  constructor(message: string, options?: { status?: number; cause?: unknown }) {
    super(message, { cause: options?.cause });
    this.name = "ElevenLabsProviderError";
    this.status = options?.status;
  }
}

function cleanFilename(name: string): string {
  const safe = name.replace(/[\r\n"\\/]/gu, "_").trim();
  return safe.slice(0, 180) || "recording.webm";
}

function validateOptions(options: TranscribeAudioOptions): void {
  if (
    options.languageCode !== undefined &&
    !/^[a-z]{2,3}(?:-[A-Z]{2})?$/u.test(options.languageCode)
  ) {
    throw new ElevenLabsProviderError(
      "ElevenLabs languageCode must be a valid ISO-639-1 or ISO-639-3 code.",
    );
  }
  if (
    options.numSpeakers !== undefined &&
    (!Number.isInteger(options.numSpeakers) ||
      options.numSpeakers < 1 ||
      options.numSpeakers > 32)
  ) {
    throw new ElevenLabsProviderError(
      "ElevenLabs numSpeakers must be an integer from 1 to 32.",
    );
  }
  const timeout = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  if (!Number.isFinite(timeout) || timeout <= 0 || timeout > 600_000) {
    throw new ElevenLabsProviderError(
      "ElevenLabs timeoutMs must be between 1 and 600000 milliseconds.",
    );
  }
}

function humanSpeakerId(speakerId: string | null | undefined): string {
  if (!speakerId) return "Speaker 1";
  const numbered = /^speaker_(\d+)$/iu.exec(speakerId);
  if (numbered) return `Speaker ${Number(numbered[1]) + 1}`;
  return speakerId
    .replace(/[_-]+/gu, " ")
    .replace(/\b\w/gu, (character) => character.toUpperCase());
}

function joinToken(current: string, token: string, tokenType: string): string {
  if (!token) return current;
  if (!current || /^\s/u.test(token) || /\s$/u.test(current)) return current + token;
  if (tokenType === "spacing") return current + token;
  if (/^[,.;:!?%)\]}…。，、？！：；]/u.test(token)) return current + token;
  if (/[([{“‘]$/u.test(current)) return current + token;
  return `${current} ${token}`;
}

export function segmentsFromElevenLabsWords(
  words: z.infer<typeof speechWordSchema>[],
  fallbackText: string,
): TranscriptSegment[] {
  const segments: TranscriptSegment[] = [];
  let current:
    | {
        speaker: string;
        text: string;
        startSeconds?: number;
        endSeconds?: number;
      }
    | undefined;

  for (const word of words) {
    if (!word.text) continue;
    const wordSpeaker = word.speaker_id
      ? humanSpeakerId(word.speaker_id)
      : current?.speaker ?? "Speaker 1";

    if (!current || current.speaker !== wordSpeaker) {
      if (current?.text.trim()) {
        segments.push({ ...current, text: current.text.trim() });
      }
      current = {
        speaker: wordSpeaker,
        text: "",
        ...(word.start !== null && word.start !== undefined
          ? { startSeconds: word.start }
          : {}),
      };
    }

    current.text = joinToken(current.text, word.text, word.type);
    if (word.end !== null && word.end !== undefined) {
      current.endSeconds = word.end;
    }
  }

  if (current?.text.trim()) {
    segments.push({ ...current, text: current.text.trim() });
  }

  if (segments.length === 0 && fallbackText.trim()) {
    return [{ speaker: "Speaker 1", text: fallbackText.trim() }];
  }
  return segments;
}

function abortableSignal(
  timeoutMs: number,
  externalSignal?: AbortSignal,
): { signal: AbortSignal; cleanup: () => void; timedOut: () => boolean } {
  const controller = new AbortController();
  let didTimeout = false;
  const timer = setTimeout(() => {
    didTimeout = true;
    controller.abort(new Error("ElevenLabs request timed out"));
  }, timeoutMs);

  const abortFromCaller = () => controller.abort(externalSignal?.reason);
  if (externalSignal?.aborted) abortFromCaller();
  else externalSignal?.addEventListener("abort", abortFromCaller, { once: true });

  return {
    signal: controller.signal,
    timedOut: () => didTimeout,
    cleanup: () => {
      clearTimeout(timer);
      externalSignal?.removeEventListener("abort", abortFromCaller);
    },
  };
}

function redactAndCompactDetail(body: string, apiKey: string): string | undefined {
  const trimmed = body.trim();
  if (!trimmed) return undefined;

  let detail = trimmed;
  try {
    const parsed = JSON.parse(trimmed) as {
      detail?: unknown;
      message?: unknown;
      error?: unknown;
    };
    const candidate = parsed.detail ?? parsed.message ?? parsed.error;
    detail =
      typeof candidate === "string" ? candidate : JSON.stringify(candidate ?? parsed);
  } catch {
    // Plain-text provider errors are still useful after redaction and truncation.
  }
  return detail.replaceAll(apiKey, "[redacted]").replace(/\s+/gu, " ").slice(0, 400);
}

export async function transcribeAudio(
  audio: Blob,
  options: TranscribeAudioOptions = {},
): Promise<TranscriptionResult> {
  validateOptions(options);
  if (!(audio instanceof Blob)) {
    throw new ElevenLabsProviderError("ElevenLabs transcription requires a Blob or File.");
  }
  if (audio.size === 0) {
    throw new ElevenLabsProviderError("Cannot transcribe an empty audio file.");
  }

  const runtime = env();
  const apiKey =
    options.apiKey === undefined ? runtime.ELEVENLABS_API_KEY?.trim() : options.apiKey?.trim();

  // Deterministic fixture data is useful locally, but production must never present
  // it as a completed transcription when the provider has not been configured.
  if (!apiKey) {
    if ((options.runtimeEnvironment ?? process.env.NODE_ENV) === "production") {
      throw new ElevenLabsProviderError(
        "ElevenLabs is not configured for production. Set ELEVENLABS_API_KEY before processing recordings.",
      );
    }
    return createFallbackTranscription();
  }

  const possibleFileName = (audio as Blob & { name?: unknown }).name;
  const filename = cleanFilename(
    options.fileName ??
      (typeof possibleFileName === "string" ? possibleFileName : "recording.webm"),
  );
  const form = new FormData();
  form.append("file", audio, filename);
  form.append("model_id", options.modelId?.trim() || runtime.ELEVENLABS_SCRIBE_MODEL_ID);
  form.append("diarize", "true");
  form.append("timestamps_granularity", "word");
  form.append("tag_audio_events", "true");
  if (options.languageCode) form.append("language_code", options.languageCode);
  if (options.numSpeakers) form.append("num_speakers", String(options.numSpeakers));

  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const abort = abortableSignal(timeoutMs, options.signal);
  const fetchImpl = options.fetchImpl ?? fetch;
  let response: Response;

  try {
    response = await fetchImpl(ELEVENLABS_SPEECH_TO_TEXT_URL, {
      method: "POST",
      headers: { "xi-api-key": apiKey },
      body: form,
      signal: abort.signal,
    });
  } catch (error) {
    if (abort.timedOut()) {
      throw new ElevenLabsProviderError(
        `ElevenLabs transcription timed out after ${timeoutMs}ms.`,
        { cause: error },
      );
    }
    if (options.signal?.aborted) {
      throw new ElevenLabsProviderError("ElevenLabs transcription was cancelled.", {
        cause: error,
      });
    }
    throw new ElevenLabsProviderError(
      "Could not reach ElevenLabs for transcription. Check the endpoint and network connection.",
      { cause: error },
    );
  } finally {
    abort.cleanup();
  }

  const body = await response.text();
  if (!response.ok) {
    const detail = redactAndCompactDetail(body, apiKey);
    throw new ElevenLabsProviderError(
      `ElevenLabs transcription failed with HTTP ${response.status}${
        detail ? `: ${detail}` : "."
      }`,
      { status: response.status },
    );
  }

  let raw: unknown;
  try {
    raw = JSON.parse(body);
  } catch (error) {
    throw new ElevenLabsProviderError(
      "ElevenLabs returned a non-JSON transcription response.",
      { status: response.status, cause: error },
    );
  }

  const parsed = speechToTextResponseSchema.safeParse(raw);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    throw new ElevenLabsProviderError(
      `ElevenLabs returned an invalid transcription response at ${
        issue.path.join(".") || "response"
      }: ${issue.message}`,
      { status: response.status, cause: parsed.error },
    );
  }

  const text = parsed.data.text.trim();
  if (!text) {
    throw new ElevenLabsProviderError(
      "ElevenLabs could not detect speech in this recording.",
      { status: response.status },
    );
  }
  const segments = segmentsFromElevenLabsWords(parsed.data.words ?? [], text);

  return transcriptionResultSchema.parse({
    text,
    segments,
    language: parsed.data.language_code ?? "unknown",
    provider: "elevenlabs",
  });
}

export const transcribeWithElevenLabs = transcribeAudio;
