import { formatDateKey } from "./calendar";
import { validTimezone } from "./quipus-profile";

export function workspaceTime(timezone: string) {
  const timeZone = validTimezone(timezone);
  return {
    timezone: timeZone,
    dateKey: (value: string | Date) => formatDateKey(value, timeZone),
    dateLabel: (value: string, options: Intl.DateTimeFormatOptions = {}) =>
      new Intl.DateTimeFormat("en-MY", { timeZone, day: "numeric", month: "short", ...options }).format(new Date(value)),
    timeLabel: (value: string) => new Intl.DateTimeFormat("en-MY", {
      timeZone, hour: "numeric", minute: "2-digit", hour12: true,
    }).format(new Date(value)),
  };
}

/** datetime-local values have no offset; derive their fields in an explicit zone. */
export function localDateTime(value: string | number, timeZone: string): string {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23",
  }).formatToParts(new Date(value));
  const field = (name: string) => parts.find(part => part.type === name)!.value;
  return `${field("year")}-${field("month")}-${field("day")}T${field("hour")}:${field("minute")}`;
}

/** Reject skipped/repeated DST times rather than silently sending the wrong time. */
export function localDateTimeToIso(value: string, timeZone: string): string {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value)) throw new Error("Choose a valid date and time.");
  const nominal = Date.parse(`${value}:00Z`);
  if (!Number.isFinite(nominal) || new Date(nominal).toISOString().slice(0, 16) !== value) throw new Error("Choose a valid date and time.");
  const offsets = new Set<number>();
  // Sample either side of a clock change, then verify each possible instant.
  for (const hours of [-36, -12, 0, 12, 36]) {
    const sample = nominal + hours * 3600000;
    offsets.add(Date.parse(`${localDateTime(sample, timeZone)}:00Z`) - sample);
  }
  const matches = [...offsets].map(offset => nominal - offset).filter(candidate => localDateTime(candidate, timeZone) === value);
  if (!matches.length) throw new Error("That local time is skipped by a clock change. Choose another time.");
  if (matches.length > 1) throw new Error("That local time occurs twice during a clock change. Choose a time outside that hour.");
  return new Date(matches[0]).toISOString();
}
