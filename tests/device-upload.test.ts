import assert from "node:assert/strict";
import test from "node:test";
import { createHash } from "node:crypto";
import { deviceUploadRequest, directStorageEndpoint, validateTusLocation, verifyDeviceArchive, verifyStoredArchiveMetadata } from "../lib/device-upload";
import { advanceLantern, createLanternMachine } from "../lib/lantern-state";
import { isLanternDevicePath } from "../lib/auth-policy";

function wav(seconds: number) {
  const data = Buffer.alloc(44 + seconds * 32000);
  data.write("RIFF", 0); data.writeUInt32LE(data.length - 8, 4); data.write("WAVEfmt ", 8);
  data.writeUInt32LE(16, 16); data.writeUInt16LE(1, 20); data.writeUInt16LE(1, 22);
  data.writeUInt32LE(16000, 24); data.writeUInt32LE(32000, 28); data.writeUInt16LE(2, 32);
  data.writeUInt16LE(16, 34); data.write("data", 36); data.writeUInt32LE(data.length - 44, 40);
  return data;
}
test("archive verification preserves both 30-second and five-minute originals", () => {
  for (const seconds of [30, 300]) {
    const audio = wav(seconds);
    const hash = createHash("sha256").update(audio).digest("hex");
    assert.equal(verifyDeviceArchive(audio, audio.length, hash).durationSeconds, seconds);
    assert.throws(() => verifyDeviceArchive(audio.subarray(0, audio.length - 2), audio.length, hash), /complete recording/);
    audio[audio.length - 1] ^= 1;
    assert.throws(() => verifyDeviceArchive(audio, audio.length, hash), /integrity/);
  }
});
test("TUS archive acceptance checks server-side size without redownloading the file", () => {
  assert.equal(verifyStoredArchiveMetadata({ size: 9_600_044, contentType: "audio/wav" }, 9_600_044), true);
  assert.throws(() => verifyStoredArchiveMetadata({ size: 9_000_000, contentType: "audio/wav" }, 9_600_044), /complete recording/u);
  assert.throws(() => verifyStoredArchiveMetadata({ size: 9_600_044, contentType: "text/plain" }, 9_600_044), /media type/u);
});
test("signed storage URLs cannot escape the Supabase upload origin", () => {
  const base = directStorageEndpoint("https://project.supabase.co");
  assert.equal(base, "https://project.storage.supabase.co/storage/v1/upload/resumable/sign");
  assert.equal(validateTusLocation(`${base}/upload-id`, base), `${base}/upload-id`);
  for (const value of ["https://evil.test/upload", `${base}/../../object/private`, `${base}/id#fragment`, "https://user:secret@project.storage.supabase.co/storage/v1/upload/resumable/sign/id", "https://project.storage.supabase.co/storage/v1/upload/resumable/unsigned-id"]) {
    assert.throws(() => validateTusLocation(value, base));
  }
  assert.throws(() => deviceUploadRequest.parse({ action: "prepare", eventId: "bad", bytes: 99999999, sha256: "bad" }));
  assert.equal(isLanternDevicePath("/api/device/v1/sessions/12345678-1234-1234-1234-123456789012/upload"), true);
});
test("accepted processing frees the physical device for a new consent flow", () => {
  const machine = { ...createLanternMachine("ready"), state: "finalising" as const, sessionId: "old-session", version: 7 };
  const ready = advanceLantern(machine, { type: "PROCESSING_QUEUED", at: "2026-09-21T10:00:00Z" });
  assert.equal(ready.state, "ready"); assert.equal(ready.sessionId, null); assert.equal(ready.version, 8);
  const next = advanceLantern(ready, { type: "BEGIN_QUICK", at: "2026-09-21T10:00:01Z", sessionId: "new-session", promptId: "new-consent", promptExpiresAt: "2026-09-21T10:00:31Z" });
  assert.equal(next.state, "awaiting_recording_consent");
  assert.equal(next.sessionId, "new-session");
  assert.throws(() => advanceLantern(next, { type: "PROCESSING_QUEUED", at: "2026-09-21T10:00:02Z" }));
});
