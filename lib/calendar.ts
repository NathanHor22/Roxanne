import type { FollowUp, Locale, Meeting } from "./types";

export const DEFAULT_TIME_ZONE = "Asia/Kuala_Lumpur";
export const DEFAULT_LOCALE: Locale = "en";

export const LOCALE_TAGS: Record<Locale, string> = {
  en: "en-MY",
  ms: "ms-MY",
  "zh-CN": "zh-CN",
  yue: "yue-Hant-HK",
  ta: "ta-MY",
};

export interface CalendarDay {
  /** A UTC-midnight anchor. Use `isoDate` for calendar-day comparisons. */
  date: Date;
  isoDate: string;
  dayNumber: number;
  inCurrentMonth: boolean;
  isToday: boolean;
}

export interface MonthGridOptions {
  today?: Date | string | number;
  timeZone?: string;
}

export type MeetingVisualState =
  | "upcoming"
  | "completed"
  | "recording-available"
  | "follow-up-required"
  | "overdue"
  | "no-recording"
  | "processing"
  | "failed";

export interface MeetingState {
  visualState: MeetingVisualState;
  isPast: boolean;
  isUpcoming: boolean;
  isCompleted: boolean;
  hasRecording: boolean;
  followUpRequired: boolean;
  overdue: boolean;
  noRecording: boolean;
}

type DateInput = Date | string | number;

const DATE_KEY_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;
const MONTH_KEY_PATTERN = /^(\d{4})-(\d{2})$/;

function localeTag(locale: Locale | string): string {
  return LOCALE_TAGS[locale as Locale] ?? locale;
}

function validDate(value: DateInput): Date {
  const date = value instanceof Date ? new Date(value.getTime()) : new Date(value);

  if (Number.isNaN(date.getTime())) {
    throw new RangeError(`Invalid date: ${String(value)}`);
  }

  return date;
}

function validDateKey(value: string): string | null {
  const match = DATE_KEY_PATTERN.exec(value);
  if (!match) return null;

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));

  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    throw new RangeError(`Invalid calendar date: ${value}`);
  }

  return value;
}

function dateParts(value: DateInput, timeZone: string): {
  year: number;
  month: number;
  day: number;
} {
  if (typeof value === "string") {
    const dateKey = validDateKey(value);
    if (dateKey) {
      const [year, month, day] = dateKey.split("-").map(Number);
      return { year, month, day };
    }
  }

  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(validDate(value));

  const values = Object.fromEntries(
    parts
      .filter((part) => part.type === "year" || part.type === "month" || part.type === "day")
      .map((part) => [part.type, Number(part.value)]),
  );

  return {
    year: values.year,
    month: values.month,
    day: values.day,
  };
}

function monthParts(value: DateInput, timeZone: string): { year: number; month: number } {
  if (typeof value === "string") {
    const match = MONTH_KEY_PATTERN.exec(value);
    if (match) {
      const year = Number(match[1]);
      const month = Number(match[2]);
      if (month < 1 || month > 12) throw new RangeError(`Invalid calendar month: ${value}`);
      return { year, month };
    }
  }

  const { year, month } = dateParts(value, timeZone);
  return { year, month };
}

function isoDateFromUtc(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/**
 * Returns the local calendar date (`YYYY-MM-DD`) for an instant in a timezone.
 * Date-only strings are preserved, which avoids accidental day shifts in forms.
 */
export function formatDateKey(
  value: DateInput,
  timeZone = DEFAULT_TIME_ZONE,
): string {
  if (typeof value === "string") {
    const dateKey = validDateKey(value);
    if (dateKey) return dateKey;
  }

  const { year, month, day } = dateParts(value, timeZone);
  return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

/** Always returns 42 days (six Monday-start weeks), including adjacent months. */
export function getMonthGrid(
  month: DateInput,
  options: MonthGridOptions = {},
): CalendarDay[] {
  const timeZone = options.timeZone ?? DEFAULT_TIME_ZONE;
  const { year, month: monthNumber } = monthParts(month, timeZone);
  const todayKey = formatDateKey(options.today ?? new Date(), timeZone);
  const firstOfMonth = new Date(Date.UTC(year, monthNumber - 1, 1));
  const mondayOffset = (firstOfMonth.getUTCDay() + 6) % 7;
  const gridStart = Date.UTC(year, monthNumber - 1, 1 - mondayOffset);

  return Array.from({ length: 42 }, (_, index) => {
    const date = new Date(gridStart + index * 86_400_000);
    const isoDate = isoDateFromUtc(date);

    return {
      date,
      isoDate,
      dayNumber: date.getUTCDate(),
      inCurrentMonth:
        date.getUTCFullYear() === year && date.getUTCMonth() === monthNumber - 1,
      isToday: isoDate === todayKey,
    };
  });
}

export function getCalendarWeeks(
  month: DateInput,
  options: MonthGridOptions = {},
): CalendarDay[][] {
  const days = getMonthGrid(month, options);
  return Array.from({ length: 6 }, (_, week) => days.slice(week * 7, week * 7 + 7));
}

export function getMeetingsForDay(
  meetings: readonly Meeting[],
  day: DateInput,
  timeZone = DEFAULT_TIME_ZONE,
): Meeting[] {
  const dayKey = formatDateKey(day, timeZone);

  return meetings
    .filter((meeting) => formatDateKey(meeting.startAt, timeZone) === dayKey)
    .sort((left, right) => Date.parse(left.startAt) - Date.parse(right.startAt));
}

export function sortMeetingsChronologically(meetings: readonly Meeting[]): Meeting[] {
  return [...meetings].sort((left, right) => Date.parse(left.startAt) - Date.parse(right.startAt));
}

export function formatCompactTime(
  value: DateInput,
  locale: Locale | string = DEFAULT_LOCALE,
  timeZone = DEFAULT_TIME_ZONE,
): string {
  return new Intl.DateTimeFormat(localeTag(locale), {
    timeZone,
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(validDate(value));
}

export function formatCompactDate(
  value: DateInput,
  locale: Locale | string = DEFAULT_LOCALE,
  timeZone = DEFAULT_TIME_ZONE,
): string {
  return new Intl.DateTimeFormat(localeTag(locale), {
    timeZone,
    day: "numeric",
    month: "short",
  }).format(validDate(value));
}

export function formatLongDate(
  value: DateInput,
  locale: Locale | string = DEFAULT_LOCALE,
  timeZone = DEFAULT_TIME_ZONE,
): string {
  return new Intl.DateTimeFormat(localeTag(locale), {
    timeZone,
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  }).format(validDate(value));
}

export function formatMonthTitle(
  value: DateInput,
  locale: Locale | string = DEFAULT_LOCALE,
  timeZone = DEFAULT_TIME_ZONE,
): string {
  const { year, month } = monthParts(value, timeZone);
  const anchor = new Date(Date.UTC(year, month - 1, 15, 12));

  return new Intl.DateTimeFormat(localeTag(locale), {
    timeZone: "UTC",
    month: "long",
    year: "numeric",
  }).format(anchor);
}

export function formatWeekdayLabels(
  locale: Locale | string = DEFAULT_LOCALE,
  width: "narrow" | "short" | "long" = "short",
): string[] {
  // 2 August 2021 was a Monday. UTC keeps the sequence stable in every runtime.
  return Array.from({ length: 7 }, (_, index) =>
    new Intl.DateTimeFormat(localeTag(locale), {
      timeZone: "UTC",
      weekday: width,
    }).format(new Date(Date.UTC(2021, 7, 2 + index, 12))),
  );
}

export function isFollowUpOpen(followUp: FollowUp): boolean {
  return followUp.status !== "completed";
}

export function isFollowUpOverdue(
  followUp: FollowUp,
  now: DateInput = new Date(),
): boolean {
  if (!isFollowUpOpen(followUp) || !followUp.dueAt) return false;
  return Date.parse(followUp.dueAt) < validDate(now).getTime();
}

export function hasOverdueFollowUp(
  meeting: Meeting,
  now: DateInput = new Date(),
): boolean {
  return (meeting.followUps ?? []).some((followUp) => isFollowUpOverdue(followUp, now));
}

export function getOpenFollowUps(followUps: readonly FollowUp[]): FollowUp[] {
  return followUps
    .filter(isFollowUpOpen)
    .sort((left, right) => {
      if (!left.dueAt && !right.dueAt) return left.description.localeCompare(right.description);
      if (!left.dueAt) return 1;
      if (!right.dueAt) return -1;
      return Date.parse(left.dueAt) - Date.parse(right.dueAt);
    });
}

export function getMeetingState(
  meeting: Meeting,
  now: DateInput = new Date(),
): MeetingState {
  const nowTime = validDate(now).getTime();
  const isPast = Date.parse(meeting.endAt) < nowTime;
  const hasRecording = Boolean(meeting.recordingId || meeting.recordingUrl);
  const openFollowUps = (meeting.followUps ?? []).filter(isFollowUpOpen);
  const overdue = openFollowUps.some((followUp) => isFollowUpOverdue(followUp, nowTime));
  const followUpRequired = openFollowUps.length > 0;
  const isCompleted = meeting.status === "ready";
  const isUpcoming = meeting.status === "upcoming" && !isPast;
  const noRecording = isPast && !hasRecording;

  let visualState: MeetingVisualState;
  if (meeting.status === "failed") visualState = "failed";
  else if (meeting.status === "processing") visualState = "processing";
  else if (overdue) visualState = "overdue";
  else if (followUpRequired) visualState = "follow-up-required";
  else if (isCompleted && hasRecording) visualState = "recording-available";
  else if (isCompleted) visualState = "completed";
  else if (noRecording) visualState = "no-recording";
  else visualState = "upcoming";

  return {
    visualState,
    isPast,
    isUpcoming,
    isCompleted,
    hasRecording,
    followUpRequired,
    overdue,
    noRecording,
  };
}

export function getMeetingVisualState(
  meeting: Meeting,
  now: DateInput = new Date(),
): MeetingVisualState {
  return getMeetingState(meeting, now).visualState;
}
