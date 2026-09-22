import { NextResponse } from "next/server";
import { z } from "zod";

import { loadDeviceBriefing } from "@/lib/device-briefing-service";
import { answerVoicePrompt, createVoicePrompt } from "@/lib/device-dialogue";
import { deviceSpeechPage } from "@/lib/device-speech-response";
import { createAcknowledgementTone, deviceAudioRate } from "@/lib/device-audio";
import {
  commandReply,
  interpretDeviceCommand,
  type DeviceCommandContext,
} from "@/lib/device-command";
import { authenticateLantern } from "@/lib/lantern-device-auth";
import { createOpenAISpeech } from "@/lib/providers/openai-speech";
import { transcribeWithOpenAI } from "@/lib/providers/openai-transcription";
import { getServerSupabase } from "@/lib/supabase/server";
import { prepareReportQuery } from "@/lib/device-report-session";
import { parseReportRequest } from "@/lib/report-request";

export const runtime = "nodejs";
export const maxDuration = 120;

const contextSchema = z.enum([
  "ready",
  "wake",
  "wake_word",
  "wake_command",
  "consent",
  "consent_retry",
  "action",
  "report",
]);
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
  if (!client) return errorResponse("Quipus service is unavailable.", 503);
  const device = await authenticateLantern(request, client);
  if (!device) return errorResponse("Device credential is invalid or revoked.", 403);

  try {
    const context = contextSchema.parse(
      request.headers.get("x-lantern-command-context") || "ready",
    ) as DeviceCommandContext;
    const contentType = request.headers.get("content-type")?.toLowerCase() || "";
    if (!contentType.startsWith("audio/wav")) {
      return errorResponse("Quipus voice commands require WAV audio.", 415);
    }
    const declaredLength = Number(request.headers.get("content-length") || 0);
    if (declaredLength > MAX_COMMAND_BYTES) {
      return errorResponse("Quipus voice command is too long.", 413);
    }
    const bytes = await request.arrayBuffer();
    if (bytes.byteLength <= 44 || bytes.byteLength > MAX_COMMAND_BYTES) {
      return errorResponse("Quipus voice command is empty or too long.", 400);
    }

    const transcription = await transcribeWithOpenAI(
      new Blob([bytes], { type: "audio/wav" }),
      {
        fileName: `lantern-command-${device.id}.wav`,
        // Keep the short, interactive wake/command path on Whisper's separate
        // transcription capacity. Meeting audio still uses the configured
        // higher-accuracy OpenAI model and its diarization fallback.
        modelId: "whisper-1",
        prompt:
          context === "wake_word"
            ? "Computer. Quipus."
            : context === "consent" || context === "consent_retry" || context === "action"
              ? "Yes. No. Yeah. Ya. Tidak. Boleh. Tak."
              : "Start recording. Status report. Full breakdown. Third meeting. Yesterday. At two pm. Continue my report. Stop.",
        timeoutMs: 45_000,
      },
    );
    if (context === "action") {
      const token = z.string().uuid().parse(request.headers.get("x-lantern-review-token"));
      const reply = await answerVoicePrompt(client, device, token, transcription.text);
      return await deviceSpeechPage(client, device, { ...reply, intent: reply.token === token ? "action_unclear" : "action_reply" });
    }
    const intent = interpretDeviceCommand(transcription.text, context);
    const protocol3 = request.headers.get("x-lantern-protocol") === "3";
    if (protocol3 && (context === "report" || (context === "wake_command" && intent !== "start_recording" && parseReportRequest(transcription.text, "Asia/Kuala_Lumpur").action !== "unknown"))) {
      const contextId = z.string().uuid().optional().parse(request.headers.get("x-quipus-context-id") || undefined);
      const playbackId = z.string().uuid().optional().parse(request.headers.get("x-quipus-playback-id") || undefined);
      const page = request.headers.get("x-quipus-playback-page");
      const playbackPage = page === null ? undefined : z.coerce.number().int().min(0).max(10000).parse(page);
      return await deviceSpeechPage(client, device, await prepareReportQuery(client, device, { text: transcription.text, contextId, playbackId, playbackPage }));
    }
    if (intent === "status_report") {
      // New firmware fetches the paged report after this short acknowledgement.
      if (request.headers.get("x-lantern-protocol") === "2") {
        return await deviceSpeechPage(client, device, { speech: "Preparing your status report.", intent });
      }
      const briefing = await loadDeviceBriefing(client, device.userId, "status", batteryLevel(request));
      const reply = briefing.followUpIds.length
        ? await createVoicePrompt(client, device, "review", {}, briefing.followUpIds, briefing.speech)
        : { speech: briefing.speech };
      return await deviceSpeechPage(client, device, { ...reply, intent });
    }
    if (
      (context === "wake" || context === "wake_word" || context === "wake_command") &&
      intent === "unknown"
    ) {
      return new NextResponse(null, {
        status: 204,
        headers: {
          "cache-control": "no-store",
          "x-lantern-command": "unknown",
        },
      });
    }
    const speech = commandReply(intent, context);
    let audioBody: BodyInit | null;
    let voiceOutput = "speech";
    if (context === "wake_command" && intent === "start_recording") {
      audioBody = createAcknowledgementTone(intent);
      voiceOutput = "tone";
    } else try {
      const audio = await createOpenAISpeech(speech);
      audioBody = audio.body;
    } catch (cause) {
      voiceOutput = "tone";
      audioBody = createAcknowledgementTone(intent);
      console.warn(
        "[lantern-device-command] Speech output unavailable; using acknowledgement tone.",
        cause instanceof Error ? cause.message : cause,
      );
    }
    return new NextResponse(audioBody, {
      status: 200,
      headers: {
        "cache-control": "no-store",
        "content-type": "audio/pcm",
        "x-lantern-audio-rate": String(deviceAudioRate()),
        "x-lantern-command": intent,
        "x-lantern-voice-output": voiceOutput,
      },
    });
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : "Quipus voice command failed.";
    if (
      ["wake", "wake_word", "wake_command", "report"].includes(
        request.headers.get("x-lantern-command-context") || "",
      ) &&
      message === "OpenAI did not detect speech in this recording."
    ) {
      return new NextResponse(null, {
        status: 204,
        headers: {
          "cache-control": "no-store",
          "x-lantern-command": "unknown",
        },
      });
    }
    console.error("[lantern-device-command]", cause);
    if (cause instanceof z.ZodError || cause instanceof SyntaxError) {
      return errorResponse("Quipus voice command request is invalid.", 400);
    }
    if (
      message.startsWith("OpenAI transcription is not configured") ||
      message.startsWith("OpenAI speech is not configured")
    ) {
      return errorResponse(message, 503);
    }
    return errorResponse("Quipus could not understand that voice command.", 502);
  }
}
