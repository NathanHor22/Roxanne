export interface DeviceMeetingBrief {
  title: string;
  keyPoints: string[];
  intent?: string | null;
  nextAction?: string | null;
}

export interface DeviceStatusBriefing {
  ownerName: string;
  meetings: DeviceMeetingBrief[];
  pendingApprovals: number;
}

function cleanSpeech(value: string, maximum = 220) {
  return value
    .replace(/\s*(?:\u00c2)?\u00b7\s*/gu, ", ")
    .replace(/\s+/gu, " ")
    .trim()
    .slice(0, maximum);
}

function plural(count: number, singular: string, pluralForm = `${singular}s`) {
  return count === 1 ? singular : pluralForm;
}

export function ownerSpokenName(name: string | null, email: string | null) {
  const cleanName = cleanSpeech(name || "", 80);
  if (cleanName) return cleanName;
  const localPart = email?.split("@")[0]?.replace(/[._-]+/gu, " ") || "";
  return cleanSpeech(localPart, 80) || "Lantern user";
}

export function buildBootBriefing(input: {
  ownerName: string;
  batteryLevel: number;
}) {
  const battery = Math.max(0, Math.min(100, Math.round(input.batteryLevel)));
  return [
    "Lantern. Sector twenty eight fourteen online.",
    `Battery at ${battery} percent.`,
    `Welcome, ${cleanSpeech(input.ownerName, 80)}.`,
  ].join(" ");
}

export function buildStatusBriefing(input: DeviceStatusBriefing) {
  const meetings = input.meetings.slice(0, 3);
  const parts = [
    `Status report for ${cleanSpeech(input.ownerName, 80)}.`,
    meetings.length
      ? `Today you recorded ${input.meetings.length} ${plural(input.meetings.length, "conversation")}.`
      : "You have no recorded conversations today.",
  ];

  meetings.forEach((meeting, index) => {
    const detail =
      meeting.keyPoints.find((point) => cleanSpeech(point)) ||
      meeting.nextAction ||
      meeting.intent ||
      "The recap is ready in your dashboard.";
    parts.push(
      `${index + 1}. ${cleanSpeech(meeting.title, 120)}. ${cleanSpeech(detail, 240)}`,
    );
  });
  if (input.meetings.length > meetings.length) {
    parts.push(`${input.meetings.length - meetings.length} more are available in the dashboard.`);
  }
  if (input.pendingApprovals > 0) {
    parts.push(
      `${input.pendingApprovals} meeting ${plural(input.pendingApprovals, "approval")} ${
        input.pendingApprovals === 1 ? "is" : "are"
      } waiting in the dashboard. Review it there before an invitation is sent.`,
    );
  } else {
    parts.push("No meeting approvals are waiting.");
  }
  parts.push("Status report complete. Lantern, Sector twenty eight fourteen.");
  return parts.join(" ");
}

export function localDateKey(value: Date | string, timeZone: string) {
  const date = value instanceof Date ? value : new Date(value);
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((item) => item.type === type)?.value || "";
  return `${part("year")}-${part("month")}-${part("day")}`;
}
