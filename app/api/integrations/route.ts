import { NextResponse } from "next/server";
import { requireAuthenticatedSession } from "@/lib/api-security";
import { integrationStatus } from "@/lib/env";
import { getServerSupabase, resolveWorkspaceUserId } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export async function GET() {
  const authError = await requireAuthenticatedSession();
  if (authError) return authError;
  const integrations = integrationStatus();

  const client = getServerSupabase();
  if (client) {
    const userId = await resolveWorkspaceUserId(client).catch(() => null);
    if (userId) {
      const { data, error } = await client.from("provider_connections").select("provider").eq("user_id", userId).eq("provider", "google").maybeSingle();
      if (error) return NextResponse.json({ error: "Connection status is temporarily unavailable." }, { status: 503, headers: { "cache-control": "no-store" } });
      if (data) integrations.google = true;
    }
  }

  return NextResponse.json({
    integrations,
    checkedAt: new Date().toISOString(),
  });
}
