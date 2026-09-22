/** Shared display conventions; never mistake an email address for a chosen name. */
export function firstName(name?: string | null): string {
  return (name || "").trim().split(/\s+/u)[0] || "";
}

export function validTimezone(value: unknown): string {
  if (typeof value === "string") {
    try { new Intl.DateTimeFormat("en", { timeZone: value }).format(); return value; }
    catch { /* Unknown profile timezone uses the established Malaysia default. */ }
  }
  return "Asia/Kuala_Lumpur";
}

export function personalGreeting(name: string | null | undefined, date: Date, timezone: string): string {
  const hour = Number(new Intl.DateTimeFormat("en-GB", {
    hour: "numeric", hourCycle: "h23", timeZone: validTimezone(timezone),
  }).format(date));
  const greeting = hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening";
  const given = firstName(name);
  return `${greeting}${given ? `, ${given}` : ""}.`;
}
