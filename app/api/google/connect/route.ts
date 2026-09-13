import { NextResponse } from "next/server";

import { requireAuthenticatedSession, requireProductionPersistence } from "@/lib/api-security";
import {
  GoogleCalendarProviderError,
  createGoogleAuthorizationUrl,
  createGoogleOAuthState,
  getGoogleOAuthConfig,
  requireApprovalSecret,
} from "@/lib/providers/google-calendar";
import { getServerSupabase } from "@/lib/supabase/server";
import { getAuthenticatedLanternUser } from "@/lib/supabase/session";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: Request) {
  const authError = await requireAuthenticatedSession();
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
    const user = await getAuthenticatedLanternUser();
    if (!user) {
      return NextResponse.json(
        { error: "Sign in before connecting Google Calendar." },
        { status: 401 },
      );
    }
    // Ensure users created before the multi-user trigger was installed have the
    // profile row required by provider_connections.
    const { error: profileError } = await client.from("profiles").upsert(
      {
        id: user.id,
        email: user.email || "",
        name: user.displayName,
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
      { userId: user.id, returnTo: requestUrl.searchParams.get("returnTo") },
      requireApprovalSecret(config.approvalSecret),
    );
    const authorizationUrl = createGoogleAuthorizationUrl(state, {
      config,
      loginHint: user.email || undefined,
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
