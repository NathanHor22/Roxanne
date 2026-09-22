import { NextResponse } from "next/server";
import { requireAuthenticatedSession } from "@/lib/api-security";
import { executeCalendarRequest } from "@/lib/calendar-action-service";
import { getServerSupabase, resolveWorkspaceUserId } from "@/lib/supabase/server";
export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export async function POST(request: Request) {
  const error = await requireAuthenticatedSession();
  if (error) return error;
  const client = getServerSupabase();
  const userId = client ? await resolveWorkspaceUserId(client) : null;
  if (!userId) return NextResponse.json({ error: "Sign in before using Google Calendar." }, { status: 401 });
  return executeCalendarRequest(request, userId);
}
