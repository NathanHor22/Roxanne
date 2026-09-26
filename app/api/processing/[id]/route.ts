import { NextResponse } from "next/server";
import { requireAuthenticatedSession } from "@/lib/api-security";
import { getProcessingState } from "@/lib/redis";
import { getAuthenticatedLanternUser } from "@/lib/supabase/session";

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const authError = await requireAuthenticatedSession();
  if (authError) return authError;
  const { id } = await context.params;
  const user = await getAuthenticatedLanternUser();
  const ownerId = user?.id || "local-development";
  const state = await getProcessingState(ownerId, id);
  return state ? NextResponse.json(state) : NextResponse.json({ status: "unknown" }, { status: 404 });
}
