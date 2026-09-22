import { NextResponse } from "next/server";
import { z } from "zod";

import { requireAuthenticatedSession, requireProductionPersistence } from "@/lib/api-security";
import { getServerSupabase, resolveWorkspaceUserId } from "@/lib/supabase/server";

export const runtime = "nodejs";

const registerDeviceSchema = z
  .object({
    deviceId: z.string().uuid().optional(),
    name: z.string().trim().min(1).max(100),
    firmwareVersion: z.string().trim().min(1).max(80).optional(),
  })
  .strict();

export async function POST(request: Request) {
  const authError = await requireAuthenticatedSession();
  if (authError) return authError;
  const client = getServerSupabase();
  const readinessError = requireProductionPersistence(
    Boolean(client),
    "Supabase is required to register hardware.",
  );
  if (readinessError) return readinessError;

  try {
    const input = registerDeviceSchema.parse(await request.json());
    if (!client) throw new Error("Supabase is unavailable.");
    const userId = await resolveWorkspaceUserId(client);
    if (!userId) throw new Error("The Quipus workspace is unavailable.");

    const now = new Date().toISOString();
    const record = {
      ...(input.deviceId ? { id: input.deviceId } : {}),
      user_id: userId,
      name: input.name,
      firmware_version: input.firmwareVersion ?? null,
      last_seen_at: now,
      status: "online",
    };
    const query = input.deviceId
      ? client.from("devices").upsert(record, { onConflict: "id" })
      : client.from("devices").insert(record);
    const { data, error } = await query
      .select("id,name,firmware_version,last_seen_at,status")
      .single();
    if (error || !data) throw new Error(error?.message || "Device registration failed.");

    return NextResponse.json(
      { device: data },
      { headers: { "cache-control": "no-store" } },
    );
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof z.ZodError
            ? "Device registration data is invalid."
            : error instanceof Error
              ? error.message
              : "Device registration failed.",
      },
      { status: error instanceof z.ZodError ? 400 : 500 },
    );
  }
}
