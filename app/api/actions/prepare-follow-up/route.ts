import { requireAuthenticatedSession } from "@/lib/api-security";
import { handlePrepareFollowUp } from "@/lib/prepare-follow-up-route";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 300;

export async function POST(request: Request) {
  const authError = await requireAuthenticatedSession();
  if (authError) return authError;
  return handlePrepareFollowUp(request);
}
