import { requireAuthenticatedSession } from "@/lib/api-security";
import {
  playbackJson,
  recordingIdSchema,
  recordingPlaybackResponse,
} from "./playback-response";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const authError = await requireAuthenticatedSession();
  if (authError) return authError;
  const id = recordingIdSchema.safeParse((await context.params).id);
  if (!id.success)
    return playbackJson({ error: "A valid recording ID is required." }, 400);

  try {
    const { getServerSupabase, resolveWorkspaceUserId } = await import(
      "@/lib/supabase/server"
    );
    const client = getServerSupabase();
    if (!client)
      return playbackJson(
        { error: "Private recording storage is not configured." },
        503,
      );
    const ownerId = await resolveWorkspaceUserId(client);
    if (!ownerId)
      return playbackJson(
        { error: "No original audio is available for this conversation." },
        404,
      );
    return await recordingPlaybackResponse(
      client,
      id.data.toLowerCase(),
      ownerId,
    );
  } catch {
    return playbackJson(
      { error: "Private recording storage is unavailable." },
      503,
    );
  }
}
