import { NextResponse } from "next/server";
import { z } from "zod";

import {
  requireAuthenticatedSession,
  requireProductionPersistence,
} from "@/lib/api-security";
import {
  getServerSupabase,
  resolveWorkspaceUserId,
} from "@/lib/supabase/server";

export const runtime = "nodejs";

const paramsSchema = z.object({ id: z.string().uuid() }).strict();
const requestSchema = z.object({ action: z.literal("revoke") }).strict();

export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const authError = await requireAuthenticatedSession();
  if (authError) return authError;
  const client = getServerSupabase();
  const readinessError = requireProductionPersistence(
    Boolean(client),
    "Supabase is required to manage Lantern.",
  );
  if (readinessError) return readinessError;

  try {
    const { id } = paramsSchema.parse(await context.params);
    requestSchema.parse(await request.json());
    if (!client) throw new Error("Lantern storage is unavailable.");
    const userId = await resolveWorkspaceUserId(client);
    if (!userId) throw new Error("The Lantern workspace is unavailable.");
    const now = new Date().toISOString();
    const { data, error } = await client
      .from("devices")
      .update({
        revoked_at: now,
        credential_hash: null,
        status: "offline",
        updated_at: now,
      })
      .eq("id", id)
      .eq("user_id", userId)
      .is("revoked_at", null)
      .select("id")
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!data) {
      return NextResponse.json(
        { error: "Lantern device was not found." },
        { status: 404, headers: { "cache-control": "no-store" } },
      );
    }
    return NextResponse.json(
      { revoked: true, deviceId: data.id },
      { headers: { "cache-control": "no-store" } },
    );
  } catch (error) {
    console.error("[device-revoke]", error);
    return NextResponse.json(
      {
        error:
          error instanceof z.ZodError
            ? "Lantern management request is invalid."
            : error instanceof Error
              ? error.message
              : "Lantern could not be revoked.",
      },
      {
        status: error instanceof z.ZodError ? 400 : 500,
        headers: { "cache-control": "no-store" },
      },
    );
  }
}
