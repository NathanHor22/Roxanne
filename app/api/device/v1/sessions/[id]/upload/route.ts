import { NextResponse } from "next/server";
import { z } from "zod";
import { deviceUploadRequest, directStorageEndpoint, TUS_CHUNK_BYTES, validateTusLocation, verifyDeviceArchive } from "@/lib/device-upload";
import { authenticateLantern } from "@/lib/lantern-device-auth";
import { getServerSupabase } from "@/lib/supabase/server";
import { env } from "@/lib/env";

export const runtime = "nodejs";
export const maxDuration = 120;
const reply = (body: unknown, status = 200) => NextResponse.json(body, { status, headers: { "cache-control": "no-store" } });

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const client = getServerSupabase();
  if (!client) return reply({ error: "Storage unavailable." }, 503);
  const device = await authenticateLantern(request, client);
  if (!device) return reply({ error: "Device credential is invalid or revoked." }, 403);
  try {
    const id = z.string().uuid().parse((await context.params).id);
    const input = deviceUploadRequest.parse(await request.json());
    const { data: session, error } = await client.from("lantern_sessions")
      .select("id,state,recording_id,audio_event_id").eq("id", id).eq("user_id", device.userId).eq("device_id", device.id).maybeSingle();
    if (error) throw error;
    if (!session) return reply({ error: "Session not found." }, 404);
    if (session.recording_id) {
      return session.audio_event_id === input.eventId
        ? reply({ accepted: true, archived: true, uploadedBytes: input.bytes })
        : reply({ error: "Different audio is already attached." }, 409);
    }
    if (session.state !== "finalising") return reply({ error: "Stop recording before uploading." }, 409);
    const path = `${device.userId}/device/${id}/${input.eventId}.wav`;
    const { error: insertError } = await client.from("lantern_audio_uploads").upsert({
      session_id: id, event_id: input.eventId, storage_path: path, total_bytes: input.bytes, sha256: input.sha256,
    }, { onConflict: "session_id", ignoreDuplicates: true });
    if (insertError) throw insertError;
    const { data: manifest, error: manifestError } = await client.from("lantern_audio_uploads").select("*").eq("session_id", id).single();
    if (manifestError) throw manifestError;
    if (manifest.event_id !== input.eventId || manifest.sha256 !== input.sha256 || Number(manifest.total_bytes) !== input.bytes) {
      return reply({ error: "The upload does not match this session's original WAV." }, 409);
    }
    if (input.action === "progress") {
      if (input.uploadedBytes === undefined || input.uploadedBytes > input.bytes) return reply({ error: "Invalid upload progress." }, 400);
      // Display only. Archive acceptance always requires reading and hashing
      // the complete stored object; device-reported progress cannot bypass it.
      const { error: progressError } = await client.from("lantern_sessions").update({ upload_bytes: input.uploadedBytes })
        .eq("id", id).eq("user_id", device.userId).lte("upload_bytes", input.uploadedBytes);
      if (progressError) throw progressError;
      return reply({ accepted: true });
    }
    if (input.action === "commit") {
      const { data: audio, error: readError } = await client.storage.from("recordings").download(path);
      if (readError || !audio) return reply({ error: "Upload is incomplete. Keep the SD original and retry." }, 409);
      verifyDeviceArchive(new Uint8Array(await audio.arrayBuffer()), input.bytes, input.sha256);
      const { data: recordingId, error: attachError } = await client.rpc("attach_lantern_direct_audio", {
        p_session_id: id, p_user_id: device.userId, p_device_id: device.id,
      });
      if (attachError) throw attachError;
      return reply({ accepted: true, archived: true, recordingId, uploadedBytes: input.bytes });
    }
    const endpoint = directStorageEndpoint(env().NEXT_PUBLIC_SUPABASE_URL!);
    const { data: signed, error: signingError } = await client.storage.from("recordings").createSignedUploadUrl(path);
    if (signingError || !signed) throw new Error("Could not authorize the upload.");
    const headers = { "tus-resumable": "1.0.0", "x-signature": signed.token };
    let location = manifest.upload_url ? validateTusLocation(manifest.upload_url, endpoint) : null;
    let offset = 0;
    if (location) {
      const head = await fetch(location, { method: "HEAD", headers, redirect: "error", signal: AbortSignal.timeout(15000) });
      if (head.status === 404 || head.status === 410) location = null;
      else if (!head.ok) throw new Error(`Could not resume storage upload (HTTP ${head.status}).`);
      else {
        const storedOffset = head.headers.get("upload-offset");
        if (!storedOffset || !/^\d+$/u.test(storedOffset)) throw new Error("Storage omitted its upload offset.");
        offset = Number(storedOffset);
      }
    }
    if (!location) {
      const metadata = Object.entries({ bucketName: "recordings", objectName: path, contentType: "audio/wav", cacheControl: "3600" })
        .map(([key, value]) => `${key} ${Buffer.from(value).toString("base64")}`).join(",");
      const created = await fetch(endpoint, { method: "POST", headers: { ...headers,
        "upload-length": String(input.bytes), "upload-metadata": metadata,
      }, redirect: "error", signal: AbortSignal.timeout(15000) });
      if (created.status !== 201 || !created.headers.get("location")) throw new Error(`Could not start storage upload (HTTP ${created.status}, location ${created.headers.has("location") ? "present" : "missing"}).`);
      location = validateTusLocation(created.headers.get("location")!, endpoint);
      const { error: saveError } = await client.from("lantern_audio_uploads").update({ upload_url: location, url_created_at: new Date().toISOString() }).eq("session_id", id);
      if (saveError) throw saveError;
    }
    if (!Number.isInteger(offset) || offset < 0 || offset > input.bytes) throw new Error("Storage returned an invalid offset.");
    const { error: progressError } = await client.from("lantern_sessions").update({
      upload_bytes: offset, upload_total_bytes: input.bytes, processing_stage: "uploading",
    }).eq("id", id).eq("user_id", device.userId);
    if (progressError) throw progressError;
    return reply({ archived: false, uploadUrl: location, token: signed.token, uploadedBytes: offset, chunkBytes: TUS_CHUNK_BYTES });
  } catch (cause) {
    console.error("[device-upload]", cause instanceof Error ? cause.message : "Storage failure");
    return reply({ error: cause instanceof z.ZodError ? "Invalid upload manifest." : "Upload could not be verified or resumed. Keep the SD original and retry." }, cause instanceof z.ZodError ? 400 : 502);
  }
}
