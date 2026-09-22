import assert from "node:assert/strict";
import test from "node:test";
import { parseDocument, readDocument, reportRecipient } from "../src/media.js";

const origin = "https://project.supabase.co";
const audio = { fileName: "Original recording.wav", mimeType: "audio/wav", url: `${origin}/storage/v1/object/sign/recordings/user/file.wav?token=test` };
test("report media accepts only private signed recordings from configured storage", () => {
  assert.equal(parseDocument(audio, origin).url, audio.url);
  for (const url of ["http://127.0.0.1/admin", "https://evil.test/file.wav", `${origin}/storage/v1/object/public/recordings/file.wav`, `https://secret@project.supabase.co/storage/v1/object/sign/recordings/file.wav`]) {
    assert.throws(() => parseDocument({ ...audio, url }, origin));
  }
  assert.throws(() => parseDocument({ ...audio, mimeType: "application/javascript" }, origin));
  assert.throws(() => parseDocument({ ...audio, fileName: "../../escape" }, origin));
});
test("transcripts retain all text and WAV documents retain every byte", async () => {
  const text = "Speaker 1: Hello.\nSpeaker 2: Boleh, next week.\n".repeat(5000);
  const document = parseDocument({ fileName: "Full transcript.txt", mimeType: "text/plain", base64: Buffer.from(text).toString("base64") });
  assert.equal((await readDocument(document)).toString(), text);
  const wav = Buffer.alloc(9600044); wav.write("RIFF"); wav.write("WAVE", 8); wav[wav.length - 1] = 123;
  const result = await readDocument(parseDocument(audio, origin), async (_url, options) => {
    assert.equal(options?.redirect, "error");
    return new Response(wav);
  });
  assert.deepEqual(result, wav);
  await assert.rejects(readDocument(parseDocument(audio, origin), async () => new Response("too large", { headers: { "content-length": String(26 * 1024 * 1024) } })), /limit/);
  await assert.rejects(readDocument(parseDocument(audio, origin), async () => new Response("not a wav")), /invalid/);
});
test("approved report recipients need a real country-code number", () => {
  assert.equal(reportRecipient("+60 12-345 6789"), "60123456789");
  assert.throws(() => reportRecipient("abc"));
  assert.throws(() => reportRecipient("123"));
});
