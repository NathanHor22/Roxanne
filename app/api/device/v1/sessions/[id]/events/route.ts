import { NextResponse } from "next/server";
import { z } from "zod";

import { authenticateLantern } from "@/lib/lantern-device-auth";
import { conversationClock } from "@/lib/conversation-clock";
import { env } from "@/lib/env";
import {
  advanceLantern,
  lanternEventSchema,
  lanternMachineSchema,
  LanternTransitionError,
} from "@/lib/lantern-state";
import { getServerSupabase } from "@/lib/supabase/server";
import {
  buildAgoraLanternTransport,
  startAgoraLanternTranscription,
  stopAgoraLanternTranscription,
  type AgoraLanternTransport,
} from "@/lib/providers/agora-stt";

export const runtime = "nodejs";

const paramsSchema = z.object({ id: z.string().uuid() }).strict();
const requestSchema = z
  .object({
    eventId: z.string().uuid(),
    expectedVersion: z.number().int().nonnegative(),
    event: lanternEventSchema,
  })
  .strict();

function noStore(error: string, status: number) {
  return NextResponse.json(
    { error },
    { status, headers: { "cache-control": "no-store" } },
  );
}

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const client = getServerSupabase();
  if (!client) return noStore("Lantern service is unavailable.", 503);
  const device = await authenticateLantern(request, client);
  if (!device) return noStore("Device credential is invalid or revoked.", 403);

  try {
    const { id } = paramsSchema.parse(await context.params);
    const input = requestSchema.parse(await request.json());
    const { data: replay } = await client
      .from("lantern_device_events")
      .select("session_id,machine")
      .eq("device_id", device.id)
      .eq("event_id", input.eventId)
      .maybeSingle();
    if (replay?.machine) {
      if (replay.session_id !== id) {
        return noStore("That event ID already belongs to another session.", 409);
      }
      const replayMachine = lanternMachineSchema.parse(replay.machine);
      const transport =
        replayMachine.state === "recording" && replayMachine.recordingStartedAt
          ? buildAgoraLanternTransport(id, device.id)
          : undefined;
      return NextResponse.json(
        {
          session: replayMachine,
          ...(transport ? { transport } : {}),
          ...(replayMachine.recordingStartedAt
            ? {
                clock: conversationClock(
                  replayMachine.recordingStartedAt,
                  env().APP_TIMEZONE,
                ),
              }
            : {}),
          duplicate: true,
        },
        { headers: { "cache-control": "no-store" } },
      );
    }

    const { data: stored, error: sessionError } = await client
      .from("lantern_sessions")
      .select("id,state_version,machine,conversation_timezone,agora_stt_agent_id")
      .eq("id", id)
      .eq("device_id", device.id)
      .is("ended_at", null)
      .maybeSingle();
    if (sessionError) throw new Error(sessionError.message);
    if (!stored) return noStore("Lantern session was not found.", 404);
    const current = lanternMachineSchema.parse(stored.machine);
    if (
      input.expectedVersion !== current.version ||
      Number(stored.state_version) !== current.version
    ) {
      return noStore("Lantern session state is stale.", 409);
    }

    const serverTime = new Date().toISOString();
    if (
      input.event.type === "CONNECTED" ||
      input.event.type === "BEGIN_QUICK" ||
      input.event.type === "BEGIN_STATUS"
    ) {
      return noStore("Start a new Lantern mode through the session endpoint.", 400);
    }
    const event = lanternEventSchema.parse(
      input.event.type === "ACTION_PROPOSED"
        ? {
            ...input.event,
            at: serverTime,
            promptExpiresAt: new Date(Date.now() + 30_000).toISOString(),
          }
        : { ...input.event, at: serverTime },
    );
    const next = advanceLantern(current, event);
    let transport: AgoraLanternTransport | undefined;
    let startedAgentId: string | undefined;
    if (event.type === "RECORDING_CONSENT" && event.accepted) {
      transport = buildAgoraLanternTransport(id, device.id);
      const started = await startAgoraLanternTranscription(id, transport);
      startedAgentId = started.agentId;
    }
    const endedAt = next.sessionId === null ? serverTime : null;
    const { data: transitionRows, error: updateError } = await client.rpc(
      "apply_lantern_transition",
      {
        p_session_id: id,
        p_user_id: device.userId,
        p_device_id: device.id,
        p_expected_version: current.version,
        p_state: next.state,
        p_state_version: next.version,
        p_machine: next,
        p_event_id: input.eventId,
        p_event_type: event.type,
        p_ended_at: endedAt,
      },
    );
    if (updateError) {
      if (startedAgentId) {
        await stopAgoraLanternTranscription(startedAgentId).catch(() => undefined);
      }
      throw new Error(updateError.message);
    }
    const transition = Array.isArray(transitionRows)
      ? transitionRows[0]
      : transitionRows;
    if (!transition?.applied) {
      if (startedAgentId) {
        await stopAgoraLanternTranscription(startedAgentId).catch(() => undefined);
      }
      return noStore("Lantern session state changed.", 409);
    }
    const storedMachine = lanternMachineSchema.parse(
      transition.stored_machine || next,
    );

    if (transport && startedAgentId) {
      const { error: providerError } = await client
        .from("lantern_sessions")
        .update({
          agora_channel_name: transport.channel,
          agora_publisher_uid: transport.publisherUid,
          agora_stt_bot_uid: transport.sttBotUid,
          agora_stt_agent_id: startedAgentId,
          agora_token_expires_at: transport.expiresAt,
          processing_error: null,
        })
        .eq("id", id)
        .eq("device_id", device.id);
      if (providerError) {
        await stopAgoraLanternTranscription(startedAgentId).catch(() => undefined);
        throw new Error(providerError.message);
      }
    }

    let providerWarning: string | undefined;
    if (event.type === "STOP") {
      const { error: endStampError } = await client
        .from("lantern_sessions")
        .update({ capture_ended_at: serverTime })
        .eq("id", id)
        .eq("device_id", device.id);
      if (endStampError) throw new Error(endStampError.message);
    }
    if ((event.type === "STOP" || event.type === "RESET") && stored.agora_stt_agent_id) {
      try {
        await stopAgoraLanternTranscription(stored.agora_stt_agent_id);
      } catch (cause) {
        providerWarning =
          cause instanceof Error ? cause.message : "Agora did not confirm that transcription stopped.";
        await client
          .from("lantern_sessions")
          .update({ processing_error: providerWarning })
          .eq("id", id)
          .eq("device_id", device.id);
      }
    }

    const timezone = stored.conversation_timezone || env().APP_TIMEZONE;

    return NextResponse.json(
      {
        session: storedMachine,
        ...(transport ? { transport } : {}),
        ...(storedMachine.recordingStartedAt
          ? { clock: conversationClock(storedMachine.recordingStartedAt, timezone) }
          : {}),
        ...(providerWarning ? { warning: providerWarning } : {}),
        duplicate: Boolean(transition.duplicate),
      },
      { headers: { "cache-control": "no-store" } },
    );
  } catch (error) {
    console.error("[lantern-session-event]", error);
    if (error instanceof LanternTransitionError) {
      return noStore(error.message, 409);
    }
    const message = error instanceof Error ? error.message : "";
    return noStore(
      error instanceof z.ZodError
        ? "Lantern event is invalid."
        : message.startsWith("Agora recording is not configured")
          ? message
          : "Lantern event could not be saved.",
      error instanceof z.ZodError
        ? 400
        : message.startsWith("Agora recording is not configured")
          ? 503
          : 500,
    );
  }
}
