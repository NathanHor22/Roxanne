import { randomUUID } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { localDateKey, meetingReportDetails, splitSpeechPages, type DeviceMeetingBrief } from "./device-briefing";
import { createVoicePrompt } from "./device-dialogue";
import type { AuthenticatedLantern } from "./lantern-device-auth";
import { validTimezone } from "./quipus-profile";
import { parseReportRequest, selectReportMeetings, shiftDate, type ReportDepth, type ReportRequest } from "./report-request";

export interface ReportMeeting extends DeviceMeetingBrief {
  id: string; startAt: string; person: string; status: string; transcriptAvailable: boolean;
  actions: { id: string; description: string }[];
}
export interface ReportState {
  date: string; timezone: string; meetings: ReportMeeting[]; selectedIndex: number;
  depth: ReportDepth; dailyReportId?: string; dailyPage: number;
  currentReportId?: string; currentPage: number;
  dailyDate?: string; dailyMeetings?: ReportMeeting[];
  currentMeetingPages?: number[]; dailyMeetingPages?: number[];
}
export interface ReportPlaybackInput {
  contextId?: string; playbackId?: string; playbackPage?: number; text: string;
}

export async function snapshotDay(client: SupabaseClient, userId: string, date: string, timezone: string): Promise<ReportMeeting[]> {
  // Wider UTC window accommodates all civil timezones, including DST days.
  const rows = await client.from("meetings").select("id,title,start_at,status,recording_id")
    .eq("user_id", userId).neq("source", "calendar")
    .gte("start_at", `${shiftDate(date, -1)}T00:00:00Z`).lt("start_at", `${shiftDate(date, 2)}T00:00:00Z`)
    .order("start_at", { ascending: true }).order("id", { ascending: true });
  if (rows.error) throw rows.error;
  const meetings = (rows.data || []).filter(row => localDateKey(row.start_at, timezone) === date);
  if (!meetings.length) return [];
  const ids = meetings.map(row => row.id);
  const recordingIds = meetings.map(row => row.recording_id).filter(Boolean);
  const [insights, actions, commitments, contacts, transcripts] = await Promise.all([
    client.from("meeting_insights").select("meeting_id,intent,next_action,key_points,wants,concern,promised").eq("user_id", userId).in("meeting_id", ids),
    client.from("follow_ups").select("id,meeting_id,description").eq("user_id", userId).in("meeting_id", ids).in("status", ["pending", "approved"]),
    client.from("commitments").select("meeting_id,owner_type,description,due_at,status").eq("user_id", userId).in("meeting_id", ids),
    client.from("meeting_contacts").select("meeting_id,contacts(name,user_id)").in("meeting_id", ids),
    recordingIds.length ? client.from("transcripts").select("recording_id").eq("user_id", userId).in("recording_id", recordingIds) : Promise.resolve({ data: [], error: null }),
  ]);
  for (const result of [insights, actions, commitments, contacts, transcripts]) if (result.error) throw result.error;
  return meetings.map(row => {
    const insight = insights.data?.find(item => item.meeting_id === row.id);
    return {
      id: row.id, title: row.title, startAt: row.start_at, status: row.status,
      person: (contacts.data || []).filter(item => item.meeting_id === row.id).flatMap(item => Array.isArray(item.contacts) ? item.contacts : [item.contacts])
        .filter(item => item && item.user_id === userId).map(item => item.name).join(", "),
      transcriptAvailable: Boolean(transcripts.data?.some(item => item.recording_id === row.recording_id)),
      keyPoints: Array.isArray(insight?.key_points) ? insight.key_points.filter((item): item is string => typeof item === "string") : [],
      intent: insight?.intent, wants: insight?.wants, concern: insight?.concern, promised: insight?.promised, nextAction: insight?.next_action,
      actions: (actions.data || []).filter(item => item.meeting_id === row.id).map(item => ({ id: item.id, description: item.description })),
      commitments: (commitments.data || []).filter(item => item.meeting_id === row.id).map(item =>
        `${item.owner_type === "user" ? "You" : "The contact"}: ${item.description}${item.due_at ? `, due ${new Intl.DateTimeFormat("en-MY", { timeZone: timezone, dateStyle: "medium" }).format(new Date(item.due_at))}` : ""}. ${item.status === "completed" ? "Completed." : "Still open."}`),
    };
  });
}

export async function deviceReportManifest(client: SupabaseClient, userId: string, limit = 5) {
  const profile = await client.from("profiles").select("timezone").eq("id", userId).maybeSingle();
  if (profile.error) throw profile.error;
  const timezone = validTimezone(profile.data?.timezone);
  const today = localDateKey(new Date(), timezone);
  const meetings = await snapshotDay(client, userId, today, timezone);
  return meetings.slice(-Math.max(1, Math.min(limit, 5))).reverse().map((meeting) => ({
    id: meeting.id,
    title: meeting.title.slice(0, 48),
    time: new Intl.DateTimeFormat("en-MY", { timeZone: timezone, hour: "numeric", minute: "2-digit" })
      .format(new Date(meeting.startAt)),
    status: meeting.status === "ready" ? "READY" : meeting.status === "processing" ? "PROCESSING" : "PENDING",
    summary: meeting.status === "ready"
      ? (meeting.intent || meeting.keyPoints[0] || "Summary available in the dashboard.").slice(0, 144)
      : "Saved safely. Quipus is still preparing this meeting.",
    action: meeting.status === "ready"
      ? (meeting.actions[0]?.description || meeting.nextAction || meeting.commitments?.[0] || "No pending action.").slice(0, 96)
      : "No action until processing finishes.",
  }));
}
export function reportMeetingLabel(meeting: ReportMeeting, state: ReportState): string {
  const number = state.meetings.findIndex(item => item.id === meeting.id) + 1;
  const time = new Intl.DateTimeFormat("en-MY", { timeZone: state.timezone, hour: "numeric", minute: "2-digit" }).format(new Date(meeting.startAt));
  return `Meeting ${number}, recorded at ${time}: ${meeting.title}.`;
}
/** Each meeting starts a separate speech section; detailed mode keeps all points. */
export function reportSections(state: ReportState, selected: ReportMeeting[], depth: ReportDepth): string[] {
  const date = new Intl.DateTimeFormat("en-MY", { timeZone: "UTC", dateStyle: "full" }).format(new Date(`${state.date}T12:00:00Z`));
  const sections = [`Your ${depth === "full" ? "detailed report" : depth === "actions" ? "action items" : "overview"} for ${date}. Times are in ${state.timezone.replaceAll("_", " ")}.`];
  if (!selected.length) return [...sections, "There are no recorded conversations for this date. A recording still uploading may not appear yet."];
  for (const meeting of selected) {
    let details: string[];
    if (meeting.status !== "ready") details = [meeting.status === "processing" ? "This recording is still processing. Its summary is not ready yet." : "The summary is unavailable. Please check this recording in your dashboard."];
    else if (depth === "actions") details = [...(meeting.commitments || []), ...meeting.actions.map(item => item.description)];
    else if (depth === "full") details = meetingReportDetails(meeting);
    else details = [meeting.intent || meeting.keyPoints[0] || "", meeting.nextAction ? `Next step: ${meeting.nextAction}` : ""].filter(Boolean);
    sections.push(`${reportMeetingLabel(meeting, state)} ${details.length ? details.join(" ") : "No extracted details are available."}${!meeting.transcriptAvailable && meeting.status === "ready" ? " The source transcript is unavailable; these are saved summary details." : ""}`);
  }
  return sections;
}

export async function prepareReportQuery(client: SupabaseClient, device: AuthenticatedLantern, input: ReportPlaybackInput) {
  if (device.state !== "ready") throw new Error("Finish the current recording before requesting a report.");
  const profile = await client.from("profiles").select("timezone").eq("id", device.userId).maybeSingle();
  if (profile.error) throw profile.error;
  const timezone = validTimezone(profile.data?.timezone);
  let contextId = input.contextId;
  let state: ReportState | undefined;
  if (contextId) {
    const saved = await client.from("device_report_sessions").select("state").eq("id", contextId)
      .eq("user_id", device.userId).eq("device_id", device.id).gt("expires_at", new Date().toISOString()).maybeSingle();
    if (saved.error) throw saved.error;
    if (saved.data) state = saved.data.state as ReportState;
    else contextId = undefined;
  }
  const request = parseReportRequest(input.text, timezone);
  const expired = Boolean(input.contextId && !state);
  const targetDate = request.date || state?.date || localDateKey(new Date(), timezone);
  const freshDaily = request.action === "query" && Boolean(request.date) && request.ordinal === undefined && request.minute === undefined && !request.person;
  if (!state || state.date !== targetDate || freshDaily) {
    state = { date: targetDate, timezone, meetings: await snapshotDay(client, device.userId, targetDate, timezone), selectedIndex: -1, depth: "quick",
      dailyReportId: state?.dailyReportId, dailyPage: state?.dailyPage || 0, dailyDate: state?.dailyDate,
      dailyMeetings: state?.dailyMeetings, dailyMeetingPages: state?.dailyMeetingPages, currentPage: 0 };
  }
  if (input.playbackId && input.playbackPage !== undefined) {
    if (state.dailyReportId === input.playbackId) state.dailyPage = input.playbackPage;
    if (state.currentReportId === input.playbackId) {
      state.currentPage = input.playbackPage;
      const index = state.currentMeetingPages?.[input.playbackPage];
      if (index !== undefined && index >= 0) state.selectedIndex = index;
    }
  }
  contextId ||= randomUUID();
  const persist = async () => {
    const result = await client.from("device_report_sessions").upsert({ id: contextId, user_id: device.userId, device_id: device.id, state,
      expires_at: new Date(Date.now() + 7200000).toISOString() });
    if (result.error) throw result.error;
  };
  // A new report request invalidates prior spoken approvals. A yes in report
  // context can never execute one of those prompts.
  const cancelled = await client.from("device_voice_prompts").update({ status: "completed", result: { speech: "That review was cancelled. Ask for a new report to review actions." } })
    .eq("device_id", device.id).eq("user_id", device.userId).eq("status", "pending");
  if (cancelled.error) throw cancelled.error;

  const storeSpeech = async (sections: string[], selected: ReportMeeting[] = [], daily = false, intent = "report_answer") => {
    const ids = selected.flatMap(meeting => meeting.actions.map(action => action.id));
    let token: string | undefined;
    if (ids.length) {
      const prompt = await createVoicePrompt(client, device, "review", {}, ids,
        `I found ${ids.length} pending action item${ids.length === 1 ? "" : "s"}. Would you like to review them? Say yes or no. Each send needs your approval.`);
      token = prompt.token;
      sections.push(prompt.speech);
    } else if (selected.length) sections.push("Report complete. You can ask for another meeting, a full breakdown, or another date.");
    const id = randomUUID();
    const pages = sections.flatMap(section => splitSpeechPages(section));
    const meetingPages = sections.flatMap(section => {
      const index = selected.findIndex(meeting => section.startsWith(reportMeetingLabel(meeting, state!)));
      const ordinal = index < 0 ? -1 : state!.meetings.findIndex(meeting => meeting.id === selected[index].id);
      return splitSpeechPages(section).map(() => ordinal);
    });
    const saved = await client.from("device_reports").insert({ id, user_id: device.userId, device_id: device.id, pages, review_token: token || null });
    if (saved.error) throw saved.error;
    state!.currentReportId = id; state!.currentPage = 0;
    state!.currentMeetingPages = meetingPages;
    if (daily) { state!.dailyReportId = id; state!.dailyPage = 0; state!.dailyDate = state!.date; state!.dailyMeetings = state!.meetings; state!.dailyMeetingPages = meetingPages; }
    await persist();
    return { reportId: id, page: 0, reportContextId: contextId, intent };
  };
  if (request.action === "stop") return storeSpeech(["Report stopped. Nothing has been sent."], [], false, "report_stop");
  if (expired && !request.date && (["continue", "repeat", "next"].includes(request.action) || request.ordinal !== undefined || request.minute !== undefined || request.person)) return storeSpeech(["Your earlier report has expired. Ask for a new report and its date."]);
  if (request.action === "unknown") return storeSpeech(["You can ask for today's report, yesterday, a full breakdown, the third meeting, or a meeting at a specific time. Nothing has been sent."]);
  if (request.action === "continue" || request.action === "repeat") {
    const id = request.action === "continue" ? state.dailyReportId : state.currentReportId;
    const page = request.action === "continue" ? state.dailyPage : state.currentPage;
    if (!id) return storeSpeech(["There is no paused report yet. Ask for a daily report first."]);
    if (request.action === "continue" && state.dailyMeetings && state.dailyDate) {
      state.date = state.dailyDate; state.meetings = state.dailyMeetings; state.currentMeetingPages = state.dailyMeetingPages;
    }
    const previous = await client.from("device_reports").select("pages,review_token").eq("id", id).eq("user_id", device.userId).eq("device_id", device.id).gt("expires_at", new Date().toISOString()).maybeSingle();
    if (previous.error || !previous.data) return storeSpeech(["That playback has expired. Ask for a fresh report and its date."]);
    if (page >= previous.data.pages.length) return storeSpeech(["That report already finished. Ask for another meeting, date, or a new full report."]);
    if (previous.data.review_token) {
      const review = await client.from("device_voice_prompts").select("remaining_ids").eq("id", previous.data.review_token).eq("user_id", device.userId).eq("device_id", device.id).maybeSingle();
      if (review.error) throw review.error;
      if (review.data?.remaining_ids?.length) {
        const prompt = await createVoicePrompt(client, device, "review", {}, review.data.remaining_ids, "Review pending actions?");
        const refreshed = await client.from("device_reports").update({ review_token: prompt.token }).eq("id", id).eq("user_id", device.userId).eq("device_id", device.id);
        if (refreshed.error) throw refreshed.error;
      }
    }
    state.currentReportId = id; state.currentPage = page;
    await persist();
    // A resumed report offers a fresh review; individual send approvals from
    // the interrupted exchange stay cancelled and cannot be replayed.
    return { reportId: id, page, reportContextId: contextId, intent: "report_answer" };
  }
  const selection: ReportRequest = request.action === "next" ? { action: "query", ordinal: state.selectedIndex + 2 } : request;
  const selected = selectReportMeetings(state.meetings, selection, state.timezone);
  const targeted = selection.ordinal !== undefined || selection.minute !== undefined || Boolean(selection.person);
  if (targeted && !selected.length) return storeSpeech([`I couldn't find that recorded meeting on ${state.date}. There are ${state.meetings.length} conversations in this report. Say a meeting number, another date, or stop.`]);
  if (targeted && selected.length > 1) return storeSpeech([`More than one recording matches. ${selected.map(meeting => reportMeetingLabel(meeting, state!)).join(" ")} Say the meeting number.`]);
  if (targeted) state.selectedIndex = state.meetings.findIndex(meeting => meeting.id === selected[0].id);
  state.depth = selection.depth || (targeted ? "full" : state.depth);
  return storeSpeech(reportSections(state, selected, state.depth), selected.filter(meeting => meeting.status === "ready"), !targeted);
}
