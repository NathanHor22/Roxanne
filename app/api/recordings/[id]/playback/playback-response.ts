import type { SupabaseClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";
import { z } from "zod";

export const recordingIdSchema = z.string().uuid();
export const PLAYBACK_URL_SECONDS = 2 * 60 * 60;

export function playbackJson(body: unknown, status = 200) {
  return NextResponse.json(body, {
    status,
    headers: {
      "cache-control": "no-store, max-age=0",
      "x-content-type-options": "nosniff",
    },
  });
}

function ownedAudioPath(
  path: unknown,
  ownerId: string,
  recordingId: string,
): path is string {
  if (typeof path !== "string" || path.length > 512) return false;
  const parts = path.split("/");
  if (parts.length !== 4 || parts[0].toLowerCase() !== ownerId.toLowerCase()) {
    return false;
  }
  const fileName = parts[3];
  const validFile =
    fileName.toLowerCase().startsWith(`${recordingId.toLowerCase()}.`) &&
    /\.(mp3|m4a|mp4|wav|webm|ogg)$/iu.test(fileName) &&
    fileName.split(".").length === 2;
  if (!validFile) return false;
  const datedBrowserUpload = /^\d{4}$/u.test(parts[1]) && /^(0[1-9]|1[0-2])$/u.test(parts[2]);
  const archivedDeviceUpload = parts[1] === "device" && z.string().uuid().safeParse(parts[2]).success;
  return datedBrowserUpload || archivedDeviceUpload;
}

function missingStorageObject(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const details = error as {
    status?: unknown;
    statusCode?: unknown;
    code?: unknown;
  };
  return (
    String(details.statusCode) === "404" ||
    String(details.status) === "404" ||
    details.code === "not_found" ||
    details.code === "NoSuchKey"
  );
}

/** Looks up the owner-scoped row and signs the original object without reading audio bytes. */
export async function recordingPlaybackResponse(
  client: SupabaseClient,
  recordingId: string,
  ownerId: string,
  now = Date.now(),
) {
  try {
    const { data: recording, error } = await client
      .from("recordings")
      .select("id,user_id,storage_path")
      .eq("id", recordingId)
      .eq("user_id", ownerId)
      .maybeSingle();
    if (error)
      return playbackJson(
        { error: "The original recording could not be loaded." },
        502,
      );
    if (
      !recording ||
      recording.id?.toLowerCase() !== recordingId.toLowerCase() ||
      recording.user_id?.toLowerCase() !== ownerId.toLowerCase() ||
      !ownedAudioPath(recording.storage_path, ownerId, recordingId)
    ) {
      return playbackJson(
        { error: "No original audio is available for this conversation." },
        404,
      );
    }

    const { data: signed, error: signingError } = await client.storage
      .from("recordings")
      .createSignedUrl(recording.storage_path, PLAYBACK_URL_SECONDS);
    if (missingStorageObject(signingError)) {
      return playbackJson(
        { error: "No original audio is available for this conversation." },
        404,
      );
    }
    if (signingError || !signed?.signedUrl) {
      return playbackJson(
        {
          error:
            "A private playback link could not be prepared. Please try again.",
        },
        502,
      );
    }
    return playbackJson({
      url: signed.signedUrl,
      expiresAt: new Date(now + PLAYBACK_URL_SECONDS * 1000).toISOString(),
    });
  } catch {
    return playbackJson(
      {
        error:
          "A private playback link could not be prepared. Please try again.",
      },
      502,
    );
  }
}
