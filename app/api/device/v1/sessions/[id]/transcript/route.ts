import { NextResponse } from "next/server";
import { z } from "zod";

import { agoraCaptionLimits, parseAgoraCaptionBatch } from "@/lib/agora-caption";
import { authenticateLantern } from "@/lib/lantern-device-auth";
import { lanternMachineSchema } from "@/lib/lantern-state";
import { getServerSupabase } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const maxDuration = 30;

const paramsSchema = z.object({ id: z.string().uuid() }).strict();
const eventIdSchema = z.string().uuid();

function response(error: string, status: number) {
  return NextResponse.json({ error }, { status, headers: { "cache-control": "no-store" } });
}

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const client = getServerSupabase();
  if (!client) return response("Quipus service is unavailable.", 503);
  const device = await authenticateLantern(request, client);
  if (!device) return response("Device credential is invalid or revoked.", 403);

  try {
    const { id } = paramsSchema.parse(await context.params);
    const eventId = eventIdSchema.parse(
      request.headers.get("x-lantern-event-id") ||
        request.headers.get("x-roxanne-event-id"),
    );
    const contentType = request.headers.get("content-type")?.split(";", 1)[0];
    if (
      contentType !== "application/x-lantern-agora-caption-batch" &&
      contentType !== "application/x-roxanne-agora-caption-batch"
    ) {
      return response("Caption batch content type is invalid.", 415);
    }
    const declaredLength = Number(request.headers.get("content-length") || 0);
    if (declaredLength > agoraCaptionLimits.maxBatchBytes) {
      return response("Caption batch is too large.", 413);
    }
    const { data: stored, error: lookupError } = await client
      .from("lantern_sessions")
      .select("id,machine,transcript_event_id,transcript_received_at,transcript_segments,transcript_language")
      .eq("id", id)
      .eq("device_id", device.id)
      .eq("user_id", device.userId)
      .maybeSingle();
    if (lookupError) throw new Error(lookupError.message);
    if (!stored) return response("Quipus session was not found.", 404);
    if (stored.transcript_event_id === eventId) {
      return NextResponse.json(
        { accepted: true, duplicate: true, segments: stored.transcript_segments?.length || 0 },
        { headers: { "cache-control": "no-store" } },
      );
    }
    if (stored.transcript_received_at || stored.transcript_event_id) {
      return response("A transcript is already attached to this session.", 409);
    }
    const machine = lanternMachineSchema.parse(stored.machine);
    if (machine.state !== "finalising" || !machine.recordingStartedAt) {
      return response("Stop the recording before attaching its transcript.", 409);
    }
    const bytes = new Uint8Array(await request.arrayBuffer());
    const transcription = parseAgoraCaptionBatch(bytes, machine.recordingStartedAt);
    const { data: attached, error: updateError } = await client
      .from("lantern_sessions")
      .update({
        transcript_segments: transcription.segments,
        transcript_language: transcription.language,
        transcript_received_at: new Date().toISOString(),
        transcript_event_id: eventId,
        processing_error: null,
      })
      .eq("id", id)
      .eq("device_id", device.id)
      .is("transcript_event_id", null)
      .select("transcript_event_id")
      .maybeSingle();
    if (updateError) throw new Error(updateError.message);
    if (attached?.transcript_event_id !== eventId) {
      return response("Another transcript upload already won this session.", 409);
    }
    return NextResponse.json(
      { accepted: true, duplicate: false, segments: transcription.segments.length },
      { status: 201, headers: { "cache-control": "no-store" } },
    );
  } catch (cause) {
    console.error("[lantern-transcript-upload]", cause);
    if (cause instanceof z.ZodError) return response("Caption request is invalid.", 400);
    return response(cause instanceof Error ? cause.message : "Caption batch could not be saved.", 422);
  }
}
