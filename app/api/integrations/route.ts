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
      const { data } = await client.from("provider_connections").select("provider").eq("user_id", userId).eq("provider", "google").maybeSingle();
      if (data) integrations.google = true;
    }
  }

  return NextResponse.json({
    integrations,
    checkedAt: new Date().toISOString(),
  });
}
