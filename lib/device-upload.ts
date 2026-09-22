import { createHash } from "node:crypto";
import { z } from "zod";
import { MAX_AUDIO_BYTES } from "./audio-upload";
import { parseLanternWav } from "./wav";

export const TUS_CHUNK_BYTES = 6 * 1024 * 1024;
export const deviceUploadRequest = z.object({
  action: z.enum(["prepare", "progress", "commit"]),
  eventId: z.string().uuid(),
  bytes: z.number().int().min(46).max(MAX_AUDIO_BYTES),
  sha256: z.string().regex(/^[0-9a-f]{64}$/u),
  uploadedBytes: z.number().int().nonnegative().optional(),
}).strict();

export function directStorageEndpoint(supabaseUrl: string) {
  const url = new URL(supabaseUrl);
  if (url.protocol !== "https:") throw new Error("Storage must use HTTPS.");
  if (/^[a-z0-9]+\.supabase\.co$/u.test(url.hostname)) {
    url.hostname = url.hostname.replace(".supabase.co", ".storage.supabase.co");
  }
  // Signed-upload capabilities use Supabase's /sign route. The normal TUS
  // endpoint expects a user JWT and rejects x-signature-only device uploads.
  url.pathname = "/storage/v1/upload/resumable/sign";
  url.search = "";
  url.hash = "";
  return url.toString();
}

export function validateTusLocation(location: string, endpoint: string) {
  const url = new URL(location, endpoint);
  const base = new URL(endpoint);
  if (url.origin !== base.origin || !url.pathname.startsWith(base.pathname + "/") ||
      url.username || url.password || url.hash) throw new Error("Invalid storage upload location.");
  return url.toString();
}

export function verifyDeviceArchive(bytes: Uint8Array, expectedBytes: number, sha256: string) {
  if (bytes.length !== expectedBytes) throw new Error("The complete recording has not reached storage.");
  const wav = parseLanternWav(bytes);
  if (createHash("sha256").update(bytes).digest("hex") !== sha256) {
    throw new Error("Recording integrity check failed. The SD original must be retained.");
  }
  return wav;
}
