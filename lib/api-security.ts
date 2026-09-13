import { NextResponse } from "next/server";

import { authEnforcementMode } from "@/lib/auth-policy";

function noStoreError(message: string, status: number): NextResponse {
  return NextResponse.json(
    { error: message },
    {
      status,
      headers: {
        "cache-control": "no-store, max-age=0",
        pragma: "no-cache",
        "x-content-type-options": "nosniff",
      },
    },
  );
}

/**
 * Defense-in-depth user check for privileged Route Handlers.
 *
 * Middleware remains the first boundary, but service-role routes must not rely
 * on path matching alone. Credential-free access is retained only when both
 * public Supabase values are absent in local development.
 */
export async function requireAuthenticatedSession(): Promise<NextResponse | null> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim() || "";
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim() || "";
  const mode = authEnforcementMode({
    nodeEnv: process.env.NODE_ENV,
    supabaseUrl: url,
    supabaseAnonKey: anonKey,
  });

  if (mode === "disabled") return null;
  if (mode === "misconfigured") {
    return noStoreError(
      "Lantern authentication is not configured correctly.",
      503,
    );
  }

  // Keep the server-only session helper out of credential-free Node tests; a
  // configured deployment loads it only after the fail-closed mode check.
  const { getAuthenticatedLanternUser } = await import("@/lib/supabase/session");
  const user = await getAuthenticatedLanternUser();
  if (!user) {
    return noStoreError("Authentication required.", 401);
  }
  return null;
}

/** Prevent production mutations from claiming success without durable state. */
export function requireProductionPersistence(
  persistenceAvailable: boolean,
  message = "Supabase persistence is required in production.",
  runtimeEnvironment = process.env.NODE_ENV,
): NextResponse | null {
  return runtimeEnvironment === "production" && !persistenceAvailable
    ? noStoreError(message, 503)
    : null;
}
