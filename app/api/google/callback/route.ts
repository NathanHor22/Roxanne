import { NextResponse } from "next/server";

import { requireAuthenticatedSession, requireProductionPersistence } from "@/lib/api-security";
import { env } from "@/lib/env";
import {
  exchangeGoogleAuthorizationCode,
  getGoogleOAuthConfig,
  persistGoogleCredentials,
  readGoogleOAuthState,
  requireApprovalSecret,
  sanitizeGoogleReturnTo,
} from "@/lib/providers/google-calendar";
import {
  getServerSupabase,
  resolveWorkspaceUserId,
} from "@/lib/supabase/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function applicationOrigin(request: Request): string {
  const configured = env().NEXT_PUBLIC_APP_URL?.trim();
  if (configured) return new URL(configured).origin;
  return new URL(request.url).origin;
}

function resultRedirect(
  request: Request,
  returnTo: string,
  result: "connected" | "denied" | "error",
) {
  const destination = new URL(
    sanitizeGoogleReturnTo(returnTo),
    applicationOrigin(request),
  );
  destination.searchParams.set("google", result);
  return NextResponse.redirect(destination);
}

export async function GET(request: Request) {
  const authError = await requireAuthenticatedSession();
  if (authError) return authError;
  const readinessError = requireProductionPersistence(
    Boolean(getServerSupabase()),
    "Supabase credential persistence is required to complete Google connection in production.",
  );
  if (readinessError) return readinessError;
  const requestUrl = new URL(request.url);
  const encryptedState = requestUrl.searchParams.get("state");
  let returnTo = "/";

  try {
    const config = getGoogleOAuthConfig();
    const approvalSecret = requireApprovalSecret(config.approvalSecret);
    if (!encryptedState) return resultRedirect(request, returnTo, "error");

    const state = readGoogleOAuthState(encryptedState, approvalSecret);
    returnTo = state.returnTo;
    if (requestUrl.searchParams.has("error")) {
      return resultRedirect(request, returnTo, "denied");
    }

    const code = requestUrl.searchParams.get("code");
    if (!code) return resultRedirect(request, returnTo, "error");

    const client = getServerSupabase();
    if (!client) return resultRedirect(request, returnTo, "error");
    const resolvedUserId = await resolveWorkspaceUserId(client);
    if (!resolvedUserId || resolvedUserId !== state.userId) {
      return resultRedirect(request, returnTo, "error");
    }

    const credentials = await exchangeGoogleAuthorizationCode(code, { config });
    await persistGoogleCredentials(
      client,
      state.userId,
      credentials,
      approvalSecret,
    );
    return resultRedirect(request, returnTo, "connected");
  } catch {
    // Never reflect Google's authorization code, state, tokens, or provider error
    // details into a browser-visible response.
    return resultRedirect(request, returnTo, "error");
  }
}
