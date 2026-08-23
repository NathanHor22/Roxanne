import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

import {
  authEnforcementMode,
  isOwnerEmail,
  isPublicAuthPath,
} from "@/lib/auth-policy";

function copyCookies(from: NextResponse, to: NextResponse): NextResponse {
  from.cookies.getAll().forEach((cookie) => to.cookies.set(cookie));
  return to;
}

function unauthenticatedResponse(
  request: NextRequest,
  refreshedResponse: NextResponse,
): NextResponse {
  if (request.nextUrl.pathname.startsWith("/api/")) {
    return copyCookies(
      refreshedResponse,
      NextResponse.json(
        { error: "Authentication required." },
        { status: 401 },
      ),
    );
  }

  const loginUrl = request.nextUrl.clone();
  loginUrl.pathname = "/login";
  loginUrl.search = "";
  const requestedPath = `${request.nextUrl.pathname}${request.nextUrl.search}`;
  if (requestedPath !== "/") loginUrl.searchParams.set("next", requestedPath);
  return copyCookies(refreshedResponse, NextResponse.redirect(loginUrl));
}

function forbiddenResponse(
  request: NextRequest,
  refreshedResponse: NextResponse,
): NextResponse {
  if (request.nextUrl.pathname.startsWith("/api/")) {
    return copyCookies(
      refreshedResponse,
      NextResponse.json(
        { error: "This account is not authorized for Roxanne." },
        { status: 403 },
      ),
    );
  }

  const loginUrl = request.nextUrl.clone();
  loginUrl.pathname = "/login";
  loginUrl.search = "?error=unauthorized";
  return copyCookies(refreshedResponse, NextResponse.redirect(loginUrl));
}

export async function proxy(request: NextRequest) {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const mode = authEnforcementMode({
    nodeEnv: process.env.NODE_ENV,
    supabaseUrl,
    supabaseAnonKey,
  });

  if (mode === "disabled") return NextResponse.next({ request });

  if (mode === "misconfigured") {
    const message =
      "Roxanne authentication is not configured. Set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY.";
    if (request.nextUrl.pathname.startsWith("/api/")) {
      return NextResponse.json({ error: message }, { status: 503 });
    }
    return new NextResponse(message, {
      status: 503,
      headers: { "content-type": "text/plain; charset=utf-8" },
    });
  }

  let response = NextResponse.next({ request });
  const supabase = createServerClient(supabaseUrl!, supabaseAnonKey!, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(
        cookiesToSet: Array<{
          name: string;
          value: string;
          options: CookieOptions;
        }>,
      ) {
        cookiesToSet.forEach(({ name, value }) => {
          request.cookies.set(name, value);
        });
        response = NextResponse.next({ request });
        cookiesToSet.forEach(({ name, value, options }) => {
          response.cookies.set(name, value, options);
        });
      },
    },
  });

  const {
    data: { user },
  } = await supabase.auth.getUser();
  const isPublicPath = isPublicAuthPath(request.nextUrl.pathname);

  if (!user) {
    return isPublicPath
      ? response
      : unauthenticatedResponse(request, response);
  }

  const ownerEmail = process.env.DEMO_USER_EMAIL || "nathanhor2001@gmail.com";
  if (!isOwnerEmail(user.email, ownerEmail)) {
    await supabase.auth.signOut();
    return isPublicPath
      ? response
      : forbiddenResponse(request, response);
  }

  if (request.nextUrl.pathname === "/login") {
    const destination = request.nextUrl.clone();
    destination.pathname = "/";
    destination.search = "";
    return copyCookies(response, NextResponse.redirect(destination));
  }

  return response;
}

export const config = {
  matcher: [
    // API routes are always authenticated, including dynamic values that look
    // like static filenames (for example `/api/processing/example.js`).
    "/api/:path*",
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico|css|js|map|woff|woff2|ttf)$).*)",
  ],
};
