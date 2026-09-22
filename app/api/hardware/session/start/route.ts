import { randomUUID } from "node:crypto";

import { RtmTokenBuilder } from "agora-token";
import { NextResponse } from "next/server";
import { z } from "zod";

import { buildHardwareRtcCredentials, startHardwareVoiceAgent } from "@/lib/agora-conversation";
import { requireAuthenticatedSession, requireProductionPersistence } from "@/lib/api-security";
import { env } from "@/lib/env";
import { getRedis } from "@/lib/redis";
import { getServerSupabase, resolveWorkspaceUserId } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const maxDuration = 60;

const requestSchema = z.object({
  deviceId: z.string().uuid(),
  language: z.string().trim().min(2).max(20).optional(),
}).strict();

export async function POST(request: Request) {
  const authError = await requireAuthenticatedSession();
  if (authError) return authError;
  const client = getServerSupabase();
  const readinessError = requireProductionPersistence(Boolean(client), "Supabase is required for hardware voice sessions.");
  if (readinessError) return readinessError;

  try {
    const input = requestSchema.parse(await request.json());
    if (!client) throw new Error("Supabase is unavailable.");
    const userId = await resolveWorkspaceUserId(client);
    if (!userId) throw new Error("The Quipus workspace is unavailable.");
    const { data: device, error } = await client
      .from("devices")
      .update({ status: "online", last_seen_at: new Date().toISOString() })
      .eq("id", input.deviceId)
      .eq("user_id", userId)
      .select("id,name")
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!device) return NextResponse.json({ error: "Register this device first." }, { status: 404 });

    const sessionId = randomUUID();
    const compactDeviceId = input.deviceId.replaceAll("-", "");
    const channel = `lantern-${compactDeviceId.slice(0, 12)}-${sessionId.replaceAll("-", "").slice(0, 12)}`;
    const uid = (Number.parseInt(compactDeviceId.slice(-7), 16) % 2_000_000_000) + 10_000;
    const agora = buildHardwareRtcCredentials(channel, uid);
    const voiceAgent = await startHardwareVoiceAgent(channel, uid, input.language);
    const runtimeEnv = env();
    const rtmUid = String(uid);
    const rtmToken = RtmTokenBuilder.buildToken(
      agora.appId,
      runtimeEnv.AGORA_APP_CERTIFICATE!,
      rtmUid,
      60 * 60,
    );
    const startedAt = new Date().toISOString();
    const redis = getRedis();
    if (redis) {
      await redis.set(`hardware-session:${sessionId}`, {
        deviceId: input.deviceId,
        agentId: voiceAgent.agentId,
        channel,
        uid,
        language: input.language || runtimeEnv.AGORA_CONVOAI_ASR_LANGUAGE,
        startedAt,
      }, { ex: 60 * 60 * 2 });
    }

    return NextResponse.json({
      sessionId,
      startedAt,
      device,
      agora: { ...agora, rtmUid, rtmToken },
      agent: voiceAgent,
    }, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    console.error("[hardware-session-start]", error);
    return NextResponse.json(
      { error: error instanceof z.ZodError ? "Hardware session data is invalid." : error instanceof Error ? error.message : "Hardware session failed." },
      { status: error instanceof z.ZodError ? 400 : 500 },
    );
  }
}
