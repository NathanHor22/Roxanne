import { NextResponse } from "next/server";

import { isOwnerEmail, sanitizeAuthReturnTo } from "@/lib/auth-policy";
import { createSessionSupabase } from "@/lib/supabase/session";

export const dynamic = "force-dynamic";

function loginRedirect(request: Request, error: "oauth" | "unauthorized") {
  const destination = new URL("/login", request.url);
  destination.searchParams.set("error", error);
  return NextResponse.redirect(destination);
}

export async function GET(request: Request) {
  const requestUrl = new URL(request.url);
  const code = requestUrl.searchParams.get("code");
  const nextPath = sanitizeAuthReturnTo(requestUrl.searchParams.get("next"));
  const supabase = await createSessionSupabase();

  if (!code || !supabase) return loginRedirect(request, "oauth");

  const { data, error } = await supabase.auth.exchangeCodeForSession(code);
  if (error || !data.user) return loginRedirect(request, "oauth");

  const ownerEmail = process.env.DEMO_USER_EMAIL || "nathanhor2001@gmail.com";
  if (!isOwnerEmail(data.user.email, ownerEmail)) {
    await supabase.auth.signOut();
    return loginRedirect(request, "unauthorized");
  }

  return NextResponse.redirect(new URL(nextPath, requestUrl.origin));
}
