import { randomUUID } from "node:crypto";

import type { SupabaseClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";
import { z } from "zod";

import { conversationClock } from "@/lib/conversation-clock";
import { env } from "@/lib/env";
import { authenticateLantern, type AuthenticatedLantern } from "@/lib/lantern-device-auth";
import { advanceLantern, lanternMachineSchema, type LanternMachine } from "@/lib/lantern-state";
import { transcriptionResultSchema } from "@/lib/meeting-schema";
import { persistProcessedMeeting } from "@/lib/persistence";
import { extractConversationInsights } from "@/lib/providers/meeting-extraction";
import { transcribeWithOpenAI } from "@/lib/providers/openai-transcription";
import { getServerSupabase } from "@/lib/supabase/server";
import type { Contact, FollowUp, Meeting } from "@/lib/types";

export const runtime = "nodejs";
export const maxDuration = 120;

const paramsSchema = z.object({ id: z.string().uuid() }).strict();
const requestSchema = z.object({ eventId: z.string().uuid() }).strict();

function response(error: string, status: number) {
  return NextResponse.json({ error }, { status, headers: { "cache-control": "no-store" } });
}

async function applyServerTransition(
  client: SupabaseClient,
  device: AuthenticatedLantern,
  sessionId: string,
  machine: LanternMachine,
  type: "ARCHIVE_ACCEPTED" | "PROCESSING_COMPLETE",
  eventId: string,
) {
  const at = new Date().toISOString();
  const next = advanceLantern(machine, { type, at });
  const { data, error } = await client.rpc("apply_lantern_transition", {
    p_session_id: sessionId,
    p_user_id: device.userId,
    p_device_id: device.id,
    p_expected_version: machine.version,
    p_state: next.state,
    p_state_version: next.version,
    p_machine: next,
    p_event_id: eventId,
    p_event_type: type,
    p_ended_at: next.sessionId === null ? at : null,
  });
  if (error) throw new Error(error.message);
  const transition = Array.isArray(data) ? data[0] : data;
  if (!transition?.applied) throw new Error("Lantern completion state changed.");
  return lanternMachineSchema.parse(transition.stored_machine || next);
}

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const client = getServerSupabase();
  if (!client) return response("Lantern service is unavailable.", 503);
  const device = await authenticateLantern(request, client);
  if (!device) return response("Device credential is invalid or revoked.", 403);

  let sessionId = "";
  try {
    sessionId = paramsSchema.parse(await context.params).id;
    const input = requestSchema.parse(await request.json());
    const { data: stored, error: lookupError } = await client
      .from("lantern_sessions")
      .select(
        "id,user_id,device_id,machine,state,started_at,capture_ended_at,conversation_timezone,transcript_segments,transcript_language,recording_id,completion_event_id,meeting_id,ended_at",
      )
      .eq("id", sessionId)
      .eq("device_id", device.id)
      .eq("user_id", device.userId)
      .maybeSingle();
    if (lookupError) throw new Error(lookupError.message);
    if (!stored) return response("Lantern session was not found.", 404);
    const clientReference = `hardware:${sessionId}`;
    const initialMachine = lanternMachineSchema.parse(stored.machine);

    if (stored.ended_at && stored.completion_event_id === input.eventId) {
      return NextResponse.json(
        {
          accepted: true,
          duplicate: true,
          conversationId: clientReference,
          meetingId: stored.meeting_id,
          session: initialMachine,
        },
        { headers: { "cache-control": "no-store" } },
      );
    }
    if (stored.completion_event_id && stored.completion_event_id !== input.eventId) {
      return response("This session is already being processed.", 409);
    }
    if (!stored.recording_id) {
      return response("Upload the stopped recording before processing.", 409);
    }
    const { data: recording, error: recordingError } = await client
      .from("recordings")
      .select("id,storage_path")
      .eq("id", stored.recording_id)
      .eq("user_id", device.userId)
      .maybeSingle();
    if (recordingError) throw new Error(recordingError.message);
    if (!recording?.storage_path) {
      return response("The private Lantern recording could not be found.", 409);
    }

    let processingMachine = initialMachine;
    if (initialMachine.state === "finalising") {
      const claim = client
        .from("lantern_sessions")
        .update({ completion_event_id: input.eventId, processing_error: null })
        .eq("id", sessionId)
        .eq("device_id", device.id);
      const { error: claimError } = stored.completion_event_id
        ? await claim.eq("completion_event_id", input.eventId)
        : await claim.is("completion_event_id", null);
      if (claimError) throw new Error(claimError.message);
    } else if (initialMachine.state !== "processing" || stored.completion_event_id !== input.eventId) {
      return response(`Lantern cannot process while it is ${initialMachine.state}.`, 409);
    }

    const agoraSegments = Array.isArray(stored.transcript_segments)
      ? stored.transcript_segments
      : [];
    const transcription = agoraSegments.length
      ? transcriptionResultSchema.parse({
          text: (agoraSegments as { speaker: string; text: string }[])
            .map((segment) => `${segment.speaker}: ${segment.text}`)
            .join("\n"),
          segments: agoraSegments,
          language: stored.transcript_language || "multilingual",
          provider: "agora",
        })
      : await (async () => {
          const { data: audio, error: downloadError } = await client.storage
            .from("recordings")
            .download(recording.storage_path);
          if (downloadError || !audio) {
            throw new Error(
              `The private Lantern recording could not be read for transcription${
                downloadError?.message ? `: ${downloadError.message}` : "."
              }`,
            );
          }
          const result = await transcribeWithOpenAI(audio, {
            fileName: `${sessionId}.wav`,
          });
          const { error: transcriptError } = await client
            .from("lantern_sessions")
            .update({
              transcript_segments: result.segments,
              transcript_language: result.language,
              transcript_received_at: new Date().toISOString(),
              transcript_event_id: randomUUID(),
              processing_error: null,
            })
            .eq("id", sessionId)
            .eq("device_id", device.id);
          if (transcriptError) {
            throw new Error(
              `Could not save the recovered Lantern transcript: ${transcriptError.message}`,
            );
          }
          return result;
        })();
    const timezone = stored.conversation_timezone || env().APP_TIMEZONE;
    const startedAt = processingMachine.recordingStartedAt || stored.started_at;
    const clock = conversationClock(startedAt, timezone);
    let endedAt = stored.capture_ended_at || new Date().toISOString();
    if (Date.parse(endedAt) <= Date.parse(clock.startedAt)) {
      endedAt = new Date(Date.parse(clock.startedAt) + 1_000).toISOString();
    }
    const extraction = await extractConversationInsights(transcription.segments, {
      title: `${device.name} conversation`,
      outputLanguage: "English",
      referenceDate: clock.startedAt,
      timezone: clock.timeZone,
      referenceLocalDateTime: clock.localDateTime,
    });
    const contacts: Contact[] = extraction.participants.map((participant) => ({
      id: randomUUID(),
      ...participant,
    }));
    const followUps: FollowUp[] = extraction.followUps.map((followUp) => ({
      id: randomUUID(),
      meetingId: clientReference,
      contactId: contacts[0]?.id || null,
      ...followUp,
      status: "pending",
    }));
    const title = contacts[0]
      ? `${contacts[0].name}${contacts[0].company ? ` · ${contacts[0].company}` : ""}`
      : `${device.name} · ${clock.localDate} ${clock.localTime.slice(0, 5)}`;
    const meeting: Meeting = {
      id: clientReference,
      title,
      startAt: clock.startedAt,
      endAt: endedAt,
      status: "ready",
      source: "hardware",
      contacts,
      recordingId: stored.recording_id,
      transcript: transcription.segments,
      insight: extraction.insight,
      followUps,
    };
    const persisted = await persistProcessedMeeting({
      ownerUserId: device.userId,
      clientReference,
      meeting,
      transcription,
      extraction,
      preUploadedRecording: {
        recordingId: stored.recording_id,
        storagePath: recording.storage_path,
      },
    });
    if (!persisted.persisted || !persisted.meetingId) {
      throw new Error("Lantern conversation was not persisted.");
    }
    meeting.recordingId = persisted.recordingId;
    meeting.recordingUrl = persisted.signedRecordingUrl;
    if (processingMachine.state === "finalising") {
      processingMachine = await applyServerTransition(
        client,
        device,
        sessionId,
        processingMachine,
        "ARCHIVE_ACCEPTED",
        input.eventId,
      );
    }
    const { error: finishError } = await client
      .from("lantern_sessions")
      .update({ meeting_id: persisted.meetingId, processing_error: null })
      .eq("id", sessionId)
      .eq("device_id", device.id);
    if (finishError) throw new Error(finishError.message);
    const finishedMachine = await applyServerTransition(
      client,
      device,
      sessionId,
      processingMachine,
      "PROCESSING_COMPLETE",
      randomUUID(),
    );
    return NextResponse.json(
      {
        accepted: true,
        duplicate: false,
        conversationId: clientReference,
        meetingId: persisted.meetingId,
        clock,
        meeting,
        session: finishedMachine,
      },
      { status: 201, headers: { "cache-control": "no-store" } },
    );
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : "Lantern conversation could not be processed.";
    if (sessionId) {
      await client
        .from("lantern_sessions")
        .update({ processing_error: message.slice(0, 500) })
        .eq("id", sessionId)
        .eq("device_id", device.id);
    }
    console.error("[lantern-session-complete]", cause);
    if (cause instanceof z.ZodError || cause instanceof SyntaxError) {
      return response("Lantern transcript is invalid.", 400);
    }
    if (message.startsWith("OpenAI transcription is not configured")) {
      return response(message, 503);
    }
    if (message.startsWith("OpenAI is not configured")) return response(message, 503);
    return response(message, 502);
  }
}
