import { NextResponse } from "next/server";
import { getAuthenticatedLanternUser } from "@/lib/supabase/session";
import { getServerSupabase } from "@/lib/supabase/server";
import { sendApprovedEmail } from "@/lib/email-action";
export const runtime = "nodejs";
export async function POST(request: Request) {
  const user = await getAuthenticatedLanternUser();
  const client = getServerSupabase();
  if (!user || !client) return NextResponse.json({ error: "Sign in first." }, { status: 401 });
  try { return NextResponse.json(await sendApprovedEmail(client, user.id, await request.json())); }
  catch (cause) { return NextResponse.json({ error: cause instanceof Error ? cause.message : "Email could not be confirmed." }, { status: 409 }); }
}
