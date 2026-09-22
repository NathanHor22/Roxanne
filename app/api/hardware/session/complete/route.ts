import { randomUUID } from "node:crypto";

import { NextResponse } from "next/server";
import { z } from "zod";

import { stopHardwareVoiceAgent } from "@/lib/agora-conversation";
import { requireAuthenticatedSession, requireProductionPersistence } from "@/lib/api-security";
import { normalizeAgoraTranscript } from "@/lib/hardware-transcript";
import { parseLocale } from "@/lib/i18n";
import { transcriptionResultSchema } from "@/lib/meeting-schema";
import { persistProcessedMeeting } from "@/lib/persistence";
import { extractConversationInsights } from "@/lib/providers/meeting-extraction";
import { getRedis, rememberPerson, rememberSession, setProcessingState } from "@/lib/redis";
import { getServerSupabase, resolveWorkspaceUserId } from "@/lib/supabase/server";
import type { Contact, FollowUp, Meeting } from "@/lib/types";

export const runtime = "nodejs";
export const maxDuration = 300;

const headerSchema = z.object({
  deviceId: z.string().uuid(),
  sessionId: z.string().uuid(),
  agentId: z.string().trim().min(1).max(160).optional(),
  locale: z.string().trim().max(20).optional(),
}).strict();

interface SessionMetadata {
  deviceId: string;
  agentId: string;
  startedAt: string;
  language?: string;
}

export async function POST(request: Request) {
  const authError = await requireAuthenticatedSession();
  if (authError) return authError;
  const client = getServerSupabase();
  const readinessError = requireProductionPersistence(Boolean(client), "Supabase is required for hardware processing.");
  if (readinessError) return readinessError;

  let sessionId = "";
  try {
    const input = headerSchema.parse({
      deviceId:
        request.headers.get("x-lantern-device-id") ||
        request.headers.get("x-roxanne-device-id"),
      sessionId:
        request.headers.get("x-lantern-session-id") ||
        request.headers.get("x-roxanne-session-id"),
      agentId:
        request.headers.get("x-lantern-agent-id") ||
        request.headers.get("x-roxanne-agent-id") ||
        undefined,
      locale:
        request.headers.get("x-lantern-locale") ||
        request.headers.get("x-roxanne-locale") ||
        undefined,
    });
    sessionId = input.sessionId;
    const raw = await request.text();
    if (raw.length > 250_000) return NextResponse.json({ error: "Hardware transcript is too large." }, { status: 413 });
    if (!client) throw new Error("Supabase is unavailable.");
    const userId = await resolveWorkspaceUserId(client);
    if (!userId) throw new Error("The Quipus workspace is unavailable.");
    const { data: device } = await client.from("devices").select("id,name").eq("id", input.deviceId).eq("user_id", userId).maybeSingle();
    if (!device) return NextResponse.json({ error: "Unknown hardware device." }, { status: 404 });

    const redis = getRedis();
    const metadata = redis
      ? await redis.get<SessionMetadata>(`hardware-session:${sessionId}`)
      : null;
    const agentId = input.agentId || metadata?.agentId;
    if (agentId) await stopHardwareVoiceAgent(agentId);
    if (!raw.trim()) {
      if (redis) await redis.del(`hardware-session:${sessionId}`);
      return NextResponse.json({ stopped: true, persisted: false, transcriptSegments: 0 });
    }

    const segments = normalizeAgoraTranscript(raw);
    if (!segments.length) return NextResponse.json({ error: "Agora did not produce a usable transcript." }, { status: 422 });
    const locale = parseLocale(input.locale);
    const startedAt = metadata?.startedAt && Number.isFinite(Date.parse(metadata.startedAt))
      ? metadata.startedAt
      : new Date(Date.now() - 5 * 60_000).toISOString();
    const endAt = new Date().toISOString();
    const clientReference = `hardware-${sessionId}`;
    await setProcessingState(clientReference, { status: "processing", stage: "extracting" });
    const transcription = transcriptionResultSchema.parse({
      text: segments.map((item) => `${item.speaker}: ${item.text}`).join("\n"),
      segments,
      language: metadata?.language || input.locale || "multilingual",
      provider: "agora",
    });
    const extraction = await extractConversationInsights(segments, {
      title: `${device.name} conversation`,
      outputLanguage: locale,
      referenceDate: startedAt,
      timezone: "Asia/Kuala_Lumpur",
    });
    const contacts: Contact[] = extraction.participants.map((item) => ({ id: randomUUID(), ...item }));
    const followUps: FollowUp[] = extraction.followUps.map((item) => ({
      id: randomUUID(), meetingId: clientReference, contactId: contacts[0]?.id || null,
      ...item, status: "pending",
    }));
    const meeting: Meeting = {
      id: clientReference,
      title: contacts[0] ? `${contacts[0].name}${contacts[0].company ? ` Â· ${contacts[0].company}` : ""}` : `${device.name} conversation`,
      startAt: startedAt,
      endAt,
      status: "ready",
      source: "hardware",
      contacts,
      transcript: segments,
      insight: extraction.insight,
      followUps,
    };
    const persistence = await persistProcessedMeeting({
      clientReference,
      meeting,
      transcription,
      extraction,
    });
    meeting.recordingId = persistence.recordingId;
    await rememberSession(clientReference, { title: meeting.title, intent: extraction.insight.intent, followUps: extraction.followUps });
    if (contacts[0]) await rememberPerson(contacts[0].id, { name: contacts[0].name, company: contacts[0].company, lastMeeting: startedAt });
    await setProcessingState(clientReference, { status: "ready", meetingId: clientReference, persisted: persistence.persisted });
    if (redis) await redis.del(`hardware-session:${sessionId}`);

    return NextResponse.json({ meeting, persisted: persistence.persisted, transcriptSegments: segments.length });
  } catch (error) {
    if (sessionId) await setProcessingState(`hardware-${sessionId}`, { status: "failed", error: error instanceof Error ? error.message : "Hardware processing failed." });
    console.error("[hardware-session-complete]", error);
    return NextResponse.json(
      { error: error instanceof z.ZodError ? "Hardware completion data is invalid." : error instanceof Error ? error.message : "Hardware processing failed." },
      { status: error instanceof z.ZodError ? 400 : 500 },
    );
  }
}
