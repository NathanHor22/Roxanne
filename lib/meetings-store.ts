import "server-only";

import { z } from "zod";
import type { Commitment, Contact, FollowUp, Meeting, MeetingInsight, TranscriptSegment } from "@/lib/types";
import { demoMeetings } from "@/lib/demo-data";
import {
  archivedLanternSessionMeeting,
  type ArchivedLanternSession,
} from "@/lib/hardware-session-meeting";
import { getServerSupabase, resolveWorkspaceUserId } from "@/lib/supabase/server";

type Row = Record<string, unknown>;

const calendarRetryPayloadSchema = z.object({
  summary: z.string().trim().min(1).max(200),
  startAt: z.string().datetime({ offset: true }),
  durationMinutes: z.number().int().min(5).max(480).default(30),
  attendees: z.array(z.string().email()).min(1).max(20),
  location: z.string().max(500).nullable().optional(),
});

export async function loadMeetings(): Promise<{ meetings: Meeting[]; source: "supabase" | "seed" }> {
  const client = getServerSupabase();
  if (!client) return { meetings: demoMeetings, source: "seed" };
  const userId = await resolveWorkspaceUserId(client);
  if (!userId) return { meetings: [], source: "supabase" };

  const [meetingsResult, archivedSessionsResult] = await Promise.all([
    client
      .from("meetings")
      .select("*")
      .eq("user_id", userId)
      .order("start_at"),
    client
      .from("lantern_sessions")
      .select("id,started_at,capture_ended_at,recording_id,processing_error")
      .eq("user_id", userId)
      .not("recording_id", "is", null)
      .is("meeting_id", null)
      .order("started_at"),
  ]);
  if (meetingsResult.error) {
    throw new Error(`Could not load meetings: ${meetingsResult.error.message}`);
  }
  if (archivedSessionsResult.error) {
    throw new Error(`Could not load archived Lantern recordings: ${archivedSessionsResult.error.message}`);
  }
  const meetingRows = meetingsResult.data || [];
  const archivedSessionRows = (archivedSessionsResult.data || []) as ArchivedLanternSession[];
  if (!meetingRows.length && !archivedSessionRows.length) {
    return { meetings: [], source: "supabase" };
  }
  const meetingIds = meetingRows.map((row) => row.id);

  const linksResult = meetingIds.length
    ? await client.from("meeting_contacts").select("meeting_id,is_primary,contacts(*)").in("meeting_id", meetingIds)
    : { data: [], error: null };
  const [recordingsResult, transcriptsResult, insightsResult, commitmentsResult, followUpsResult, actionsResult] = await Promise.all([
    client.from("recordings").select("id,storage_path").eq("user_id", userId),
    client.from("transcripts").select("recording_id,segments").eq("user_id", userId),
    client.from("meeting_insights").select("*").eq("user_id", userId),
    client.from("commitments").select("*").eq("user_id", userId),
    client.from("follow_ups").select("*").eq("user_id", userId),
    client.from("actions").select("meeting_id,follow_up_id,external_id,payload").eq("user_id", userId).eq("type", "calendar_event"),
  ]);
  const failure = [linksResult, recordingsResult, transcriptsResult, insightsResult, commitmentsResult, followUpsResult, actionsResult].find((result) => result.error);
  if (failure?.error) throw new Error(`Could not load meetings: ${failure.error.message}`);
  const publicIdByDatabaseId = new Map(meetingRows.map((row) => [row.id, row.client_reference || row.id]));
  // An event can exist even when a later local completion write failed.
  const actionByEvent = new Map((actionsResult.data || []).filter((row) => row.external_id).map((row) => [row.external_id, row]));
  const actionByFollowUp = new Map((actionsResult.data || []).filter((row) => row.follow_up_id).map((row) => [row.follow_up_id, row]));

  const paths = (recordingsResult.data || []).map((row) => row.storage_path).filter((path): path is string => typeof path === "string");
  const { data: signedRows } = paths.length ? await client.storage.from("recordings").createSignedUrls(paths, 3600) : { data: [] };
  const signedByPath = new Map((signedRows || []).map((row) => [row.path, row.signedUrl]));
  const recordingById = new Map((recordingsResult.data || []).map((row) => [row.id, row]));
  const transcriptByRecording = new Map((transcriptsResult.data || []).map((row) => [row.recording_id, row.segments]));
  const insightByMeeting = new Map((insightsResult.data || []).map((row) => [row.meeting_id, row as Row]));
  const commitmentsByMeeting = new Map<string, Commitment[]>();
  for (const row of commitmentsResult.data || []) {
    const commitment: Commitment = {
      id: row.id,
      ownerType: row.owner_type,
      description: row.description,
      dueAt: row.due_at,
      status: row.status,
    };
    commitmentsByMeeting.set(row.meeting_id, [
      ...(commitmentsByMeeting.get(row.meeting_id) || []),
      commitment,
    ]);
  }
  const followUpsByMeeting = new Map<string, FollowUp[]>();
  for (const row of followUpsResult.data || []) {
    const followUp: FollowUp = { id: row.id, meetingId: row.meeting_id, contactId: row.contact_id, type: row.type, description: row.description, dueAt: row.due_at, status: row.status, draft: row.draft, schedule: row.schedule_details || null };
    const action = actionByFollowUp.get(row.id);
    if (followUp.type === "schedule" && followUp.status !== "completed" && followUp.status !== "dismissed" && action && action.meeting_id === row.meeting_id) {
      const retry = calendarRetryPayloadSchema.safeParse(action.payload);
      if (retry.success) {
        // Preserve what the user actually submitted across refreshes. Rebuilding
        // from the extraction could change the request after an ambiguous send.
        followUp.description = retry.data.summary;
        followUp.dueAt = retry.data.startAt;
        followUp.schedule = {
          agreement: "agreed",
          startAt: retry.data.startAt,
          durationMinutes: retry.data.durationMinutes,
          attendees: retry.data.attendees,
          location: retry.data.location ?? null,
          evidence: followUp.schedule?.evidence ?? null,
        };
      }
    }
    followUpsByMeeting.set(row.meeting_id, [...(followUpsByMeeting.get(row.meeting_id) || []), followUp]);
  }
  const contactsByMeeting = new Map<string, Contact[]>();
  for (const link of linksResult.data || []) {
    const raw = Array.isArray(link.contacts) ? link.contacts[0] : link.contacts;
    if (!raw) continue;
    const contact = raw as unknown as Row;
    const mapped: Contact = { id: String(contact.id), name: String(contact.name), company: typeof contact.company === "string" ? contact.company : null, role: typeof contact.role === "string" ? contact.role : null, email: typeof contact.email === "string" ? contact.email : null, phone: typeof contact.phone === "string" ? contact.phone : null };
    contactsByMeeting.set(link.meeting_id, [...(contactsByMeeting.get(link.meeting_id) || []), mapped]);
  }

  const meetings: Meeting[] = meetingRows.map((row) => {
    const insightRow = insightByMeeting.get(row.id);
    const insight: MeetingInsight | null = insightRow ? {
      meetingType: String(insightRow.meeting_type || "meeting"), intent: String(insightRow.intent || ""), interestLevel: (insightRow.interest_level || "unknown") as MeetingInsight["interestLevel"],
      wants: String(insightRow.wants || ""), concern: String(insightRow.concern || ""), promised: String(insightRow.promised || ""), next: String(insightRow.next_action || ""),
      keyPoints: Array.isArray(insightRow.key_points) ? insightRow.key_points.map(String) : [], commitments: commitmentsByMeeting.get(row.id) || [],
    } : null;
    const recording = row.recording_id ? recordingById.get(row.recording_id) : undefined;
    const path = recording?.storage_path;
    return {
      id: row.client_reference || row.id,
      title: row.title,
      startAt: row.start_at,
      endAt: row.end_at,
      status: row.status,
      source: row.source,
      calendarEventId: row.calendar_event_id || null,
      sourceConversationId: publicIdByDatabaseId.get(actionByEvent.get(row.calendar_event_id)?.meeting_id) || null,
      sourceApprovalId: actionByEvent.get(row.calendar_event_id)?.follow_up_id || null,
      contacts: contactsByMeeting.get(row.id) || [],
      recordingId: row.recording_id,
      recordingUrl: typeof path === "string" ? signedByPath.get(path) || null : null,
      transcript: (row.recording_id ? transcriptByRecording.get(row.recording_id) : []) as TranscriptSegment[],
      insight,
      followUps: (followUpsByMeeting.get(row.id) || []).map((followUp) => ({
        ...followUp,
        meetingId: row.client_reference || row.id,
      })),
    } satisfies Meeting;
  });
  const existingReferences = new Set(meetings.map((meeting) => meeting.id));
  for (const session of archivedSessionRows) {
    if (existingReferences.has(`hardware:${session.id}`)) continue;
    const recording = recordingById.get(session.recording_id);
    const path = recording?.storage_path;
    meetings.push(
      archivedLanternSessionMeeting(
        session,
        typeof path === "string" ? signedByPath.get(path) || null : null,
      ),
    );
  }
  meetings.sort((left, right) => Date.parse(left.startAt) - Date.parse(right.startAt));
  return { meetings, source: "supabase" };
}
