import "server-only";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { env } from "@/lib/env";

let cached: SupabaseClient | null | undefined;

/** Service-role client for server routes only. Returns null when unconfigured. */
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

export async function resolveDemoUserId(
  client = getServerSupabase(),
  options: { createIfMissing?: boolean } = {},
): Promise<string | null> {
  if (!client) return null;
  const runtime = env();
  if (runtime.DEMO_USER_ID) return runtime.DEMO_USER_ID;

  const { data: listed, error: listError } = await client.auth.admin.listUsers({ page: 1, perPage: 1000 });
  if (listError) throw new Error(`Could not resolve the Roxanne user: ${listError.message}`);
  const existing = listed.users.find((user) => user.email?.toLowerCase() === runtime.DEMO_USER_EMAIL.toLowerCase());
  if (existing) return existing.id;

  if (!options.createIfMissing) return null;

  const { data: created, error: createError } = await client.auth.admin.createUser({
    email: runtime.DEMO_USER_EMAIL,
    email_confirm: true,
    user_metadata: { full_name: "Nathan Hor" },
  });
  if (createError || !created.user) {
    throw new Error(`Could not create the Roxanne user: ${createError?.message || "unknown error"}`);
  }
  return created.user.id;
}
