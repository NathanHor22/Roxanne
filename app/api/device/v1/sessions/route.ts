import { randomUUID } from "node:crypto";

import { NextResponse } from "next/server";
import { z } from "zod";

import { authenticateLantern } from "@/lib/lantern-device-auth";
import { conversationClock } from "@/lib/conversation-clock";
import { env } from "@/lib/env";
import {
  advanceLantern,
  createLanternMachine,
  lanternMachineSchema,
} from "@/lib/lantern-state";
import { getServerSupabase } from "@/lib/supabase/server";

export const runtime = "nodejs";

const requestSchema = z
  .object({
    eventId: z.string().uuid(),
    mode: z.enum(["quick", "status"]),
  })
  .strict();

function noStore(error: string, status: number) {
  return NextResponse.json(
    { error },
    { status, headers: { "cache-control": "no-store" } },
  );
}

export async function POST(request: Request) {
  const client = getServerSupabase();
  if (!client) return noStore("Lantern service is unavailable.", 503);
  const device = await authenticateLantern(request, client);
  if (!device) return noStore("Device credential is invalid or revoked.", 403);

  try {
    const input = requestSchema.parse(await request.json());
    const { data: replay } = await client
      .from("lantern_device_events")
      .select("event_type,machine")
      .eq("device_id", device.id)
      .eq("event_id", input.eventId)
      .maybeSingle();
    if (replay?.machine) {
      const expectedType = input.mode === "quick" ? "BEGIN_QUICK" : "BEGIN_STATUS";
      if (replay.event_type !== expectedType) {
        return noStore("That event ID already belongs to another action.", 409);
      }
      return NextResponse.json(
        { session: lanternMachineSchema.parse(replay.machine), duplicate: true },
        { headers: { "cache-control": "no-store" } },
      );
    }

    if (device.state !== "ready" && device.state !== "report_ready") {
      return noStore(`Lantern cannot start while it is ${device.state}.`, 409);
    }

    const { data: active, error: activeError } = await client
      .from("lantern_sessions")
      .select("id,state")
      .eq("device_id", device.id)
      .is("ended_at", null)
      .maybeSingle();
    if (activeError) throw new Error(activeError.message);
    if (active) {
      return noStore(
        `Lantern already has an active ${active.state} session.`,
        409,
      );
    }

    const now = new Date();
    const sessionId = randomUUID();
    const machine =
      input.mode === "quick"
        ? advanceLantern(createLanternMachine("ready"), {
            type: "BEGIN_QUICK",
            at: now.toISOString(),
            sessionId,
            promptId: randomUUID(),
            promptExpiresAt: new Date(now.getTime() + 30_000).toISOString(),
          })
        : advanceLantern(createLanternMachine("ready"), {
            type: "BEGIN_STATUS",
            at: now.toISOString(),
            sessionId,
          });

    const { error: sessionError } = await client.rpc("start_lantern_session", {
      p_session_id: sessionId,
      p_user_id: device.userId,
      p_device_id: device.id,
      p_mode: input.mode,
      p_state: machine.state,
      p_state_version: machine.version,
      p_machine: machine,
      p_event_id: input.eventId,
      p_event_type: input.mode === "quick" ? "BEGIN_QUICK" : "BEGIN_STATUS",
      p_started_at: now.toISOString(),
    });
    if (sessionError) {
      if (sessionError.code === "23505") {
        return noStore("Lantern already has an active session.", 409);
      }
      throw new Error(sessionError.message);
    }

    const timezone = env().APP_TIMEZONE;
    const { error: contextError } = await client
      .from("lantern_sessions")
      .update({ conversation_timezone: timezone })
      .eq("id", sessionId)
      .eq("device_id", device.id);
    if (contextError) throw new Error(contextError.message);

    return NextResponse.json(
      {
        session: machine,
        clock: conversationClock(now, timezone),
        duplicate: false,
      },
      { status: 201, headers: { "cache-control": "no-store" } },
    );
  } catch (error) {
    console.error("[lantern-session-start]", error);
    return noStore(
      error instanceof z.ZodError
        ? "Lantern session request is invalid."
        : "Lantern session could not start.",
      error instanceof z.ZodError ? 400 : 500,
    );
  }
}
