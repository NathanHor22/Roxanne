import assert from "node:assert/strict";
import test from "node:test";

import { prepareWavForRecognition } from "../lib/audio-processing";
import type { TranscriptionResult } from "../lib/meeting-schema";
import { combineChunkedTranscriptions } from "../lib/providers/openai-transcription";
import {
  CANONICAL_WAV_BYTES_PER_SECOND,
  createCanonicalWav,
  parseLanternWav,
  splitCanonicalWav,
  type WavChunk,
} from "../lib/wav";

function tone(seconds: number, amplitude: number) {
  const samples = 16_000 * seconds;
  const pcm = new Uint8Array(samples * 2);
  const view = new DataView(pcm.buffer);
  for (let index = 0; index < samples; index += 1) {
    const sample = Math.round(Math.sin((2 * Math.PI * 220 * index) / 16_000) * amplitude);
    view.setInt16(index * 2, sample, true);
  }
  return createCanonicalWav(pcm);
}

test("long canonical WAVs become complete overlapping files with absolute offsets", () => {
  const original = tone(7, 2_000);
  const chunks = splitCanonicalWav(original, {
    maxBytes: CANONICAL_WAV_BYTES_PER_SECOND * 3 + 44,
    overlapSeconds: 0.5,
  });
  assert.ok(chunks.length >= 3);
  assert.equal(chunks[0]?.offsetSeconds, 0);
  for (const chunk of chunks) {
    const metadata = parseLanternWav(chunk.bytes);
    assert.equal(metadata.durationSeconds, chunk.durationSeconds);
    assert.ok(chunk.bytes.byteLength <= CANONICAL_WAV_BYTES_PER_SECOND * 3 + 44);
  }
  assert.ok(chunks[1]!.offsetSeconds < chunks[0]!.durationSeconds);
  const last = chunks.at(-1)!;
  assert.equal(last.offsetSeconds + last.durationSeconds, 7);
});

test("quiet recordings are measured and amplified only in the recognition copy", () => {
  const original = tone(2, 250);
  const before = Uint8Array.from(original);
  const prepared = prepareWavForRecognition(original);
  assert.deepEqual(original, before);
  assert.equal(prepared.quality.normalizedForRecognition, true);
  assert.ok(prepared.quality.appliedGainDb > 0);
  assert.ok(prepared.quality.rmsDbfs < -35);
  assert.equal(parseLanternWav(prepared.audio).durationSeconds, 2);
  assert.notDeepEqual(prepared.audio, original);
});

test("overlap maps local diarization labels to stable global speakers", () => {
  const chunks: WavChunk[] = [
    { bytes: tone(10, 1_000), offsetSeconds: 0, durationSeconds: 10 },
    { bytes: tone(10, 1_000), offsetSeconds: 8, durationSeconds: 10 },
  ];
  const result = (segments: TranscriptionResult["segments"]): TranscriptionResult => ({
    text: segments.map((segment) => segment.text).join(" "),
    segments,
    language: "multilingual",
    provider: "openai",
  });
  const combined = combineChunkedTranscriptions(chunks, [
    result([
      { speaker: "Speaker 1", text: "We can begin.", startSeconds: 0, endSeconds: 2 },
      { speaker: "Speaker 2", text: "Yes, next week.", startSeconds: 8, endSeconds: 10 },
    ]),
    result([
      { speaker: "Speaker 1", text: "Yes next week.", startSeconds: 0, endSeconds: 2 },
      { speaker: "Speaker 2", text: "I will send it.", startSeconds: 2.2, endSeconds: 5 },
    ]),
  ]);
  assert.deepEqual(combined.segments.map((segment) => segment.speaker), [
    "Speaker 1",
    "Speaker 2",
    "Speaker 3",
  ]);
  assert.equal(combined.segments[2]?.startSeconds, 10.2);
  assert.match(combined.warning || "", /2 overlapping audio sections/u);
});
