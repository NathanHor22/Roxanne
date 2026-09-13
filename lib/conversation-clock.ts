export interface ConversationClock {
  startedAt: string;
  timeZone: string;
  localDate: string;
  localTime: string;
  localDateTime: string;
}

function partsAt(instant: Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(instant);
  return Object.fromEntries(parts.map((part) => [part.type, part.value]));
}

/**
 * Builds an explicit local clock from a server timestamp. The device clock is
 * deliberately not trusted when the extraction model resolves phrases such as "tomorrow".
 */
export function conversationClock(
  startedAt: string | Date,
  timeZone = "Asia/Kuala_Lumpur",
): ConversationClock {
  const instant = startedAt instanceof Date ? startedAt : new Date(startedAt);
  if (!Number.isFinite(instant.getTime())) {
    throw new Error("Conversation start time is invalid.");
  }
  // Throws RangeError for an unknown IANA time zone.
  const parts = partsAt(instant, timeZone);
  const localDate = `${parts.year}-${parts.month}-${parts.day}`;
  const localTime = `${parts.hour}:${parts.minute}:${parts.second}`;
  const localDateTime = new Intl.DateTimeFormat("en-MY", {
    timeZone,
    dateStyle: "full",
    timeStyle: "long",
  }).format(instant);
  return {
    startedAt: instant.toISOString(),
    timeZone,
    localDate,
    localTime,
    localDateTime,
  };
}
