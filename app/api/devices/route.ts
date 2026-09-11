import { NextResponse } from "next/server";

import {
  requireOwnerSession,
  requireProductionPersistence,
} from "@/lib/api-security";
import {
  getServerSupabase,
  resolveDemoUserId,
} from "@/lib/supabase/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  const authError = await requireOwnerSession();
  if (authError) return authError;

  const client = getServerSupabase();
  const readinessError = requireProductionPersistence(
    Boolean(client),
    "Supabase is required to load Lantern devices.",
  );
  if (readinessError) return readinessError;
  if (!client) {
    return NextResponse.json(
      { devices: [], source: "unconfigured" },
      { headers: { "cache-control": "no-store" } },
    );
  }

  try {
    const userId = await resolveDemoUserId(client, { createIfMissing: false });
    if (!userId) {
      return NextResponse.json(
        { devices: [], source: "supabase" },
        { headers: { "cache-control": "no-store" } },
      );
    }
    const { data, error } = await client
      .from("devices")
      .select("id,name,model,firmware_version,last_seen_at,status,device_state,state_version,battery_level,network_type,free_heap_bytes,last_error,revoked_at")
      .eq("user_id", userId)
      .is("revoked_at", null)
      .order("created_at", { ascending: true });
    if (error) throw new Error(error.message);

    return NextResponse.json(
      { devices: data || [], source: "supabase" },
      { headers: { "cache-control": "no-store" } },
    );
  } catch (error) {
    console.error("[devices]", error);
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Lantern devices could not be loaded.",
      },
      { status: 500, headers: { "cache-control": "no-store" } },
    );
  }
}
