import { randomUUID } from "node:crypto";

import { NextResponse } from "next/server";
import { z } from "zod";

import { authenticateLantern } from "@/lib/lantern-device-auth";
import { lanternMachineSchema } from "@/lib/lantern-state";
import { getServerSupabase } from "@/lib/supabase/server";
import { parseLanternWav } from "@/lib/wav";

export const runtime = "nodejs";
export const maxDuration = 60;

const MAX_DEVICE_WAV_BYTES = 1_100_000;
const paramsSchema = z.object({ id: z.string().uuid() }).strict();
const eventIdSchema = z.string().uuid();

function response(error: string, status: number) {
  return NextResponse.json({ error }, { status, headers: { "cache-control": "no-store" } });
}

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const client = getServerSupabase();
  if (!client) return response("Lantern service is unavailable.", 503);
  const device = await authenticateLantern(request, client);
  if (!device) return response("Device credential is invalid or revoked.", 403);

  let uploadedPath: string | null = null;
  let recordingId: string | null = null;
  try {
    const { id } = paramsSchema.parse(await context.params);
    const eventId = eventIdSchema.parse(
      request.headers.get("x-lantern-event-id") ||
        request.headers.get("x-roxanne-event-id"),
    );
    if (request.headers.get("content-type")?.split(";", 1)[0] !== "audio/wav") {
      return response("Lantern audio must be a WAV file.", 415);
    }
    const declaredLength = Number(request.headers.get("content-length") || 0);
    if (declaredLength > MAX_DEVICE_WAV_BYTES) return response("Lantern WAV is too large.", 413);
    const { data: stored, error: lookupError } = await client
      .from("lantern_sessions")
      .select("id,machine,audio_event_id,recording_id")
      .eq("id", id)
      .eq("device_id", device.id)
      .eq("user_id", device.userId)
      .maybeSingle();
    if (lookupError) throw new Error(lookupError.message);
    if (!stored) return response("Lantern session was not found.", 404);
    if (stored.audio_event_id === eventId && stored.recording_id) {
      return NextResponse.json(
        { accepted: true, duplicate: true, recordingId: stored.recording_id },
        { headers: { "cache-control": "no-store" } },
      );
    }
    if (stored.audio_event_id || stored.recording_id) {
      return response("Audio is already attached to this session.", 409);
    }
    const machine = lanternMachineSchema.parse(stored.machine);
    if (machine.state !== "finalising" || !machine.recordingStartedAt) {
      return response("Stop the recording before attaching its audio.", 409);
    }
    const bytes = new Uint8Array(await request.arrayBuffer());
    if (bytes.length > MAX_DEVICE_WAV_BYTES) return response("Lantern WAV is too large.", 413);
    const wav = parseLanternWav(bytes);
    if (wav.durationSeconds > 31) return response("Lantern WAV exceeds the diagnostic archive limit.", 413);

    recordingId = randomUUID();
    const recordedAt = new Date(machine.recordingStartedAt);
    uploadedPath = `${device.userId}/${recordedAt.getUTCFullYear()}/${String(recordedAt.getUTCMonth() + 1).padStart(2, "0")}/${recordingId}.wav`;
    const { error: uploadError } = await client.storage
      .from("recordings")
      .upload(uploadedPath, bytes, { contentType: "audio/wav", upsert: false });
    if (uploadError) throw new Error(`Could not store Lantern audio: ${uploadError.message}`);
    const { error: rowError } = await client.from("recordings").insert({
      id: recordingId,
      user_id: device.userId,
      device_id: device.id,
      storage_path: uploadedPath,
      duration_seconds: Math.ceil(wav.durationSeconds),
      status: "processing",
      provider_status: { transport: "agora", archive: "device-wav-v1" },
    });
    if (rowError) throw new Error(`Could not save Lantern recording: ${rowError.message}`);
    const { data: attached, error: sessionError } = await client
      .from("lantern_sessions")
      .update({
        recording_id: recordingId,
        audio_received_at: new Date().toISOString(),
        audio_event_id: eventId,
        processing_error: null,
      })
      .eq("id", id)
      .eq("device_id", device.id)
      .is("recording_id", null)
      .select("recording_id")
      .maybeSingle();
    if (sessionError) throw new Error(sessionError.message);
    if (attached?.recording_id !== recordingId) {
      throw new Error("Another audio upload already won this session.");
    }
    return NextResponse.json(
      { accepted: true, duplicate: false, recordingId, durationSeconds: wav.durationSeconds },
      { status: 201, headers: { "cache-control": "no-store" } },
    );
  } catch (cause) {
    if (recordingId) {
      await client.from("recordings").delete().eq("id", recordingId).eq("user_id", device.userId);
    }
    if (uploadedPath) await client.storage.from("recordings").remove([uploadedPath]);
    console.error("[lantern-audio-upload]", cause);
    if (cause instanceof z.ZodError) return response("Audio request is invalid.", 400);
    return response(cause instanceof Error ? cause.message : "Lantern audio could not be saved.", 422);
  }
}
