import { after, NextResponse } from "next/server";
import { z } from "zod";
import { getAuthenticatedLanternUser } from "@/lib/supabase/session";
import { getServerSupabase } from "@/lib/supabase/server";
import { processNextRecording } from "@/lib/processing-queue";

export const runtime = "nodejs";
export const maxDuration = 300;
export async function POST(_request: Request, context: { params: Promise<{ id: string }> }) {
  const user = await getAuthenticatedLanternUser();
  const client = getServerSupabase();
  if (!user || !client) return NextResponse.json({ error: "Sign in first." }, { status: 401 });
  const id = z.string().uuid().safeParse((await context.params).id);
  if (!id.success) return NextResponse.json({ error: "Invalid recording." }, { status: 400 });
  const { data: sessionId, error } = await client.rpc("retry_lantern_processing", { p_recording_id: id.data, p_user_id: user.id });
  if (error || !sessionId) return NextResponse.json({ error: "This recording is already processing, complete, or unavailable. Refresh its status." }, { status: 409 });
  after(async () => { await processNextRecording(client, user.id, sessionId).catch(() => console.error("Recording retry will resume after its lease expires.")); });
  return NextResponse.json({ accepted: true }, { headers: { "cache-control": "no-store" } });
}
