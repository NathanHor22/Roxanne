"use client";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

let cached: SupabaseClient | null | undefined;

/** Public/anon browser client used only with short-lived signed upload tokens. */
export function getBrowserSupabase(): SupabaseClient | null {
  if (cached !== undefined) return cached;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  cached = url && anonKey
    ? createClient(url, anonKey, {
        auth: { autoRefreshToken: false, persistSession: false },
      })
    : null;
  return cached;
}
