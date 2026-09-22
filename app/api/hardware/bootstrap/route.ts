import { NextResponse } from "next/server";
import { RtcRole, RtcTokenBuilder } from "agora-token";
import { z } from "zod";

import { requireAuthenticatedSession, requireProductionPersistence } from "@/lib/api-security";
import { env } from "@/lib/env";
import { getServerSupabase, resolveWorkspaceUserId } from "@/lib/supabase/server";

export const runtime = "nodejs";

const bootstrapSchema = z
  .object({
    deviceId: z.string().uuid(),
    uid: z.number().int().min(1).max(2_147_483_647).optional(),
  })
  .strict();

export async function POST(request: Request) {
  const authError = await requireAuthenticatedSession();
  if (authError) return authError;
  const client = getServerSupabase();
  const readinessError = requireProductionPersistence(
    Boolean(client),
    "Supabase is required to bootstrap hardware.",
  );
  if (readinessError) return readinessError;

  try {
    const input = bootstrapSchema.parse(await request.json());
    if (!client) throw new Error("Supabase is unavailable.");
    const userId = await resolveWorkspaceUserId(client);
    if (!userId) throw new Error("The Quipus workspace is unavailable.");

    const { data: device, error: deviceError } = await client
      .from("devices")
      .update({ status: "online", last_seen_at: new Date().toISOString() })
      .eq("id", input.deviceId)
      .eq("user_id", userId)
      .select("id,name,firmware_version")
      .maybeSingle();
    if (deviceError) throw new Error(deviceError.message);
    if (!device) {
      return NextResponse.json(
        { error: "Register this device before requesting Agora credentials." },
        { status: 404 },
      );
    }

    const runtime = env();
    const appId = runtime.NEXT_PUBLIC_AGORA_APP_ID?.trim();
    const certificate = runtime.AGORA_APP_CERTIFICATE?.trim();
    if (!appId || !certificate) {
      return NextResponse.json(
        { error: "Agora is not configured." },
        { status: 503 },
      );
    }
    if (!/^[0-9a-f]{32}$/iu.test(appId) || !/^[0-9a-f]{32}$/iu.test(certificate)) {
      throw new Error("Agora credentials are invalid.");
    }

    const compactDeviceId = input.deviceId.replaceAll("-", "");
    const channel = `lantern-hw-${compactDeviceId}`;
    const uid =
      input.uid ??
      ((Number.parseInt(compactDeviceId.slice(-7), 16) % 2_147_483_646) + 1);
    const ttlSeconds = 60 * 60;
    const expiresAtSeconds = Math.floor(Date.now() / 1000) + ttlSeconds;
    const token = RtcTokenBuilder.buildTokenWithUid(
      appId,
      certificate,
      channel,
      uid,
      RtcRole.PUBLISHER,
      ttlSeconds,
      ttlSeconds,
    );

    return NextResponse.json(
      {
        device,
        agora: {
          appId,
          channel,
          uid,
          token,
          expiresAt: new Date(expiresAtSeconds * 1000).toISOString(),
        },
      },
      { headers: { "cache-control": "no-store" } },
    );
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof z.ZodError
            ? "Hardware bootstrap data is invalid."
            : error instanceof Error
              ? error.message
              : "Hardware bootstrap failed.",
      },
      { status: error instanceof z.ZodError ? 400 : 500 },
    );
  }
}
