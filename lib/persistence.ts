import "server-only";

import { randomUUID } from "node:crypto";
import type { Meeting } from "@/lib/types";
import type { MeetingExtractionResult, TranscriptionResult } from "@/lib/meeting-schema";
import { getServerSupabase, resolveWorkspaceUserId } from "@/lib/supabase/server";

export interface PersistMeetingInput {
  clientReference: string;
  meeting: Meeting;
  /** Device-authenticated ingestion pins data to the paired device owner. */
  ownerUserId?: string;
  /** Omitted for live Agora hardware sessions where no source file exists. */
  audio?: Blob;
  fileName?: string;
  transcription: TranscriptionResult;
  extraction: MeetingExtractionResult;
  /** Private object and metadata row created by /api/recordings/upload-url. */
  preUploadedRecording?: {
    recordingId: string;
    storagePath: string;
  };
}

export interface PersistMeetingResult {
  persisted: boolean;
  meetingId?: string;
  recordingId?: string;
  contactIds?: string[];
  followUpIds?: string[];
  signedRecordingUrl?: string;
  warning?: string;
}

export interface PersistMeetingOptions {
  /** Test hook for exercising production fail-closed behavior without mutating process.env. */
  runtimeEnvironment?: string;
}

export class PersistenceConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PersistenceConfigurationError";
  }
}

function extensionOf(name: string, type: string): string {
  const ext = /\.([a-z0-9]{2,5})$/iu.exec(name)?.[1]?.toLowerCase();
  if (ext) return ext;
  if (type.includes("wav")) return "wav";
  if (type.includes("mpeg")) return "mp3";
  if (type.includes("ogg")) return "ogg";
  if (type.includes("webm")) return "webm";
  return "m4a";
}

function dueTimestamp(value: string | null): string | null {
  if (!value) return null;
  return /^\d{4}-\d{2}-\d{2}$/u.test(value) ? `${value}T17:00:00+08:00` : value;
}

export async function persistProcessedMeeting(
  input: PersistMeetingInput,
  options: PersistMeetingOptions = {},
): Promise<PersistMeetingResult> {
  const production =
    (options.runtimeEnvironment ?? process.env.NODE_ENV) === "production";
  const client = getServerSupabase();
  if (!client) {
    if (production) {
      throw new PersistenceConfigurationError(
        "Supabase persistence is not configured for production. Set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY before processing meetings.",
      );
    }
    return { persisted: false, warning: "Supabase is not configured; the result is available in this browser only." };
  }
  const userId = input.ownerUserId ||
    (await resolveWorkspaceUserId(client));
  if (!userId) {
    if (production) {
      throw new PersistenceConfigurationError(
        "Supabase persistence could not resolve the authenticated Lantern user.",
      );
    }
    return { persisted: false, warning: "No Supabase user is available." };
  }

  const recordingId = input.preUploadedRecording?.recordingId ?? randomUUID();
  const date = new Date(input.meeting.startAt);
  const path = input.preUploadedRecording?.storagePath ?? (input.audio
    ? `${userId}/${date.getUTCFullYear()}/${String(date.getUTCMonth() + 1).padStart(2, "0")}/${recordingId}.${extensionOf(input.fileName || "recording.wav", input.audio.type)}`
    : undefined);

  if (input.preUploadedRecording) {
    // Re-check both owner and path at the persistence boundary. This prevents a
    // caller from attaching another owner's private recording to their meeting.
    const { data: recording, error: recordingLookupError } = await client
      .from("recordings")
      .select("id")
      .eq("id", recordingId)
      .eq("user_id", userId)
      .eq("storage_path", path!)
      .maybeSingle();
    if (recordingLookupError || !recording) {
      throw new Error(`Could not verify the pre-uploaded recording: ${recordingLookupError?.message || "owner/path mismatch"}`);
    }
    const { error: recordingError } = await client
      .from("recordings")
      .update({
        language: input.transcription.language,
        status: "ready",
        error_message: null,
        provider_status: { transcription: input.transcription.provider, extraction: input.extraction.provider },
      })
      .eq("id", recordingId)
      .eq("user_id", userId)
      .eq("storage_path", path!);
    if (recordingError) throw new Error(`Could not update recording metadata: ${recordingError.message}`);
  } else if (input.audio && path) {
    const { error: uploadError } = await client.storage.from("recordings").upload(path, input.audio, {
      contentType: input.audio.type || "audio/mp4",
      upsert: false,
    });
    if (uploadError) throw new Error(`Could not store the private recording: ${uploadError.message}`);

    const { error: recordingError } = await client.from("recordings").insert({
      id: recordingId,
      user_id: userId,
      storage_path: path,
      language: input.transcription.language,
      status: "ready",
      provider_status: { transcription: input.transcription.provider, extraction: input.extraction.provider },
    });
    if (recordingError) throw new Error(`Could not save recording metadata: ${recordingError.message}`);
  } else {
    const { error: recordingError } = await client.from("recordings").insert({
      id: recordingId,
      user_id: userId,
      device_id: null,
      storage_path: null,
      language: input.transcription.language,
      status: "ready",
      provider_status: { transcription: input.transcription.provider, extraction: input.extraction.provider },
    });
    if (recordingError) throw new Error(`Could not save live recording metadata: ${recordingError.message}`);
  }

  const { data: meetingRow, error: meetingError } = await client.from("meetings").upsert({
    user_id: userId,
    client_reference: input.clientReference,
    title: input.meeting.title,
    start_at: input.meeting.startAt,
    end_at: input.meeting.endAt,
    status: "processing",
    source: input.meeting.source,
    recording_id: recordingId,
  }, { onConflict: "user_id,client_reference" }).select("id").single();
  if (meetingError || !meetingRow) throw new Error(`Could not save the meeting: ${meetingError?.message || "missing row"}`);
  const meetingId = meetingRow.id as string;

  const contactIds: string[] = [];
  // Use the response contacts as the source of truth. This also persists a
  // manually supplied contact hint when the extraction provider found no
  // participant, and lets us replace temporary browser IDs with database IDs.
  for (const participant of input.meeting.contacts) {
    let query = client.from("contacts").select("id").eq("user_id", userId).eq("name", participant.name).limit(1);
    if (participant.email) query = query.eq("email", participant.email);
    const { data: existing, error: lookupError } = await query.maybeSingle();
    if (lookupError) throw new Error(`Could not look up contact ${participant.name}: ${lookupError.message}`);
    let contactId = existing?.id as string | undefined;
    if (!contactId) {
      const { data: created, error } = await client.from("contacts").insert({
        user_id: userId,
        name: participant.name,
        company: participant.company,
        role: participant.role ?? null,
        email: participant.email ?? null,
        phone: participant.phone ?? null,
      }).select("id").single();
      if (error || !created) throw new Error(`Could not save contact ${participant.name}: ${error?.message || "missing row"}`);
      contactId = created.id as string;
    }
    contactIds.push(contactId);
    participant.id = contactId;
  }

  const { error: unlinkError } = await client.from("meeting_contacts").delete().eq("meeting_id", meetingId);
  if (unlinkError) throw new Error(`Could not refresh meeting contacts: ${unlinkError.message}`);
  if (contactIds.length) {
    const { error } = await client.from("meeting_contacts").insert(contactIds.map((contactId, index) => ({ meeting_id: meetingId, contact_id: contactId, is_primary: index === 0 })));
    if (error) throw new Error(`Could not link meeting contacts: ${error.message}`);
  }

  const { error: transcriptError } = await client.from("transcripts").upsert({
    user_id: userId,
    recording_id: recordingId,
    text: input.transcription.text,
    segments: input.transcription.segments,
    language_data: { detected: input.transcription.language, provider: input.transcription.provider },
  }, { onConflict: "recording_id" });
  if (transcriptError) throw new Error(`Could not save the transcript: ${transcriptError.message}`);

  const insight = input.extraction.insight;
  const { error: insightError } = await client.from("meeting_insights").upsert({
    user_id: userId, meeting_id: meetingId, meeting_type: insight.meetingType, intent: insight.intent,
    interest_level: insight.interestLevel, wants: insight.wants, concern: insight.concern,
    promised: insight.promised, next_action: insight.next, key_points: insight.keyPoints,
  }, { onConflict: "meeting_id" });
  if (insightError) throw new Error(`Could not save meeting insights: ${insightError.message}`);

  const { error: commitmentsDeleteError } = await client.from("commitments").delete().eq("meeting_id", meetingId);
  if (commitmentsDeleteError) throw new Error(`Could not refresh commitments: ${commitmentsDeleteError.message}`);
  if (insight.commitments.length) {
    const { error } = await client.from("commitments").insert(insight.commitments.map((item) => ({ user_id: userId, meeting_id: meetingId, owner_type: item.ownerType, description: item.description, due_at: dueTimestamp(item.dueAt), status: item.status })));
    if (error) throw new Error(`Could not save commitments: ${error.message}`);
  }

  const { error: followUpsDeleteError } = await client.from("follow_ups").delete().eq("meeting_id", meetingId);
  if (followUpsDeleteError) throw new Error(`Could not refresh follow-ups: ${followUpsDeleteError.message}`);
  const followUpIds = input.extraction.followUps.map(() => randomUUID());
  if (input.extraction.followUps.length) {
    const { error } = await client.from("follow_ups").insert(input.extraction.followUps.map((item, index) => ({ id: followUpIds[index], user_id: userId, meeting_id: meetingId, contact_id: contactIds[0] || null, type: item.type, description: item.description, draft: item.draft, due_at: dueTimestamp(item.dueAt), ...(item.schedule ? { schedule_details: item.schedule } : {}), status: "pending" })));
    if (error) throw new Error(`Could not save follow-ups: ${error.message}`);
  }

  // A partial write must not look like a completed import on a later retry.
  const { error: readyError } = await client.from("meetings")
    .update({ status: "ready" }).eq("id", meetingId).eq("user_id", userId);
  if (readyError) throw new Error(`Could not finish saving the meeting: ${readyError.message}`);

  // The processing route serializes this same meeting object after persistence.
  // Mutating only the database-backed identifiers keeps its client reference
  // stable while ensuring subsequent actions carry owned UUIDs.
  input.meeting.followUps = input.extraction.followUps.map((item, index) => ({
    id: followUpIds[index],
    meetingId: input.meeting.id,
    contactId: contactIds[0] || null,
    type: item.type,
    description: item.description,
    draft: item.draft,
    dueAt: item.dueAt,
    schedule: item.schedule,
    status: "pending",
  }));

  const signed = path
    ? (await client.storage.from("recordings").createSignedUrl(path, 3600)).data
    : null;
  return { persisted: true, meetingId, recordingId, contactIds, followUpIds, signedRecordingUrl: signed?.signedUrl };
}
