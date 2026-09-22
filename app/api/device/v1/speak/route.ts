import { NextResponse } from "next/server";
import { z } from "zod";

import { createAcknowledgementTone, deviceAudioRate } from "@/lib/device-audio";
import { devicePrompt, devicePromptKinds } from "@/lib/device-prompts";
import { authenticateLantern } from "@/lib/lantern-device-auth";
import { createOpenAISpeech } from "@/lib/providers/openai-speech";
import { getServerSupabase } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const maxDuration = 60;

const requestSchema = z.object({ kind: z.enum(devicePromptKinds) }).strict();

function errorResponse(message: string, status: number) {
  return NextResponse.json(
    { error: message },
    { status, headers: { "cache-control": "no-store" } },
  );
}

export async function POST(request: Request) {
  const client = getServerSupabase();
  if (!client) return errorResponse("Quipus service is unavailable.", 503);
  const device = await authenticateLantern(request, client);
  if (!device) return errorResponse("Device credential is invalid or revoked.", 403);

  try {
    const input = requestSchema.parse(await request.json());
    let audioBody: BodyInit | null;
    let voiceOutput = "speech";
    try {
      const audio = await createOpenAISpeech(devicePrompt(input.kind));
      audioBody = audio.body;
    } catch (cause) {
      voiceOutput = "tone";
      audioBody = createAcknowledgementTone(input.kind);
      console.warn(
        "[lantern-device-speak] Speech output unavailable; using acknowledgement tone.",
        cause instanceof Error ? cause.message : cause,
      );
    }
    return new NextResponse(audioBody, {
      status: 200,
      headers: {
        "cache-control": "no-store",
        "content-type": "audio/pcm",
        "x-lantern-audio-rate": String(deviceAudioRate()),
        "x-lantern-voice-output": voiceOutput,
      },
    });
  } catch (cause) {
    console.error("[lantern-device-speak]", cause);
    if (cause instanceof z.ZodError || cause instanceof SyntaxError) {
      return errorResponse("Quipus speech request is invalid.", 400);
    }
    return errorResponse("Quipus speech request failed.", 502);
  }
}
