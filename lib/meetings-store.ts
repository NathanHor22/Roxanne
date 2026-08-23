import "server-only";

import type { Commitment, Contact, FollowUp, Meeting, MeetingInsight, TranscriptSegment } from "@/lib/types";
import { demoMeetings } from "@/lib/demo-data";
import { getServerSupabase, resolveDemoUserId } from "@/lib/supabase/server";

type Row = Record<string, unknown>;

export async function loadMeetings(): Promise<{ meetings: Meeting[]; source: "supabase" | "seed" }> {
  const client = getServerSupabase();
  if (!client) return { meetings: demoMeetings, source: "seed" };
  const userId = await resolveDemoUserId(client);
  if (!userId) return { meetings: demoMeetings, source: "seed" };

  const [meetingsResult, linksResult, recordingsResult, transcriptsResult, insightsResult, commitmentsResult, followUpsResult] = await Promise.all([
    client.from("meetings").select("*").eq("user_id", userId).order("start_at"),
    client.from("meeting_contacts").select("meeting_id,is_primary,contacts(*)"),
    client.from("recordings").select("id,storage_path").eq("user_id", userId),
    client.from("transcripts").select("recording_id,segments").eq("user_id", userId),
    client.from("meeting_insights").select("*").eq("user_id", userId),
    client.from("commitments").select("*").eq("user_id", userId),
    client.from("follow_ups").select("*").eq("user_id", userId),
  ]);
  const failure = [meetingsResult, linksResult, recordingsResult, transcriptsResult, insightsResult, commitmentsResult, followUpsResult].find((result) => result.error);
  if (failure?.error) throw new Error(`Could not load meetings: ${failure.error.message}`);
  if (!meetingsResult.data?.length) return { meetings: demoMeetings, source: "seed" };

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
    const followUp: FollowUp = { id: row.id, meetingId: row.meeting_id, contactId: row.contact_id, type: row.type, description: row.description, dueAt: row.due_at, status: row.status, draft: row.draft };
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

  const meetings = meetingsResult.data.map((row) => {
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
  return { meetings, source: "supabase" };
}
