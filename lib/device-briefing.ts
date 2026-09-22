export interface DeviceMeetingBrief {
  title: string;
  keyPoints: string[];
  intent?: string | null;
  nextAction?: string | null;
  wants?: string | null;
  concern?: string | null;
  promised?: string | null;
  commitments?: string[];
}
export interface DeviceStatusBriefing {
  ownerName: string;
  meetings: DeviceMeetingBrief[];
  pendingApprovals: number;
}
function cleanSpeech(value: string, maximum = Infinity) {
  return value.replace(/\s*(?:\u00c2)?\u00b7\s*/gu, ", ").replace(/\s+/gu, " ").trim().slice(0, maximum);
}
export function ownerSpokenName(name: string | null, email: string | null) {
  return cleanSpeech(name || "", 80) || cleanSpeech(email?.split("@")[0]?.replace(/[._-]+/gu, " ") || "", 80) || "Quipus user";
}
export function buildBootBriefing(input: { ownerName: string; batteryLevel: number | null }) {
  const name = cleanSpeech(input.ownerName, 80).split(" ")[0];
  return `Quipus ready${name && name !== "Quipus" ? `, ${name}` : ""}. Say Computer for a command, or tap or press to record.`;
}
export function buildStatusBriefing(input: DeviceStatusBriefing) {
  const parts = [`Status report for ${cleanSpeech(input.ownerName, 80)}.`, input.meetings.length
    ? `Today you recorded ${input.meetings.length} conversation${input.meetings.length === 1 ? "" : "s"}.`
    : "You have no recorded conversations today."];
  input.meetings.forEach((meeting, index) => {
    parts.push(`Meeting ${index + 1}. ${cleanSpeech(meeting.title)}.`);
    parts.push(...meetingReportDetails(meeting));
  });
  parts.push("Status report complete.");
  parts.push(input.pendingApprovals > 0
    ? `I found ${input.pendingApprovals} pending action item${input.pendingApprovals === 1 ? "" : "s"}. Would you like to review them? Say yes or no. Each invitation needs your approval before it is sent.`
    : "No action items are waiting.");
  return parts.join(" ");
}
export function meetingReportDetails(meeting: DeviceMeetingBrief): string[] {
    const details = [meeting.intent, ...meeting.keyPoints,
      meeting.wants && `They need: ${meeting.wants}`,
      meeting.concern && `Concerns: ${meeting.concern}`,
      meeting.promised && `Promises: ${meeting.promised}`,
      ...(meeting.commitments || []).map(c => `Commitment: ${c}`),
      meeting.nextAction && `Next step: ${meeting.nextAction}`];
    const seen = new Set<string>();
    const parts: string[] = [];
    for (const detail of details) {
      if (!detail) continue;
      const text = cleanSpeech(detail);
      if (text && !seen.has(text)) { parts.push(text); seen.add(text); }
    }
    return parts;
}
/** Preserve every word; each request stays comfortably below the TTS limit. */
export function splitSpeechPages(text: string, maximum = 650): string[] {
  if (!Number.isInteger(maximum) || maximum < 80 || maximum > 4000) throw new Error("Invalid speech page size.");
  let remaining = text.trim();
  const pages: string[] = [];
  while (remaining.length > maximum) {
    const prefix = remaining.slice(0, maximum);
    let end = Math.max(prefix.lastIndexOf(". "), prefix.lastIndexOf("? "), prefix.lastIndexOf("! "));
    if (end < maximum / 2) end = prefix.lastIndexOf(" ");
    else end += 1;
    if (end < 1) end = maximum;
    pages.push(remaining.slice(0, end));
    remaining = remaining.slice(end).trimStart();
  }
  if (remaining) pages.push(remaining);
  return pages;
}
export function localDateKey(value: Date | string, timeZone: string) {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(value instanceof Date ? value : new Date(value));
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find(item => item.type === type)?.value || "";
  return `${part("year")}-${part("month")}-${part("day")}`;
}
