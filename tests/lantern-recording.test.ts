import assert from "node:assert/strict";
import test from "node:test";

import { parseAgoraCaptionBatch } from "../lib/agora-caption";
import { conversationClock } from "../lib/conversation-clock";
import { env } from "../lib/env";
import {
  DEVICE_AUDIO_CHUNK_BYTES,
  deviceAudioPartName,
  parseDeviceContentRange,
} from "../lib/device-audio-chunks";
import {
  buildAgoraLanternTransport,
  startAgoraLanternTranscription,
} from "../lib/providers/agora-stt";
import { parseLanternWav } from "../lib/wav";

function concat(...parts: Uint8Array[]) {
  const result = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0));
  let offset = 0;
  for (const part of parts) {
    result.set(part, offset);
    offset += part.length;
  }
  return result;
}

function varint(value: number) {
  const bytes: number[] = [];
  let remaining = BigInt(value);
  while (remaining > 0x7fn) {
    bytes.push(Number(remaining & 0x7fn) | 0x80);
    remaining >>= 7n;
  }
  bytes.push(Number(remaining));
  return Uint8Array.from(bytes);
}

function integerField(field: number, value: number) {
  return concat(varint(field << 3), varint(value));
}

function bytesField(field: number, value: Uint8Array | string) {
  const bytes = typeof value === "string" ? new TextEncoder().encode(value) : value;
  return concat(varint((field << 3) | 2), varint(bytes.length), bytes);
}

function word(text: string, isFinal: boolean) {
  return concat(bytesField(1, text), integerField(4, isFinal ? 1 : 0));
}

function caption(input: {
  text: string;
  final?: boolean;
  time: number;
  duration: number;
  sentenceId: number;
  culture?: string;
}) {
  return concat(
    integerField(4, 42001),
    integerField(6, input.time),
    bytesField(10, word(input.text, input.final ?? true)),
    integerField(12, input.duration),
    bytesField(13, "transcribe"),
    bytesField(15, input.culture || "ms-MY"),
    integerField(19, input.sentenceId),
  );
}

function batch(...packets: Uint8Array[]) {
  return concat(
    ...packets.map((packet) => {
      const length = new Uint8Array(4);
      new DataView(length.buffer).setUint32(0, packet.length, true);
      return concat(length, packet);
    }),
  );
}

test("server conversation clock pins the Malaysian date and time", () => {
  const clock = conversationClock("2026-09-11T17:42:10.000Z", "Asia/Kuala_Lumpur");
  assert.equal(clock.startedAt, "2026-09-11T17:42:10.000Z");
  assert.equal(clock.localDate, "2026-09-12");
  assert.equal(clock.localTime, "01:42:10");
  assert.match(clock.localDateTime, /12 September 2026/u);
  assert.match(clock.localDateTime, /1:42:10/u);
});

test("Agora protobuf batches retain only final, de-duplicated timed speech", () => {
  const startedAt = "2026-09-12T07:42:10.000Z";
  const started = Date.parse(startedAt);
  const result = parseAgoraCaptionBatch(
    batch(
      caption({ text: "Jumpa", time: started + 1_000, duration: 400, sentenceId: 71 }),
      caption({ text: "Jumpa esok pukul satu", time: started + 1_000, duration: 1_800, sentenceId: 71 }),
      caption({ text: "partial only", final: false, time: started + 3_000, duration: 500, sentenceId: 72 }),
      caption({ text: "Boleh, confirm", time: started + 4_000, duration: 900, sentenceId: 73, culture: "en-SG" }),
    ),
    startedAt,
  );
  assert.equal(result.provider, "agora");
  assert.equal(result.language, "ms-MY,en-SG");
  assert.deepEqual(result.segments, [
    {
      id: "71",
      speaker: "Conversation",
      text: "Jumpa esok pukul satu",
      startSeconds: 1,
      endSeconds: 2.8,
    },
    {
      id: "73",
      speaker: "Conversation",
      text: "Boleh, confirm",
      startSeconds: 4,
      endSeconds: 4.9,
    },
  ]);
});

test("Agora STT subscribes only to the wearable with Malaysian languages", async () => {
  const runtime = {
    ...env(),
    NEXT_PUBLIC_AGORA_APP_ID: "a".repeat(32),
    AGORA_APP_CERTIFICATE: "b".repeat(32),
    AGORA_CUSTOMER_ID: "customer",
    AGORA_CUSTOMER_SECRET: "secret",
    AGORA_STT_LANGUAGES: "ms-MY,en-SG,ms-MY",
    AGORA_STT_KEYWORDS: "Lantern,ringgit",
  };
  const transport = buildAgoraLanternTransport(
    "3c3376de-fc6e-47cd-b2b6-658fcb61db23",
    "c3ce83a4-e30e-4e30-a8a8-8991b64ed21f",
    { runtime, now: new Date("2026-09-12T07:42:10.000Z") },
  );
  assert.equal(transport.sampleRate, 16_000);
  assert.equal(transport.codec, "opus");
  assert.notEqual(transport.publisherUid, transport.sttBotUid);

  let requestBody: Record<string, unknown> | undefined;
  const fetchImpl: typeof fetch = async (input, init) => {
    assert.equal(String(input), `https://api.agora.io/api/speech-to-text/v1/projects/${"a".repeat(32)}/join`);
    assert.match(String((init?.headers as Record<string, string>).authorization), /^Basic /u);
    requestBody = JSON.parse(String(init?.body));
    return new Response(JSON.stringify({ agent_id: "agent-123", status: "RUNNING" }), { status: 200 });
  };
  const started = await startAgoraLanternTranscription("3c3376de-fc6e-47cd-b2b6-658fcb61db23", transport, {
    runtime,
    fetchImpl,
  });
  assert.equal(started.agentId, "agent-123");
  assert.deepEqual(requestBody?.languages, ["ms-MY", "en-SG"]);
  assert.deepEqual((requestBody?.rtcConfig as Record<string, unknown>).subscribeAudioUids, [
    String(transport.publisherUid),
  ]);
  assert.equal((requestBody?.rtcConfig as Record<string, unknown>).enableJsonProtocol, false);
});

test("Lantern WAV validator accepts the device's canonical recording", () => {
  const samples = 16_000;
  const bytes = new Uint8Array(44 + samples * 2);
  const view = new DataView(bytes.buffer);
  bytes.set(new TextEncoder().encode("RIFF"), 0);
  view.setUint32(4, bytes.length - 8, true);
  bytes.set(new TextEncoder().encode("WAVEfmt "), 8);
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, 16_000, true);
  view.setUint32(28, 32_000, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  bytes.set(new TextEncoder().encode("data"), 36);
  view.setUint32(40, samples * 2, true);
  assert.deepEqual(parseLanternWav(bytes), {
    sampleRate: 16_000,
    channels: 1,
    bitsPerSample: 16,
    dataBytes: 32_000,
    durationSeconds: 1,
  });
});

test("Lantern WAV validation preserves a complete five-minute archive", () => {
  const samples = 16_000 * 60 * 5;
  const bytes = new Uint8Array(44 + samples * 2);
  const view = new DataView(bytes.buffer);
  bytes.set(new TextEncoder().encode("RIFF"), 0);
  view.setUint32(4, bytes.length - 8, true);
  bytes.set(new TextEncoder().encode("WAVEfmt "), 8);
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, 16_000, true);
  view.setUint32(28, 32_000, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  bytes.set(new TextEncoder().encode("data"), 36);
  view.setUint32(40, samples * 2, true);

  assert.equal(bytes.length, 9_600_044);
  assert.equal(parseLanternWav(bytes).durationSeconds, 300);
});

test("Lantern SD upload ranges are strict and deterministically named", () => {
  assert.deepEqual(parseDeviceContentRange(`bytes 0-${DEVICE_AUDIO_CHUNK_BYTES - 1}/9600044`), {
    start: 0,
    end: DEVICE_AUDIO_CHUNK_BYTES - 1,
    total: 9_600_044,
    length: DEVICE_AUDIO_CHUNK_BYTES,
  });
  assert.equal(deviceAudioPartName(524_288), "0000524288.part");
  assert.throws(
    () => parseDeviceContentRange("bytes 100-99/1000"),
    /Content-Range is invalid/u,
  );
});
