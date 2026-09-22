import "server-only";

import { RtcRole, RtcTokenBuilder } from "agora-token";
import { z } from "zod";

import { env } from "@/lib/env";

const AGORA_AGENT_BASE =
  "https://api.agora.io/api/conversational-ai-agent/v2/projects";
export const HARDWARE_AGENT_UID = 1000;

const agentResponseSchema = z
  .object({
    agent_id: z.string().min(1).optional(),
    agentId: z.string().min(1).optional(),
    status: z.string().optional(),
  })
  .passthrough();

const SYSTEM_PROMPT = `You are Quipus, a concise voice assistant and business-development memory partner.
Speak naturally and briefly in the same language as the user, including Malaysian English, Bahasa Malaysia, Mandarin, Cantonese, or Tamil.
Answer questions directly. During business conversations, help clarify names, companies, needs, concerns, commitments, and next actions without sounding like a form.
Never claim an external action was sent or scheduled unless Quipus confirms it. Keep spoken replies to one or two sentences unless the user asks for detail.`;

const GREETING =
  "Hi, I'm Quipus. I'm listening—what would you like to discuss or remember?";

function credentials() {
  const runtime = env();
  const appId = runtime.NEXT_PUBLIC_AGORA_APP_ID?.trim();
  const certificate = runtime.AGORA_APP_CERTIFICATE?.trim();
  const customerId = runtime.AGORA_CUSTOMER_ID?.trim();
  const customerSecret = runtime.AGORA_CUSTOMER_SECRET?.trim();
  const groqKey = runtime.GROQ_API_KEY?.trim();
  if (!appId || !certificate || !customerId || !customerSecret || !groqKey) {
    throw new Error("Agora Conversational AI credentials are incomplete.");
  }
  if (!/^[0-9a-f]{32}$/iu.test(appId) || !/^[0-9a-f]{32}$/iu.test(certificate)) {
    throw new Error("Agora App ID or certificate is invalid.");
  }
  let tts: unknown;
  try {
    tts = runtime.AGORA_CONVOAI_TTS
      ? JSON.parse(runtime.AGORA_CONVOAI_TTS)
      : undefined;
  } catch {
    throw new Error("AGORA_CONVOAI_TTS is not valid JSON.");
  }
  if (!tts) throw new Error("Agora text-to-speech is not configured.");
  return {
    runtime,
    appId,
    certificate,
    groqKey,
    tts,
    authorization: `Basic ${Buffer.from(`${customerId}:${customerSecret}`).toString("base64")}`,
  };
}

export function buildHardwareRtcCredentials(channel: string, uid: number) {
  const { appId, certificate } = credentials();
  const ttlSeconds = 60 * 60;
  return {
    appId,
    channel,
    uid,
    token: RtcTokenBuilder.buildTokenWithUid(
      appId,
      certificate,
      channel,
      uid,
      RtcRole.PUBLISHER,
      ttlSeconds,
      ttlSeconds,
    ),
    expiresAt: new Date(Date.now() + ttlSeconds * 1000).toISOString(),
  };
}

export async function startHardwareVoiceAgent(
  channel: string,
  remoteUid: number,
  language?: string,
  fetchImpl: typeof fetch = fetch,
) {
  const { runtime, appId, certificate, groqKey, tts, authorization } = credentials();
  const agentToken = RtcTokenBuilder.buildTokenWithUid(
    appId,
    certificate,
    channel,
    HARDWARE_AGENT_UID,
    RtcRole.PUBLISHER,
    60 * 60,
    60 * 60,
  );
  const payload = {
    name: `lantern-hardware-${Date.now()}`,
    properties: {
      channel,
      token: agentToken,
      agent_rtc_uid: String(HARDWARE_AGENT_UID),
      remote_rtc_uids: [String(remoteUid)],
      enable_string_uid: false,
      idle_timeout: 120,
      advanced_features: { enable_aivad: true, enable_rtm: true },
      parameters: {
        output_audio_codec: "PCMU",
        data_channel: "rtm",
        enable_error_message: true,
      },
      asr: {
        language: language || runtime.AGORA_CONVOAI_ASR_LANGUAGE || "en-US",
      },
      llm: {
        url: "https://api.groq.com/openai/v1/chat/completions",
        api_key: groqKey,
        system_messages: [{ role: "system", content: SYSTEM_PROMPT }],
        greeting_message: GREETING,
        failure_message: "Give me a moment, then please try that again.",
        max_history: 24,
        params: { model: runtime.QWEN_MODEL || "qwen/qwen3.6-27b" },
      },
      tts,
    },
  };
  const response = await fetchImpl(`${AGORA_AGENT_BASE}/${appId}/join`, {
    method: "POST",
    headers: {
      Authorization: authorization,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });
  const text = await response.text();
  if (!response.ok) {
    throw new Error(`Agora voice agent failed to start (HTTP ${response.status}): ${text.slice(0, 400)}`);
  }
  const parsed = agentResponseSchema.parse(JSON.parse(text));
  const agentId = parsed.agent_id || parsed.agentId;
  if (!agentId) throw new Error("Agora did not return an agent ID.");
  return { agentId, status: parsed.status || "RUNNING" };
}

export async function stopHardwareVoiceAgent(
  agentId: string,
  fetchImpl: typeof fetch = fetch,
) {
  const { appId, authorization } = credentials();
  const response = await fetchImpl(
    `${AGORA_AGENT_BASE}/${appId}/agents/${encodeURIComponent(agentId)}/leave`,
    { method: "POST", headers: { Authorization: authorization } },
  );
  if (!response.ok && response.status !== 404) {
    throw new Error(`Agora voice agent failed to stop (HTTP ${response.status}).`);
  }
}
