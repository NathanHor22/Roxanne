export const MAX_AUDIO_BYTES = 25 * 1024 * 1024;

export const STORAGE_AUDIO_TYPES = [
  "audio/mpeg",
  "audio/mp4",
  "audio/x-m4a",
  "audio/wav",
  "audio/webm",
  "audio/ogg",
] as const;

export type StorageAudioType = (typeof STORAGE_AUDIO_TYPES)[number];

const storageAudioTypeSet = new Set<string>(STORAGE_AUDIO_TYPES);

/**
 * Converts common browser MIME aliases (or an empty MIME) to one accepted by
 * the private Supabase recordings bucket. Returns null for unsupported media.
 */
export function normalizeAudioContentType(
  fileName: string,
  contentType: string | null | undefined,
): StorageAudioType | null {
  const candidate = contentType?.trim().toLowerCase() || "";
  if (storageAudioTypeSet.has(candidate)) return candidate as StorageAudioType;
  if (candidate === "audio/mp3") return "audio/mpeg";
  if (candidate === "audio/wave" || candidate === "audio/x-wav") return "audio/wav";

  // Some MediaRecorder/browser combinations omit the MIME type. Only infer it
  // from a short allowlist; never trust an arbitrary filename extension.
  const extension = /\.([a-z0-9]{2,5})$/iu.exec(fileName)?.[1]?.toLowerCase();
  if (extension === "mp3") return "audio/mpeg";
  if (extension === "mp4" || extension === "m4a") return "audio/mp4";
  if (extension === "wav") return "audio/wav";
  if (extension === "webm") return "audio/webm";
  if (extension === "ogg") return "audio/ogg";
  return null;
}

export function safeAudioExtension(
  fileName: string,
  contentType: StorageAudioType,
): string {
  const supplied = /\.([a-z0-9]{2,5})$/iu.exec(fileName)?.[1]?.toLowerCase();
  if (supplied && ["mp3", "m4a", "mp4", "wav", "webm", "ogg"].includes(supplied)) {
    return supplied;
  }
  if (contentType === "audio/mpeg") return "mp3";
  if (contentType === "audio/wav") return "wav";
  if (contentType === "audio/webm") return "webm";
  if (contentType === "audio/ogg") return "ogg";
  return "m4a";
}
