import assert from "node:assert/strict";
import test from "node:test";

import {
  MAX_AUDIO_BYTES,
  normalizeAudioContentType,
  safeAudioExtension,
} from "../lib/audio-upload";

test("normalizes browser audio MIME aliases to storage-safe values", () => {
  assert.equal(normalizeAudioContentType("call.mp3", "audio/mp3"), "audio/mpeg");
  assert.equal(normalizeAudioContentType("call.wav", "audio/x-wav"), "audio/wav");
  assert.equal(normalizeAudioContentType("call.webm", "audio/webm;codecs=opus"), "audio/webm");
});

test("infers only explicitly supported audio extensions", () => {
  assert.equal(normalizeAudioContentType("call.m4a", ""), "audio/mp4");
  assert.equal(normalizeAudioContentType("call.exe", "application/octet-stream"), null);
  assert.equal(normalizeAudioContentType("call.txt", "text/plain"), null);
});

test("uses a safe storage extension and keeps the long-recording archive contract", () => {
  assert.equal(safeAudioExtension("client call", "audio/mpeg"), "mp3");
  assert.equal(safeAudioExtension("client.call.ogg", "audio/ogg"), "ogg");
  assert.equal(MAX_AUDIO_BYTES, 268_435_456);
});
