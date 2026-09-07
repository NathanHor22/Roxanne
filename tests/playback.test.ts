import assert from "node:assert/strict";
import test from "node:test";

import type { Meeting, TranscriptSegment } from "../lib/types";
import { sourceConversation } from "../lib/workspace/model";
import {
  activeTranscriptIndex,
  clampPlaybackTime,
  formatAudioTime,
} from "../lib/workspace/playback";

const segment = (
  startSeconds?: number,
  endSeconds?: number,
): TranscriptSegment => ({
  speaker: "Speaker 1",
  text: "A point from the conversation.",
  ...(startSeconds !== undefined ? { startSeconds } : {}),
  ...(endSeconds !== undefined ? { endSeconds } : {}),
});

test("audio timestamps support hour-long conversations without rounding into the next second", () => {
  assert.equal(formatAudioTime(0), "00:00");
  assert.equal(formatAudioTime(123.9), "02:03");
  assert.equal(formatAudioTime(3599.99), "59:59");
  assert.equal(formatAudioTime(3600), "1:00:00");
  assert.equal(formatAudioTime(3723), "1:02:03");
  assert.equal(formatAudioTime(25 * 3600), "25:00:00");
  for (const invalid of [-1, NaN, Infinity, -Infinity]) {
    assert.equal(formatAudioTime(invalid), "00:00");
  }
});

test("seeking clamps to playable bounds but does not require loaded duration metadata", () => {
  assert.equal(clampPlaybackTime(123.45, 3600), 123.45);
  assert.equal(clampPlaybackTime(4000, 3600), 3600);
  assert.equal(clampPlaybackTime(-10, 3600), 0);
  for (const duration of [undefined, 0, -1, NaN, Infinity]) {
    assert.equal(clampPlaybackTime(3723.5, duration), 3723.5);
  }
  for (const invalid of [NaN, Infinity, -Infinity]) {
    assert.equal(clampPlaybackTime(invalid, 3600), 0);
  }
});

test("known transcript ends stop highlighting during silence and at the exact end boundary", () => {
  const segments = [segment(5, 10), segment(15, 20)];
  for (const [time, expected] of [
    [0, -1],
    [5, 0],
    [9.99, 0],
    [10, -1],
    [14.99, -1],
    [15, 1],
    [20, -1],
    [3600, -1],
  ]) {
    assert.equal(activeTranscriptIndex(segments, time!), expected);
  }
});

test("overlapping segments highlight the latest start and resume an older active segment afterward", () => {
  const segments = [segment(0, 100), segment(20, 30), segment(25, 27)];
  assert.equal(activeTranscriptIndex(segments, 24), 1);
  assert.equal(activeTranscriptIndex(segments, 25), 2);
  assert.equal(activeTranscriptIndex(segments, 27), 1);
  assert.equal(activeTranscriptIndex(segments, 30), 0);
  assert.equal(activeTranscriptIndex(segments, 100), -1);
});

test("unknown ends stop at the next later timed segment even when it has already ended", () => {
  const segments = [segment(5), segment(10, 12), segment(20)];
  assert.equal(activeTranscriptIndex(segments, 9.99), 0);
  assert.equal(activeTranscriptIndex(segments, 10), 1);
  assert.equal(activeTranscriptIndex(segments, 12), -1);
  assert.equal(activeTranscriptIndex(segments, 19.99), -1);
  assert.equal(activeTranscriptIndex(segments, 20), 2);
  assert.equal(activeTranscriptIndex(segments, 7200), 2);
});

test("missing ends do not hide an older overlapping known segment after the next segment ends", () => {
  const segments = [segment(0, 100), segment(10), segment(20, 30)];
  assert.equal(activeTranscriptIndex(segments, 15), 1);
  assert.equal(activeTranscriptIndex(segments, 25), 2);
  assert.equal(activeTranscriptIndex(segments, 35), 0);
});

test("transcript highlighting keeps original indices when input is unsorted or includes untimed text", () => {
  const segments = [segment(20, 30), segment(), segment(5), segment(10, 12)];
  assert.equal(activeTranscriptIndex(segments, 6), 2);
  assert.equal(activeTranscriptIndex(segments, 11), 3);
  assert.equal(activeTranscriptIndex(segments, 15), -1);
  assert.equal(activeTranscriptIndex(segments, 25), 0);
});

test("equal start times select the later active entry consistently", () => {
  assert.equal(activeTranscriptIndex([segment(5), segment(5, 10)], 7), 1);
  assert.equal(activeTranscriptIndex([segment(5, 10), segment(5)], 7), 1);
  assert.equal(activeTranscriptIndex([segment(5, 10), segment(5, 10)], 7), 1);
  assert.equal(activeTranscriptIndex([segment(5), segment(5, 10)], 10), 0);
});

test("invalid timestamps cannot highlight a segment or truncate a valid open segment", () => {
  const segments = [
    segment(0),
    segment(-1, 5),
    segment(NaN, 5),
    segment(Infinity),
    segment(5, NaN),
    segment(5, Infinity),
    segment(5, 4),
  ];
  assert.equal(activeTranscriptIndex(segments, 10), 0);
  assert.equal(activeTranscriptIndex([], 10), -1);
  for (const time of [-1, NaN, Infinity]) {
    assert.equal(activeTranscriptIndex(segments, time), -1);
  }
});

test("an event opens the original conversation recording instead of unrelated event audio", () => {
  const conversation: Meeting = {
    id: "conversation-1",
    title: "Client conversation",
    startAt: "2026-09-06T10:00:00+08:00",
    endAt: "2026-09-06T11:32:00+08:00",
    status: "ready",
    source: "hardware",
    contacts: [],
    recordingUrl: "https://audio.example/private-original-recording",
    transcript: [segment(5, 10)],
  };
  const event: Meeting = {
    ...conversation,
    id: "calendar-event-1",
    source: "calendar",
    status: "upcoming",
    sourceConversationId: conversation.id,
    recordingUrl: "https://audio.example/unrelated-event-recording",
    transcript: [],
  };
  const original = sourceConversation([event, conversation], event);
  assert.equal(original?.recordingUrl, conversation.recordingUrl);
  assert.deepEqual(original?.transcript, conversation.transcript);
  assert.equal(sourceConversation([conversation], conversation), conversation);
  assert.equal(sourceConversation([event], event), undefined);
});
