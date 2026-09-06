import { z } from "zod";
import type { Contact, Meeting, ScheduleDetails } from "../types";

export type WorkspaceMode = "sample" | "live";
export interface MeetingApproval {
  id: string;
  conversationId: string;
  title: string;
  contact: Contact | null;
  details: ScheduleDetails;
  status: "pending" | "completed" | "dismissed";
}
export interface WorkspaceData {
  version: 1;
  meetings: Meeting[];
}

export const scheduleDetailsSchema = z
  .object({
    agreement: z.enum(["agreed", "tentative"]),
    startAt: z.string().datetime({ offset: true }).nullable(),
    durationMinutes: z.number().int().min(5).max(480).nullable(),
    attendees: z.array(z.string().trim().email()).max(20),
    location: z.string().trim().max(500).nullable(),
    evidence: z.string().trim().max(2000).nullable(),
  })
  .strict();

/** The hardware adapter will deliver final, ordered segments through this boundary.
 * Device credentials and streaming transport stay outside the dashboard. */
export const conversationInputSchema = z
  .object({
    version: z.literal(1),
    sourceReference: z.string().trim().min(1).max(120),
    source: z.enum(["agora", "transcript_import"]),
    title: z.string().trim().min(1).max(200),
    startedAt: z.string().datetime({ offset: true }),
    endedAt: z.string().datetime({ offset: true }),
    timeZone: z.literal("Asia/Kuala_Lumpur"),
    segments: z
      .array(
        z
          .object({
            id: z.string().min(1).max(120),
            speaker: z.string().min(1).max(80),
            text: z.string().trim().min(1).max(50_000),
            startSeconds: z.number().nonnegative(),
            endSeconds: z.number().nonnegative(),
          })
          .strict(),
      )
      .min(1)
      .max(10_000),
  })
  .strict()
  .superRefine((value, ctx) => {
    const duration =
      (Date.parse(value.endedAt) - Date.parse(value.startedAt)) / 1000;
    if (duration <= 0)
      ctx.addIssue({
        code: "custom",
        message: "Conversation must end after it starts.",
      });
    const ids = new Set<string>();
    value.segments.forEach((segment, index) => {
      if (
        ids.has(segment.id) ||
        segment.endSeconds < segment.startSeconds ||
        segment.endSeconds > duration ||
        (index > 0 &&
          segment.startSeconds < value.segments[index - 1].startSeconds)
      ) {
        ctx.addIssue({
          code: "custom",
          path: ["segments", index],
          message:
            "Segments need unique IDs, ordered timestamps, and must fit the conversation.",
        });
      }
      ids.add(segment.id);
    });
  });
export type ConversationInput = z.infer<typeof conversationInputSchema>;

export function isConversation(meeting: Meeting) {
  return Boolean(
    meeting.insight ||
      meeting.transcript?.length ||
      ["hardware", "agora", "upload"].includes(meeting.source),
  );
}

export function getApprovals(meetings: Meeting[]): MeetingApproval[] {
  return meetings.flatMap((meeting) =>
    (meeting.followUps || [])
      .filter(
        (followUp) =>
          followUp.type === "schedule" &&
          followUp.schedule?.agreement !== "tentative",
      )
      .map((followUp) => ({
        id: followUp.id,
        conversationId: meeting.id,
        title: followUp.description,
        contact:
          meeting.contacts.find(
            (contact) => contact.id === followUp.contactId,
          ) ||
          meeting.contacts[0] ||
          null,
        details: followUp.schedule || {
          agreement: "agreed" as const,
          // Legacy task deadlines may have been normalized to 17:00. They are
          // not evidence that a meeting time was agreed in the conversation.
          startAt: null,
          durationMinutes: null,
          attendees: [],
          location: null,
          evidence: null,
        },
        status:
          followUp.status === "completed"
            ? ("completed" as const)
            : followUp.status === "dismissed"
              ? ("dismissed" as const)
              : ("pending" as const),
      })),
  );
}

export function missingApprovalDetails(details: ScheduleDetails): string[] {
  const missing: string[] = [];
  if (!details.startAt || !Number.isFinite(Date.parse(details.startAt)))
    missing.push("date and time");
  if (!details.durationMinutes) missing.push("duration");
  if (!details.attendees.length) missing.push("attendee email");
  return missing;
}

export function sourceConversation(
  meetings: Meeting[],
  meeting: Meeting,
): Meeting | undefined {
  return meeting.sourceConversationId
    ? meetings.find((entry) => entry.id === meeting.sourceConversationId)
    : isConversation(meeting)
      ? meeting
      : undefined;
}

export function updateApproval(
  meetings: Meeting[],
  approvalId: string,
  changes: {
    status?: "pending" | "completed" | "dismissed";
    schedule?: ScheduleDetails;
  },
): Meeting[] {
  return meetings.map((meeting) => ({
    ...meeting,
    followUps: meeting.followUps?.map((followUp) =>
      followUp.id === approvalId ? { ...followUp, ...changes } : followUp,
    ),
  }));
}

/** Pure sample adapter. It has no network dependency and cannot create invitations. */
export function approveSample(
  meetings: Meeting[],
  approval: MeetingApproval,
  now = new Date(),
): Meeting[] {
  if (
    !approval.id.startsWith("sample:") ||
    !approval.conversationId.startsWith("sample:") ||
    meetings.some((meeting) => !meeting.id.startsWith("sample:"))
  )
    throw new Error("Sample actions require a sample workspace.");
  const details = scheduleDetailsSchema.parse(approval.details);
  if (details.agreement !== "agreed" || missingApprovalDetails(details).length)
    throw new Error("Complete the meeting details before approval.");
  const eventId = `sample:event:${approval.id}`;
  if (meetings.some((meeting) => meeting.id === eventId)) return meetings;
  if (Date.parse(details.startAt!) <= now.getTime())
    throw new Error("Choose a future meeting time.");
  const conversation = meetings.find(
    (meeting) => meeting.id === approval.conversationId,
  );
  if (
    !conversation ||
    !conversation.followUps?.some(
      (item) =>
        item.id === approval.id &&
        item.status !== "dismissed" &&
        item.status !== "completed",
    )
  )
    throw new Error("This approval is no longer pending.");
  return [
    ...updateApproval(meetings, approval.id, {
      status: "completed",
      schedule: details,
    }),
    {
      id: eventId,
      title: approval.title,
      startAt: details.startAt!,
      endAt: new Date(
        Date.parse(details.startAt!) + details.durationMinutes! * 60_000,
      ).toISOString(),
      status: "upcoming",
      source: "calendar",
      contacts: conversation.contacts,
      sourceConversationId: conversation.id,
      sourceApprovalId: approval.id,
    },
  ];
}

export function liveApprovalRequest(
  approval: MeetingApproval,
  now = new Date(),
) {
  if (
    approval.id.startsWith("sample:") ||
    approval.conversationId.startsWith("sample:")
  )
    throw new Error("Sample approvals cannot be sent to Google Calendar.");
  const details = scheduleDetailsSchema.parse(approval.details);
  if (details.agreement !== "agreed" || missingApprovalDetails(details).length)
    throw new Error("Complete the meeting details before approval.");
  if (Date.parse(details.startAt!) <= now.getTime())
    throw new Error(
      "This meeting time has passed. Update the date before approving.",
    );
  return {
    approved: true,
    summary: approval.title,
    startAt: new Date(details.startAt!).toISOString(),
    durationMinutes: details.durationMinutes!,
    attendees: details.attendees,
    ...(details.location ? { location: details.location } : {}),
    meetingId: approval.conversationId,
    followUpId: approval.id,
    idempotencyKey: `approval:${approval.id}`,
  };
}
