import { RequestError } from "./protocol.js";

export interface DocumentPayload { fileName: string; mimeType: "audio/wav" | "text/plain"; url?: string; base64?: string; }
export function reportRecipient(value: unknown) {
  if (typeof value !== "string") throw new RequestError(400, "Recipient is required.");
  let digits = value.replace(/[\s()+-]/gu, "");
  if (digits.startsWith("0")) digits = `6${digits}`;
  if (!/^[1-9]\d{7,14}$/u.test(digits)) throw new RequestError(400, "Use a phone number including its country code.");
  return digits;
}
export function parseDocument(value: unknown, storageUrl = process.env.MEDIA_STORAGE_ORIGIN): DocumentPayload {
  if (!value || typeof value !== "object") throw new RequestError(400, "Document is required.");
  const input = value as Record<string, unknown>;
  if (typeof input.fileName !== "string" || !/^[a-zA-Z0-9_. -]{1,100}$/u.test(input.fileName)) throw new RequestError(400, "Invalid filename.");
  if (input.mimeType !== "audio/wav" && input.mimeType !== "text/plain") throw new RequestError(400, "Invalid media type.");
  if (input.mimeType === "text/plain" && typeof input.base64 === "string" && input.base64.length <= 1500000 && /^[A-Za-z0-9+/]*={0,2}$/u.test(input.base64) && !input.url) {
    return { fileName: input.fileName, mimeType: input.mimeType, base64: input.base64 };
  }
  if (input.mimeType !== "audio/wav" || typeof input.url !== "string" || !storageUrl || input.base64) throw new RequestError(400, "Recording storage is not configured.");
  const url = new URL(input.url);
  const trusted = new URL(storageUrl);
  if (url.protocol !== "https:" || url.origin !== trusted.origin || url.username || url.password || url.hash || !url.pathname.startsWith("/storage/v1/object/sign/recordings/")) {
    throw new RequestError(400, "Recording URL is not permitted.");
  }
  return { fileName: input.fileName, mimeType: input.mimeType, url: url.toString() };
}
export async function readDocument(document: DocumentPayload, fetcher: typeof fetch = fetch) {
  if (document.base64 !== undefined) return Buffer.from(document.base64, "base64");
  const response = await fetcher(document.url!, { redirect: "error", signal: AbortSignal.timeout(60000) });
  if (!response.ok || !response.body) throw new RequestError(502, "Recording could not be downloaded.");
  const maximum = 25 * 1024 * 1024;
  if (Number(response.headers.get("content-length")) > maximum) { await response.body.cancel(); throw new RequestError(413, "Recording exceeds the media limit."); }
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let bytes = 0;
  try {
    while (true) {
      const item = await reader.read();
      if (item.done) break;
      bytes += item.value.length;
      if (bytes > maximum) throw new RequestError(413, "Recording exceeds the media limit.");
      chunks.push(item.value);
    }
  } finally { await reader.cancel().catch(() => {}); }
  const result = Buffer.concat(chunks);
  if (result.length < 44 || result.toString("ascii", 0, 4) !== "RIFF" || result.toString("ascii", 8, 12) !== "WAVE") throw new RequestError(400, "Original WAV is invalid.");
  return result;
}
