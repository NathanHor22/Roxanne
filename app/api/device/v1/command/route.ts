import { NextResponse } from "next/server";
import { z } from "zod";

import { loadDeviceBriefing } from "@/lib/device-briefing-service";
import {
  commandReply,
  interpretDeviceCommand,
  type DeviceCommandContext,
} from "@/lib/device-command";
import { authenticateLantern } from "@/lib/lantern-device-auth";
import { createOpenAISpeech } from "@/lib/providers/openai-speech";
import { transcribeWithOpenAI } from "@/lib/providers/openai-transcription";
import { getServerSupabase } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const maxDuration = 120;

const contextSchema = z.enum(["ready", "consent"]);
const MAX_COMMAND_BYTES = 320 * 1024;

function errorResponse(message: string, status: number) {
  return NextResponse.json(
    { error: message },
    { status, headers: { "cache-control": "no-store" } },
  );
}

function batteryLevel(request: Request) {
  const value = Number(request.headers.get("x-lantern-battery-level") || 50);
  return Number.isFinite(value) ? Math.max(0, Math.min(100, Math.round(value))) : 50;
}

export async function POST(request: Request) {
  const client = getServerSupabase();
  if (!client) return errorResponse("Lantern service is unavailable.", 503);
  const device = await authenticateLantern(request, client);
  if (!device) return errorResponse("Device credential is invalid or revoked.", 403);

  try {
    const context = contextSchema.parse(
      request.headers.get("x-lantern-command-context") || "ready",
    ) as DeviceCommandContext;
    const contentType = request.headers.get("content-type")?.toLowerCase() || "";
    if (!contentType.startsWith("audio/wav")) {
      return errorResponse("Lantern voice commands require WAV audio.", 415);
    }
    const declaredLength = Number(request.headers.get("content-length") || 0);
    if (declaredLength > MAX_COMMAND_BYTES) {
      return errorResponse("Lantern voice command is too long.", 413);
    }
    const bytes = await request.arrayBuffer();
    if (bytes.byteLength <= 44 || bytes.byteLength > MAX_COMMAND_BYTES) {
      return errorResponse("Lantern voice command is empty or too long.", 400);
    }

    const transcription = await transcribeWithOpenAI(
      new Blob([bytes], { type: "audio/wav" }),
      {
        fileName: `lantern-command-${device.id}.wav`,
        modelId: "gpt-4o-mini-transcribe",
        timeoutMs: 45_000,
      },
    );
    const intent = interpretDeviceCommand(transcription.text, context);
    const speech =
      intent === "status_report"
        ? (await loadDeviceBriefing(
            client,
            device.userId,
            "status",
            batteryLevel(request),
          )).speech
        : commandReply(intent);
    const audio = await createOpenAISpeech(speech);
    return new NextResponse(audio.body, {
      status: 200,
      headers: {
        "cache-control": "no-store",
        "content-type": "audio/pcm",
        "x-lantern-audio-rate": "24000",
        "x-lantern-command": intent,
      },
    });
  } catch (cause) {
    console.error("[lantern-device-command]", cause);
    if (cause instanceof z.ZodError || cause instanceof SyntaxError) {
      return errorResponse("Lantern voice command request is invalid.", 400);
    }
    const message = cause instanceof Error ? cause.message : "Lantern voice command failed.";
    if (
      message.startsWith("OpenAI transcription is not configured") ||
      message.startsWith("OpenAI speech is not configured")
    ) {
      return errorResponse(message, 503);
    }
    return errorResponse("Lantern could not understand that voice command.", 502);
  }
}
