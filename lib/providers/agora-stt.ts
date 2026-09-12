import { RtcRole, RtcTokenBuilder } from "agora-token";
import { z } from "zod";

import { env, type ServerEnv } from "../env";

const AGORA_STT_BASE = "https://api.agora.io/api/speech-to-text/v1/projects";
const TOKEN_LIFETIME_SECONDS = 4 * 60 * 60;

const startResponseSchema = z
  .object({
    agent_id: z.string().min(1),
    status: z.string().min(1),
  })
  .passthrough();

export interface AgoraLanternTransport {
  provider: "agora";
  appId: string;
  channel: string;
  publisherUid: number;
  sttBotUid: number;
  token: string;
  expiresAt: string;
  codec: "opus";
  sampleRate: 16000;
  channels: 1;
  frameDurationMs: 20;
}

interface AgoraCredentials {
  appId: string;
  certificate: string;
  authorization: string;
}

function configuredCredentials(runtime: ServerEnv = env()): AgoraCredentials {
  const appId = runtime.NEXT_PUBLIC_AGORA_APP_ID?.trim();
  const certificate = runtime.AGORA_APP_CERTIFICATE?.trim();
  const customerId = runtime.AGORA_CUSTOMER_ID?.trim();
  const customerSecret = runtime.AGORA_CUSTOMER_SECRET?.trim();
  if (!appId || !certificate || !customerId || !customerSecret) {
    throw new Error(
      "Agora recording is not configured. Add the App ID, certificate, customer ID, and customer secret.",
    );
  }
  if (!/^[0-9a-f]{32}$/iu.test(appId) || !/^[0-9a-f]{32}$/iu.test(certificate)) {
    throw new Error("Agora App ID or certificate is invalid.");
  }
  return {
    appId,
    certificate,
    authorization: `Basic ${Buffer.from(`${customerId}:${customerSecret}`).toString("base64")}`,
  };
}

function numericUid(seed: string, floor: number) {
  let hash = 2166136261;
  for (const character of seed) {
    hash ^= character.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return (Math.abs(hash >>> 0) % 900_000_000) + floor;
}

export function agoraLanguages(runtime: ServerEnv = env()) {
  const languages = runtime.AGORA_STT_LANGUAGES.split(",")
    .map((item) => item.trim())
    .filter(Boolean);
  const selected = [...new Set(languages)].slice(0, 4);
  return selected.length ? selected : ["ms-MY", "en-SG"];
}

export function buildAgoraLanternTransport(
  sessionId: string,
  deviceId: string,
  options: { runtime?: ServerEnv; now?: Date } = {},
): AgoraLanternTransport {
  const runtime = options.runtime || env();
  const credentials = configuredCredentials(runtime);
  const now = options.now || new Date();
  const compactSession = sessionId.replaceAll("-", "");
  const compactDevice = deviceId.replaceAll("-", "");
  const channel = `lantern-${compactDevice.slice(0, 10)}-${compactSession.slice(0, 16)}`;
  const publisherUid = numericUid(`${deviceId}:publisher`, 10_000);
  let sttBotUid = numericUid(`${sessionId}:stt`, 1_000_000_000);
  if (sttBotUid === publisherUid) sttBotUid += 1;
  const expiresAt = new Date(now.getTime() + TOKEN_LIFETIME_SECONDS * 1000);
  return {
    provider: "agora",
    appId: credentials.appId,
    channel,
    publisherUid,
    sttBotUid,
    token: RtcTokenBuilder.buildTokenWithUid(
      credentials.appId,
      credentials.certificate,
      channel,
      publisherUid,
      RtcRole.PUBLISHER,
      TOKEN_LIFETIME_SECONDS,
      TOKEN_LIFETIME_SECONDS,
    ),
    expiresAt: expiresAt.toISOString(),
    codec: "opus",
    sampleRate: 16_000,
    channels: 1,
    frameDurationMs: 20,
  };
}

export async function startAgoraLanternTranscription(
  sessionId: string,
  transport: AgoraLanternTransport,
  options: { runtime?: ServerEnv; fetchImpl?: typeof fetch } = {},
) {
  const runtime = options.runtime || env();
  const credentials = configuredCredentials(runtime);
  const botToken = RtcTokenBuilder.buildTokenWithUid(
    credentials.appId,
    credentials.certificate,
    transport.channel,
    transport.sttBotUid,
    RtcRole.PUBLISHER,
    TOKEN_LIFETIME_SECONDS,
    TOKEN_LIFETIME_SECONDS,
  );
  const keywords = runtime.AGORA_STT_KEYWORDS.split(",")
    .map((item) => item.trim())
    .filter(Boolean)
    .slice(0, 500);
  const body = {
    name: `lantern-${sessionId.replaceAll("-", "")}`.slice(0, 64),
    languages: agoraLanguages(runtime),
    ...(keywords.length ? { keywords } : {}),
    maxIdleTime: 300,
    rtcConfig: {
      channelName: transport.channel,
      pubBotUid: String(transport.sttBotUid),
      pubBotToken: botToken,
      subscribeAudioUids: [String(transport.publisherUid)],
      // Protobuf is substantially smaller on the wearable and can be staged
      // byte-for-byte for server-side decoding.
      enableJsonProtocol: false,
    },
  };
  const response = await (options.fetchImpl || fetch)(
    `${AGORA_STT_BASE}/${credentials.appId}/join`,
    {
      method: "POST",
      headers: {
        authorization: credentials.authorization,
        "content-type": "application/json",
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(20_000),
    },
  );
  const responseText = await response.text();
  if (!response.ok) {
    throw new Error(
      `Agora Speech-to-Text could not start (HTTP ${response.status}): ${responseText.slice(0, 300)}`,
    );
  }
  const result = startResponseSchema.parse(JSON.parse(responseText));
  return { agentId: result.agent_id, status: result.status, request: body };
}

export async function stopAgoraLanternTranscription(
  agentId: string,
  options: { runtime?: ServerEnv; fetchImpl?: typeof fetch } = {},
) {
  const credentials = configuredCredentials(options.runtime || env());
  const response = await (options.fetchImpl || fetch)(
    `${AGORA_STT_BASE}/${credentials.appId}/agents/${encodeURIComponent(agentId)}/leave`,
    {
      method: "POST",
      headers: { authorization: credentials.authorization },
      signal: AbortSignal.timeout(20_000),
    },
  );
  if (!response.ok && response.status !== 404) {
    throw new Error(`Agora Speech-to-Text could not stop (HTTP ${response.status}).`);
  }
}
