import { env } from "../env";
import type { TranscriptionResult } from "../meeting-schema";
import { transcribeAudio } from "./elevenlabs";
import { transcribeWithGroq } from "./groq-transcription";
import { transcribeWithOpenAI } from "./openai-transcription";

export async function transcribeMeetingAudio(
  audio: Blob,
  options: { fileName?: string; languageCode?: string } = {},
): Promise<TranscriptionResult> {
  const runtime = env();
  if (runtime.OPENAI_API_KEY?.trim()) {
    return transcribeWithOpenAI(audio, options);
  }
  if (runtime.ELEVENLABS_API_KEY?.trim()) {
    return transcribeAudio(audio, options);
  }
  if (runtime.GROQ_API_KEY?.trim()) {
    return transcribeWithGroq(audio, options);
  }
  return transcribeAudio(audio, options);
}
