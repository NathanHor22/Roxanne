import "server-only";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { env } from "@/lib/env";
import { getAuthenticatedLanternUser } from "@/lib/supabase/session";

let cached: SupabaseClient | null | undefined;

/** Elevated server client for server routes only. Returns null when unconfigured. */
export function getServerSupabase(): SupabaseClient | null {
  if (cached !== undefined) return cached;
  const runtime = env();
  if (!runtime.NEXT_PUBLIC_SUPABASE_URL || !runtime.SUPABASE_SERVICE_ROLE_KEY) {
    cached = null;
    return null;
  }
  cached = createClient(runtime.NEXT_PUBLIC_SUPABASE_URL, runtime.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  return cached;
}

export async function resolveWorkspaceUserId(
  client = getServerSupabase(),
): Promise<string | null> {
  if (!client) return null;
  return (await getAuthenticatedLanternUser())?.id ?? null;
}
