import { NextResponse } from "next/server";
import { z } from "zod";

import { loadDeviceBriefing } from "@/lib/device-briefing-service";
import { authenticateLantern } from "@/lib/lantern-device-auth";
import { createOpenAISpeech } from "@/lib/providers/openai-speech";
import { getServerSupabase } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const maxDuration = 60;

const requestSchema = z
  .object({
    kind: z.enum(["boot", "status"]),
    batteryLevel: z.number().int().min(0).max(100).default(50),
  })
  .strict();

function errorResponse(message: string, status: number) {
  return NextResponse.json(
    { error: message },
    { status, headers: { "cache-control": "no-store" } },
  );
}

export async function POST(request: Request) {
  const client = getServerSupabase();
  if (!client) return errorResponse("Lantern service is unavailable.", 503);
  const device = await authenticateLantern(request, client);
  if (!device) return errorResponse("Device credential is invalid or revoked.", 403);

  try {
    const input = requestSchema.parse(await request.json());
    const briefing = await loadDeviceBriefing(
      client,
      device.userId,
      input.kind,
      input.batteryLevel,
    );
    const audio = await createOpenAISpeech(briefing.speech);
    return new NextResponse(audio.body, {
      status: 200,
      headers: {
        "cache-control": "no-store",
        "content-type": "audio/pcm",
        "x-lantern-audio-rate": "24000",
        "x-lantern-meeting-count": String(briefing.meetingCount),
        "x-lantern-approval-count": String(briefing.approvalCount),
      },
    });
  } catch (cause) {
    console.error("[lantern-device-briefing]", cause);
    if (cause instanceof z.ZodError || cause instanceof SyntaxError) {
      return errorResponse("Lantern briefing request is invalid.", 400);
    }
    const message = cause instanceof Error ? cause.message : "Lantern briefing failed.";
    return errorResponse(
      message.startsWith("OpenAI speech is not configured") ? message : "Lantern briefing failed.",
      message.startsWith("OpenAI speech is not configured") ? 503 : 502,
    );
  }
}
