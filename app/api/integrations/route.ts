import { NextResponse } from "next/server";
import { requireOwnerSession } from "@/lib/api-security";
import { integrationStatus } from "@/lib/env";
import { getServerSupabase, resolveDemoUserId } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export async function GET() {
  const authError = await requireOwnerSession();
  if (authError) return authError;
  const integrations = integrationStatus();

  const client = getServerSupabase();
  if (client) {
    const userId = await resolveDemoUserId(client).catch(() => null);
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
