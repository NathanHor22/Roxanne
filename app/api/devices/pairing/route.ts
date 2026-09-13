import { NextResponse } from "next/server";
import { z } from "zod";

import {
  createPairingCode,
  hashLanternSecret,
} from "@/lib/lantern-device-auth";
import {
  requireAuthenticatedSession,
  requireProductionPersistence,
} from "@/lib/api-security";
import {
  getServerSupabase,
  resolveWorkspaceUserId,
} from "@/lib/supabase/server";

export const runtime = "nodejs";

const requestSchema = z
  .object({
    name: z.string().trim().min(1).max(100).default("Nathan's Lantern"),
  })
  .strict();

export async function POST(request: Request) {
  const authError = await requireAuthenticatedSession();
  if (authError) return authError;
  const client = getServerSupabase();
  const readinessError = requireProductionPersistence(
    Boolean(client),
    "Supabase is required to pair Lantern.",
  );
  if (readinessError) return readinessError;

  try {
    const input = requestSchema.parse(await request.json().catch(() => ({})));
    if (!client) {
      return NextResponse.json(
        { error: "Connect Supabase before pairing Lantern." },
        { status: 503, headers: { "cache-control": "no-store" } },
      );
    }
    const userId = await resolveWorkspaceUserId(client);
    if (!userId) throw new Error("The Lantern workspace is unavailable.");

    const code = createPairingCode();
    const expiresAt = new Date(Date.now() + 10 * 60_000).toISOString();
    const { data, error } = await client
      .from("device_pairings")
      .insert({
        user_id: userId,
        code_hash: hashLanternSecret(code),
        device_name: input.name,
        expires_at: expiresAt,
      })
      .select("id,expires_at")
      .single();
    if (error || !data) throw new Error(error?.message || "Pairing could not begin.");

    return NextResponse.json(
      {
        pairing: {
          id: data.id,
          code: `${code.slice(0, 5)}-${code.slice(5)}`,
          expiresAt: data.expires_at,
        },
      },
      { status: 201, headers: { "cache-control": "no-store" } },
    );
  } catch (error) {
    console.error("[device-pairing]", error);
    return NextResponse.json(
      {
        error:
          error instanceof z.ZodError
            ? "Lantern pairing details are invalid."
            : error instanceof Error
              ? error.message
              : "Pairing could not begin.",
      },
      {
        status: error instanceof z.ZodError ? 400 : 500,
        headers: { "cache-control": "no-store" },
      },
    );
  }
}
