import { NextResponse } from "next/server";
import { z } from "zod";

import { requireOwnerSession, requireProductionPersistence } from "@/lib/api-security";
import { updateRelayMatchStatus } from "@/lib/relay-store";
import { getServerSupabase, resolveDemoUserId } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

const statusSchema = z.object({ status: z.literal("dismissed") }).strict();

export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const authError = await requireOwnerSession();
  if (authError) return authError;
  try {
    const { id } = await context.params;
    if (!z.string().uuid().safeParse(id).success)
      return NextResponse.json({ error: "Invalid Relay proposal ID." }, { status: 400 });
    const input = statusSchema.parse(await request.json());
    const client = getServerSupabase();
    const readinessError = requireProductionPersistence(Boolean(client));
    if (readinessError) return readinessError;
    if (!client)
      return NextResponse.json({ error: "Relay persistence is not configured." }, { status: 503 });
    const userId = await resolveDemoUserId(client, { createIfMissing: false });
    if (!userId)
      return NextResponse.json({ error: "The Lantern owner is unavailable." }, { status: 503 });
    const match = await updateRelayMatchStatus(client, userId, id, input.status);
    if (!match)
      return NextResponse.json({ error: "Relay proposal not found." }, { status: 404 });
    return NextResponse.json(
      { match },
      { headers: { "cache-control": "no-store, max-age=0" } },
    );
  } catch (error) {
    const status = error instanceof z.ZodError ? 400 : 500;
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Relay could not update the proposal." },
      { status },
    );
  }
}
