import type { SupabaseClient } from "@supabase/supabase-js";

import {
  buildBootBriefing,
  buildStatusBriefing,
  localDateKey,
  ownerSpokenName,
  type DeviceMeetingBrief,
} from "./device-briefing";
import { env } from "./env";

export interface LoadedDeviceBriefing {
  speech: string;
  meetingCount: number;
  approvalCount: number;
  followUpIds: string[];
}

export async function loadDeviceBriefing(
  client: SupabaseClient,
  userId: string,
  kind: "boot" | "status",
  batteryLevel: number | null,
): Promise<LoadedDeviceBriefing> {
  const { data: profile, error: profileError } = await client
    .from("profiles")
    .select("name,email,timezone")
    .eq("id", userId)
    .maybeSingle();
  if (profileError) throw new Error(profileError.message);

  const ownerName = ownerSpokenName(profile?.name || null, profile?.email || null);
  if (kind === "boot") {
    return {
      speech: buildBootBriefing({ ownerName, batteryLevel }),
      meetingCount: 0,
      approvalCount: 0,
      followUpIds: [],
    };
  }

  const timeZone = profile?.timezone || env().APP_TIMEZONE;
  const now = new Date();
  const targetDate = localDateKey(now, timeZone);
  const lower = new Date(now.getTime() - 36 * 60 * 60 * 1_000).toISOString();
  const upper = new Date(now.getTime() + 12 * 60 * 60 * 1_000).toISOString();
  const { data: meetingRows, error: meetingsError } = await client
    .from("meetings")
    .select("id,title,start_at")
    .eq("user_id", userId)
    .eq("status", "ready")
    .gte("start_at", lower)
    .lte("start_at", upper)
    .order("start_at", { ascending: true });
  if (meetingsError) throw new Error(meetingsError.message);

  const todaysRows = (meetingRows || []).filter(
    (meeting) => localDateKey(meeting.start_at, timeZone) === targetDate,
  );
  const meetingIds = todaysRows.map((meeting) => meeting.id);
  const [insightsResult, approvalsResult] = meetingIds.length
    ? await Promise.all([
        client
          .from("meeting_insights")
          .select("meeting_id,intent,next_action,key_points,wants,concern,promised")
          .eq("user_id", userId)
          .in("meeting_id", meetingIds),
        client
          .from("follow_ups")
          .select("id")
          .eq("user_id", userId)
          .in("status", ["pending", "approved"])
          .in("meeting_id", meetingIds),
      ])
    : [{ data: [], error: null }, { data: [], error: null }];
  if (insightsResult.error) throw new Error(insightsResult.error.message);
  if (approvalsResult.error) throw new Error(approvalsResult.error.message);

  const insightByMeeting = new Map(
    (insightsResult.data || []).map((insight) => [insight.meeting_id, insight]),
  );
  const { data: commitments, error: commitmentsError } = meetingIds.length
    ? await client.from("commitments").select("meeting_id,owner_type,description,due_at,status").eq("user_id", userId).in("meeting_id", meetingIds)
    : { data: [], error: null };
  if (commitmentsError) throw new Error(commitmentsError.message);
  const meetings: DeviceMeetingBrief[] = todaysRows.map((meeting) => {
    const insight = insightByMeeting.get(meeting.id);
    return {
      title: meeting.title,
      keyPoints: Array.isArray(insight?.key_points)
        ? insight.key_points.filter((point): point is string => typeof point === "string")
        : [],
      intent: insight?.intent,
      nextAction: insight?.next_action,
      wants: insight?.wants,
      concern: insight?.concern,
      promised: insight?.promised,
      commitments: (commitments || []).filter(c => c.meeting_id === meeting.id).map(c =>
        `${c.owner_type === "user" ? "You" : "The contact"}: ${c.description}${c.due_at ? `, due ${new Intl.DateTimeFormat("en-MY", { timeZone, dateStyle: "medium" }).format(new Date(c.due_at))}` : ""}. ${c.status === "completed" ? "Completed." : "Still open."}`),
    };
  });
  const approvalCount = approvalsResult.data?.length || 0;
  return {
    speech: buildStatusBriefing({
      ownerName,
      meetings,
      pendingApprovals: approvalCount,
    }),
    meetingCount: meetings.length,
    approvalCount,
    followUpIds: (approvalsResult.data || []).map(row => row.id),
  };
}
