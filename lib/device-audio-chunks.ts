export const DEVICE_AUDIO_CHUNK_BYTES = 512 * 1024;

export interface DeviceContentRange {
  start: number;
  end: number;
  total: number;
  length: number;
}

/** Parses the byte range used by Quipus's idempotent SD-card uploads. */
export function parseDeviceContentRange(value: string | null): DeviceContentRange | null {
  if (!value) return null;
  const match = /^bytes (0|[1-9]\d*)-(0|[1-9]\d*)\/(0|[1-9]\d*)$/u.exec(value.trim());
  if (!match) throw new Error("Quipus audio Content-Range is invalid.");
  const start = Number(match[1]);
  const end = Number(match[2]);
  const total = Number(match[3]);
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) ||
      !Number.isSafeInteger(total) || start > end || end >= total) {
    throw new Error("Quipus audio Content-Range is invalid.");
  }
  return { start, end, total, length: end - start + 1 };
}

export function deviceAudioPartName(offset: number) {
  if (!Number.isSafeInteger(offset) || offset < 0) {
    throw new Error("Quipus audio chunk offset is invalid.");
  }
  return `${String(offset).padStart(10, "0")}.part`;
}
