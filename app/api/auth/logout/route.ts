import { NextResponse } from "next/server";

import { createSessionSupabase } from "@/lib/supabase/session";

export async function POST(request: Request) {
  const supabase = await createSessionSupabase();
  if (supabase) await supabase.auth.signOut();

  return NextResponse.redirect(new URL("/login", request.url), { status: 303 });
}
