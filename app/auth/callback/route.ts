import { NextResponse } from "next/server";

import { sanitizeAuthReturnTo } from "@/lib/auth-policy";
import { createSessionSupabase } from "@/lib/supabase/session";

export const dynamic = "force-dynamic";

function loginRedirect(request: Request) {
  const destination = new URL("/login", request.url);
  destination.searchParams.set("error", "oauth");
  return NextResponse.redirect(destination);
}

export async function GET(request: Request) {
  const requestUrl = new URL(request.url);
  const code = requestUrl.searchParams.get("code");
  const nextPath = sanitizeAuthReturnTo(requestUrl.searchParams.get("next"));
  const supabase = await createSessionSupabase();

  if (!code || !supabase) return loginRedirect(request);

  const { data, error } = await supabase.auth.exchangeCodeForSession(code);
  if (error || !data.user) return loginRedirect(request);

  return NextResponse.redirect(new URL(nextPath, requestUrl.origin));
}
