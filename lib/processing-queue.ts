import { randomUUID } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { conversationClock } from "./conversation-clock";
import { env } from "./env";
import { transcriptionResultSchema, type TranscriptionResult } from "./meeting-schema";
import { persistFailedHardwareMeeting, persistProcessedMeeting } from "./persistence";
import { transcribeWithOpenAI } from "./providers/openai-transcription";
import { extractConversationInsights } from "./providers/meeting-extraction";
import type { Meeting } from "./types";

/** A job owns one archived session, never the current state of its device. */
export async function processNextRecording(client: SupabaseClient, userId?: string, sessionId?: string) {
  const { data: jobs, error: claimError } = await client.rpc("claim_lantern_processing", {
    p_user_id: userId || null, p_session_id: sessionId || null,
  });
  if (claimError) throw new Error(claimError.message);
  const job = jobs?.[0];
  if (!job) return false;
  const { data: session, error: sessionError } = await client.from("lantern_sessions").select("*")
    .eq("id", job.session_id).eq("user_id", job.user_id).single();
  if (sessionError || !session) throw new Error("Queued session is missing.");
  const reference = `hardware:${session.id}`;
  const clock = conversationClock(session.recording_started_at || session.started_at, session.conversation_timezone || env().APP_TIMEZONE);
  const endAt = session.capture_ended_at || session.ended_at;
  const { data: recording } = await client.from("recordings").select("id,storage_path")
    .eq("id", session.recording_id).eq("user_id", job.user_id).single();
  const updateJob = async (values: Record<string, unknown>) => {
    const { data, error } = await client.from("lantern_processing_jobs").update({ ...values, updated_at: new Date().toISOString() })
      .eq("session_id", session.id).eq("lease_token", job.lease_token).select("session_id").maybeSingle();
    if (error || !data) throw new Error("The processing lease was lost.");
  };
  const stage = async (processing_stage: string, values: Record<string, unknown> = {}) => {
    await updateJob({});
    const { error } = await client.from("lantern_sessions").update({ processing_stage, ...values })
      .eq("id", session.id).eq("user_id", job.user_id);
    if (error) throw new Error(error.message);
  };
  let readyMeetingId: string | null = null;
  try {
    if (!recording?.storage_path) throw new Error("Original WAV is unavailable.");
    // Recover a lost completion response without replacing approved follow-ups.
    const { data: existing, error: existingError } = await client.from("meetings").select("id,status")
      .eq("user_id", job.user_id).eq("client_reference", reference).maybeSingle();
    if (existingError) throw new Error("Could not check whether this meeting is already complete.");
    if (existing?.status === "ready") {
      readyMeetingId = existing.id;
      await stage("ready", { meeting_id: existing.id, processing_error: null });
      await updateJob({ state: "ready", lease_until: null, last_error: null });
      return true;
    }
    if (job.attempts > 3) throw new Error("Processing timed out repeatedly. The original recording is preserved.");
    let transcription: TranscriptionResult;
    if (session.final_transcription) {
      transcription = transcriptionResultSchema.parse(session.final_transcription);
    } else {
      await stage("transcribing");
      const { data: audio, error: audioError } = await client.storage.from("recordings").download(recording.storage_path);
      if (audioError || !audio) throw new Error("Could not read the original WAV.");
      try {
        transcription = await transcribeWithOpenAI(audio, { fileName: `${session.id}.wav`, timeoutMs: 120000 });
      } catch (cause) {
        if (job.attempts < 3 || !session.transcript_segments?.length) throw cause;
        transcription = transcriptionResultSchema.parse({
          text: session.transcript_segments.map((s: { speaker: string; text: string }) => `${s.speaker}: ${s.text}`).join("\n"),
          segments: session.transcript_segments, language: session.transcript_language || "multilingual", provider: "agora",
          warning: "Final speaker separation was unavailable; this report uses the live transcript.",
        });
      }
      await stage("summarising", { final_transcription: transcription, transcript_segments: transcription.segments,
        transcript_language: transcription.language, transcript_received_at: new Date().toISOString() });
    }
    const extraction = await extractConversationInsights(transcription.segments, {
      title: "Recorded conversation", outputLanguage: "English", referenceDate: clock.startedAt,
      timezone: clock.timeZone, referenceLocalDateTime: clock.localDateTime,
    });
    await stage("saving");
    const contacts = extraction.participants.map(p => ({ id: randomUUID(), ...p }));
    const meeting: Meeting = {
      id: reference, title: contacts[0] ? `${contacts[0].name}${contacts[0].company ? ` · ${contacts[0].company}` : ""}` : `Conversation · ${clock.localDate} ${clock.localTime.slice(0, 5)}`,
      startAt: clock.startedAt, endAt, status: "ready", source: "hardware", contacts,
      recordingId: recording.id, transcript: transcription.segments, insight: extraction.insight, followUps: [],
    };
    const saved = await persistProcessedMeeting({ ownerUserId: job.user_id, clientReference: reference,
      meeting, transcription, extraction, preUploadedRecording: { recordingId: recording.id, storagePath: recording.storage_path } });
    if (!saved.meetingId) throw new Error("Could not save the meeting.");
    readyMeetingId = saved.meetingId;
    await stage("ready", { meeting_id: saved.meetingId, processing_error: null });
    await updateJob({ state: "ready", lease_until: null, last_error: null });
  } catch (cause) {
    const message = cause instanceof Error ? cause.message.slice(0, 500) : "Processing failed.";
    if (!readyMeetingId) {
      // The ready write itself may have committed before its response was lost.
      // If we cannot read that boundary, leave the lease for recovery; do not
      // overwrite a possibly completed meeting with a failure placeholder.
      const { data: recovered, error: recoveryError } = await client.from("meetings").select("id,status")
        .eq("user_id", job.user_id).eq("client_reference", reference).maybeSingle();
      if (recoveryError) throw new Error("Could not verify the saved meeting. The job will be retried.");
      if (recovered?.status === "ready") readyMeetingId = recovered.id;
    }
    if (readyMeetingId) {
      // A bookkeeping outage must never overwrite a completed meeting or its
      // approved actions. The next lease repairs the session/job association.
      await updateJob({ state: "queued", lease_until: null, last_error: message,
        available_at: new Date(Date.now() + 60000).toISOString() });
      return true;
    }
    const failed = job.attempts >= 3;
    await stage(failed ? "failed" : "queued", { processing_error: message });
    if (failed && recording?.storage_path) {
      const saved = await persistFailedHardwareMeeting(client, {
        ownerUserId: job.user_id, clientReference: reference, title: `Conversation · ${clock.localDate} ${clock.localTime.slice(0, 5)}`,
        startAt: clock.startedAt, endAt, recordingId: recording.id, storagePath: recording.storage_path, errorMessage: message,
      });
      await stage("failed", { meeting_id: saved.meetingId });
    }
    await updateJob({ state: failed ? "failed" : "queued", lease_until: null, last_error: message,
      available_at: new Date(Date.now() + job.attempts * 60000).toISOString() });
  }
  return true;
}
