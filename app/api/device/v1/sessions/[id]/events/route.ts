import { NextResponse } from "next/server";
import { z } from "zod";

import { authenticateLantern } from "@/lib/lantern-device-auth";
import {
  advanceLantern,
  lanternEventSchema,
  lanternMachineSchema,
  LanternTransitionError,
} from "@/lib/lantern-state";
import { getServerSupabase } from "@/lib/supabase/server";

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
      return NextResponse.json(
        { session: lanternMachineSchema.parse(replay.machine), duplicate: true },
        { headers: { "cache-control": "no-store" } },
      );
    }

    const { data: stored, error: sessionError } = await client
      .from("lantern_sessions")
      .select("id,state_version,machine")
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
    if (updateError) throw new Error(updateError.message);
    const transition = Array.isArray(transitionRows)
      ? transitionRows[0]
      : transitionRows;
    if (!transition?.applied) {
      return noStore("Lantern session state changed.", 409);
    }
    const storedMachine = lanternMachineSchema.parse(
      transition.stored_machine || next,
    );

    return NextResponse.json(
      { session: storedMachine, duplicate: Boolean(transition.duplicate) },
      { headers: { "cache-control": "no-store" } },
    );
  } catch (error) {
    console.error("[lantern-session-event]", error);
    if (error instanceof LanternTransitionError) {
      return noStore(error.message, 409);
    }
    return noStore(
      error instanceof z.ZodError
        ? "Lantern event is invalid."
        : "Lantern event could not be saved.",
      error instanceof z.ZodError ? 400 : 500,
    );
  }
}
