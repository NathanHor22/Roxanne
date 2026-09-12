import { NextResponse } from "next/server";

import { requireOwnerSession, requireProductionPersistence } from "@/lib/api-security";
import { env } from "@/lib/env";
import {
  GoogleCalendarProviderError,
  createGoogleAuthorizationUrl,
  createGoogleOAuthState,
  getGoogleOAuthConfig,
  requireApprovalSecret,
} from "@/lib/providers/google-calendar";
import {
  getServerSupabase,
  resolveDemoUserId,
} from "@/lib/supabase/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: Request) {
  const authError = await requireOwnerSession();
  if (authError) return authError;
  try {
    const client = getServerSupabase();
    const readinessError = requireProductionPersistence(
      Boolean(client),
      "Supabase credential persistence is required before connecting Google in production.",
    );
    if (readinessError) return readinessError;
    if (!client) {
      return NextResponse.json(
        { error: "Supabase must be configured before connecting Google." },
        { status: 503 },
      );
    }
    const userId = await resolveDemoUserId(client, { createIfMissing: true });
    if (!userId) {
      return NextResponse.json(
        { error: "No Lantern user is available for this Google connection." },
        { status: 503 },
      );
    }
    // `resolveDemoUserId` can find an Auth user created before the database
    // trigger existed. Ensure the FK target is present for provider_connections.
    const runtime = env();
    const { error: profileError } = await client.from("profiles").upsert(
      {
        id: userId,
        email: runtime.DEMO_USER_EMAIL,
        name: "Nathan Hor",
      },
      { onConflict: "id" },
    );
    if (profileError) {
      return NextResponse.json(
        { error: "The Lantern profile could not be prepared for Google." },
        { status: 503 },
      );
    }

    const requestUrl = new URL(request.url);
    const config = getGoogleOAuthConfig();
    const state = createGoogleOAuthState(
      { userId, returnTo: requestUrl.searchParams.get("returnTo") },
      requireApprovalSecret(config.approvalSecret),
    );
    const authorizationUrl = createGoogleAuthorizationUrl(state, {
      config,
      loginHint: runtime.DEMO_USER_EMAIL,
    });

    return NextResponse.redirect(authorizationUrl);
  } catch (error) {
    const status =
      error instanceof GoogleCalendarProviderError &&
      error.code === "configuration"
        ? 503
        : 500;
    return NextResponse.json(
      { error: "Google connection could not be started." },
      { status },
    );
  }
}
