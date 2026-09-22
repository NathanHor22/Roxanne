import { localDateKey } from "./device-briefing";
import { validTimezone } from "./quipus-profile";

export type ReportDepth = "quick" | "full" | "actions";
export interface ReportRequest {
  action: "query" | "continue" | "repeat" | "next" | "stop" | "unknown";
  date?: string;
  ordinal?: number;
  minute?: number;
  person?: string;
  depth?: ReportDepth;
}
const ordinals: Record<string, number> = { first: 1, second: 2, third: 3, fourth: 4, fifth: 5, sixth: 6, seventh: 7, eighth: 8, ninth: 9, tenth: 10 };
const weekdays = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];
const hourWords: Record<string, number> = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12 };

export function shiftDate(date: string, days: number): string {
  const instant = new Date(`${date}T12:00:00Z`);
  instant.setUTCDate(instant.getUTCDate() + days);
  return instant.toISOString().slice(0, 10);
}
export function isReportDate(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(value)) && new Date(`${value}T12:00:00Z`).toISOString().slice(0, 10) === value;
}
/** Narrow report controls. This parser never creates or approves an action. */
export function parseReportRequest(text: string, timezone: string, now = new Date()): ReportRequest {
  const command = text.toLowerCase().replace(/[’]/g, "'").replace(/\ba\.?m\.?\b/g, "am").replace(/\bp\.?m\.?\b/g, "pm").replace(/\s+/g, " ").trim();
  if (/^(?:(?:computer|quipus)[, ]+)?(?:stop|cancel|never mind|nevermind|that's all|thanks|thank you)[.!]?$/i.test(command)) return { action: "stop" };
  if (/\b(?:continue|resume)(?: my| the)?(?: daily| day| full)? report\b|^(?:continue|resume)[.!]?$/i.test(command)) return { action: "continue" };
  if (/\b(?:repeat that|say that again|repeat report)\b|^repeat[.!]?$/i.test(command)) return { action: "repeat" };
  if (/\bnext (?:meeting|conversation)\b/i.test(command)) return { action: "next" };
  const today = localDateKey(now, validTimezone(timezone));
  const request: ReportRequest = { action: "query" };
  const explicit = command.match(/\b(\d{4}-\d{2}-\d{2})\b/);
  if (explicit) {
    if (!isReportDate(explicit[1])) return { action: "unknown" };
    request.date = explicit[1];
  } else if (/\bday before yesterday\b/.test(command)) request.date = shiftDate(today, -2);
  else if (/\b(?:yesterday|previous day|semalam)\b/.test(command)) request.date = shiftDate(today, -1);
  else if (/\b(?:today|hari ini)\b/.test(command)) request.date = today;
  else {
    const weekday = command.match(/\blast (sunday|monday|tuesday|wednesday|thursday|friday|saturday)\b/);
    if (weekday) {
      const dow = new Date(`${today}T12:00:00Z`).getUTCDay();
      request.date = shiftDate(today, -((dow - weekdays.indexOf(weekday[1]) + 7) % 7 || 7));
    }
  }
  const ordinal = command.match(/\b(first|second|third|fourth|fifth|sixth|seventh|eighth|ninth|tenth|\d+(?:st|nd|rd|th)) (?:meeting|conversation)\b/)
    || command.match(/\b(?:meeting|conversation)(?: number)? (\d+|one|two|three|four|five|six|seven|eight|nine|ten)\b/)
    || command.match(/^(?:the )?(first|second|third|fourth|fifth|sixth|seventh|eighth|ninth|tenth)(?: one)?[.!]?$/);
  if (ordinal) request.ordinal = ordinals[ordinal[1]] || hourWords[ordinal[1]] || parseInt(ordinal[1], 10);
  const clock = command.match(/\b(\d{1,2}|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve)(?::(\d{2}))?\s*(am|pm)\b/);
  if (clock) {
    const hour = hourWords[clock[1]] || Number(clock[1]);
    const minute = Number(clock[2] || 0);
    if (hour < 1 || hour > 12 || minute > 59) return { action: "unknown" };
    request.minute = (hour % 12 + (clock[3] === "pm" ? 12 : 0)) * 60 + minute;
  }
  const person = command.match(/\b(?:meeting|conversation)(?: i had)? with (.+?)(?:[?.!]|$)/)
    || command.match(/\bwhat did (.+?) (?:ask|want|say|need|promise|discuss)\b/);
  if (person) request.person = person[1].replace(/\b(?:today|yesterday|last (?:monday|tuesday|wednesday|thursday|friday|saturday|sunday))\b/g, "").trim().slice(0, 100);
  if (/\b(?:action items?|actions only|just the actions|follow[ -]?ups?)\b/.test(command)) request.depth = "actions";
  else if (/\b(?:full|detailed|breakdown|detail)\b/.test(command)) request.depth = "full";
  else if (/\b(?:quick|overview|brief|short|summary)\b/.test(command)) request.depth = "quick";
  if (!request.date && !request.ordinal && request.minute === undefined && !request.person && !request.depth && !/\b(?:status|report|meetings|laporan)\b/.test(command)) return { action: "unknown" };
  return request;
}

export interface SelectableMeeting { id: string; title: string; startAt: string; person?: string; }
export function selectReportMeetings<T extends SelectableMeeting>(meetings: T[], request: ReportRequest, timezone: string): T[] {
  if (request.ordinal !== undefined) return request.ordinal > 0 && request.ordinal <= meetings.length ? [meetings[request.ordinal - 1]] : [];
  return meetings.filter(meeting => {
    if (request.person) {
      const needle = request.person.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
      const haystack = `${meeting.person || ""} ${meeting.title}`.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ");
      if (!needle || !haystack.includes(needle)) return false;
    }
    if (request.minute !== undefined) {
      const time = new Intl.DateTimeFormat("en-GB", { timeZone: validTimezone(timezone), hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(new Date(meeting.startAt));
      const [hour, minute] = time.split(":").map(Number);
      if (hour * 60 + minute !== request.minute) return false;
    }
    return true;
  });
}
