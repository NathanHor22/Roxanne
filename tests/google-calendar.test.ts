import assert from "node:assert/strict";
import test from "node:test";

import type { SupabaseClient } from "@supabase/supabase-js";

import {
  GOOGLE_CALENDAR_SCOPE,
  GOOGLE_CALENDAR_FREEBUSY_SCOPE,
  type CalendarFreeBusyClient,
  type CalendarInsertClient,
  createGoogleAuthorizationUrl,
  createGoogleCalendarEvent,
  createGoogleOAuthState,
  decryptGoogleCredentials,
  encryptGoogleCredentials,
  getGoogleCalendarAvailability,
  loadPersistedGoogleCredentials,
  persistGoogleCredentials,
  readGoogleOAuthState,
  sanitizeGoogleReturnTo,
} from "../lib/providers/google-calendar";

const SECRET = "test-only-approval-secret-at-least-32-bytes";
const USER_ID = "11111111-1111-4111-8111-111111111111";

test("Google credentials are AES-GCM encrypted before mocked Supabase persistence", async () => {
  let stored: Record<string, unknown> | null = null;
  const query = {
    eq() {
      return this;
    },
    async maybeSingle() {
      return {
        data: stored
          ? { encrypted_credentials: stored.encrypted_credentials }
          : null,
        error: null,
      };
    },
  };
  const mockedSupabase = {
    from(table: string) {
      assert.equal(table, "provider_connections");
      return {
        select() {
          return query;
        },
        async upsert(value: Record<string, unknown>) {
          stored = value;
          return { error: null };
        },
      };
    },
  } as unknown as SupabaseClient;

  await persistGoogleCredentials(
    mockedSupabase,
    USER_ID,
    {
      access_token: "access-super-secret",
      refresh_token: "refresh-super-secret",
      scope: GOOGLE_CALENDAR_SCOPE,
      expiry_date: Date.parse("2026-08-23T12:00:00Z"),
    },
    SECRET,
  );

  const saved = stored as Record<string, unknown> | null;
  assert.ok(saved);
  const encrypted = String(saved.encrypted_credentials);
  assert.match(encrypted, /^v1\./u);
  assert.doesNotMatch(encrypted, /refresh-super-secret|access-super-secret/u);
  assert.deepEqual(saved.scopes, [GOOGLE_CALENDAR_SCOPE]);

  const loaded = await loadPersistedGoogleCredentials(
    mockedSupabase,
    USER_ID,
    SECRET,
  );
  assert.equal(loaded?.refresh_token, "refresh-super-secret");
});

test("AES-GCM rejects ciphertext tampering and never leaks the token", () => {
  const encrypted = encryptGoogleCredentials(
    { refresh_token: "sensitive-refresh-token" },
    SECRET,
  );
  const parts = encrypted.split(".");
  parts[3] = `${parts[3][0] === "A" ? "B" : "A"}${parts[3].slice(1)}`;
  const tampered = parts.join(".");
  assert.throws(
    () => decryptGoogleCredentials(tampered, SECRET),
    (error: unknown) => {
      assert.ok(error instanceof Error);
      assert.doesNotMatch(error.message, /sensitive-refresh-token/u);
      return true;
    },
  );
});

test("OAuth state is encrypted, time-limited, and cannot carry an open redirect", () => {
  const now = Date.parse("2026-08-23T10:00:00Z");
  const state = createGoogleOAuthState(
    { userId: USER_ID, returnTo: "https://evil.example/steal" },
    SECRET,
    now,
  );

  assert.doesNotMatch(state, /evil\.example|11111111/u);
  const parsed = readGoogleOAuthState(state, SECRET, now + 9 * 60_000);
  assert.equal(parsed.userId, USER_ID);
  assert.equal(parsed.returnTo, "/");
  assert.throws(() => readGoogleOAuthState(state, SECRET, now + 11 * 60_000));
  assert.equal(sanitizeGoogleReturnTo("/settings?tab=integrations"), "/settings?tab=integrations");
  assert.equal(sanitizeGoogleReturnTo("//evil.example/steal"), "/");
});

test("OAuth authorization URL requests event and free-busy access without exposing the client secret", () => {
  const authorizationUrl = createGoogleAuthorizationUrl("opaque-state", {
    config: {
      clientId: "client-id.apps.googleusercontent.com",
      clientSecret: "never-put-this-in-the-url",
      redirectUri: "https://lantern.example/api/google/callback",
      calendarId: "primary",
    },
    loginHint: "nathanhor2001@gmail.com",
  });
  const parsed = new URL(authorizationUrl);

  assert.equal(parsed.origin, "https://accounts.google.com");
  assert.equal(parsed.searchParams.get("access_type"), "offline");
  assert.equal(parsed.searchParams.get("state"), "opaque-state");
  assert.match(parsed.searchParams.get("scope") ?? "", new RegExp(GOOGLE_CALENDAR_SCOPE, "u"));
  assert.match(parsed.searchParams.get("scope") ?? "", new RegExp(GOOGLE_CALENDAR_FREEBUSY_SCOPE, "u"));
  assert.doesNotMatch(parsed.searchParams.get("scope") ?? "", /gmail\.send/u);
  assert.doesNotMatch(authorizationUrl, /never-put-this-in-the-url/u);
});

test("approved invitation uses only validated recipients and exactly 30 Malaysia minutes", async () => {
  let inserted: Parameters<CalendarInsertClient["events"]["insert"]>[0] | undefined;
  const mockedCalendar: CalendarInsertClient = {
    events: {
      async insert(parameters) {
        inserted = parameters;
        return {
          data: {
            id: "google-event-123",
            htmlLink: "https://calendar.google.com/event?eid=123",
          },
        };
      },
    },
  };

  const result = await createGoogleCalendarEvent(
    {
      approved: true,
      summary: "Acme product demo",
      startAt: "2026-08-27T10:15",
      attendees: [" NathanHor2001@GMAIL.com ", "client@example.com"],
      meetingId: "meeting-james-acme-2026-08-23",
      description: "Review the ERP integration.",
      conferenceUrl: "https://lantern.example/room/acme",
    },
    { calendar: mockedCalendar, calendarId: "primary", eventId: "a1b2c3d4e5" },
  );

  assert.ok(inserted);
  assert.equal(inserted.calendarId, "primary");
  assert.equal(inserted.sendUpdates, "all");
  assert.equal(inserted.requestBody.id, "a1b2c3d4e5");
  assert.deepEqual(inserted.requestBody.start, {
    dateTime: "2026-08-27T10:15:00+08:00",
    timeZone: "Asia/Kuala_Lumpur",
  });
  assert.deepEqual(inserted.requestBody.end, {
    dateTime: "2026-08-27T10:45:00+08:00",
    timeZone: "Asia/Kuala_Lumpur",
  });
  assert.deepEqual(inserted.requestBody.attendees, [
    { email: "nathanhor2001@gmail.com" },
    { email: "client@example.com" },
  ]);
  assert.equal(result.endAt, "2026-08-27T10:45:00+08:00");
  assert.deepEqual(result.attendees, [
    "nathanhor2001@gmail.com",
    "client@example.com",
  ]);
});

test("a deterministic Google event ID recovers an ambiguous already-created retry", async () => {
  const mockedCalendar: CalendarInsertClient = {
    events: {
      async insert() {
        const error = new Error("already exists") as Error & { response: { status: number } };
        error.response = { status: 409 };
        throw error;
      },
    },
  };

  const result = await createGoogleCalendarEvent(
    {
      approved: true,
      summary: "Recovered client invite",
      startAt: "2026-08-27T15:30+08:00",
      attendees: ["client@example.com"],
    },
    { calendar: mockedCalendar, eventId: "abcdef0123456789" },
  );

  assert.equal(result.id, "abcdef0123456789");
  assert.equal(result.startAt, "2026-08-27T15:30:00+08:00");
  assert.equal(result.htmlLink, null);
});

test("mocked Google free/busy returns only open 30-minute afternoon slots", async () => {
  let requested: Parameters<CalendarFreeBusyClient["freebusy"]["query"]>[0] | undefined;
  const mockedCalendar: CalendarFreeBusyClient = {
    freebusy: {
      async query(parameters) {
        requested = parameters;
        return {
          data: {
            calendars: {
              primary: {
                busy: [
                  {
                    start: "2026-08-27T13:00:00+08:00",
                    end: "2026-08-27T14:00:00+08:00",
                  },
                  {
                    start: "2026-08-27T16:15:00+08:00",
                    end: "2026-08-27T16:45:00+08:00",
                  },
                ],
              },
            },
          },
        };
      },
    },
  };

  const availability = await getGoogleCalendarAvailability(
    { date: "2026-08-27", period: "afternoon" },
    { calendar: mockedCalendar },
  );

  assert.ok(requested);
  assert.deepEqual(requested.requestBody, {
    timeMin: "2026-08-27T12:00:00+08:00",
    timeMax: "2026-08-27T18:00:00+08:00",
    timeZone: "Asia/Kuala_Lumpur",
    items: [{ id: "primary" }],
  });
  assert.equal(availability.durationMinutes, 30);
  assert.equal(availability.slots.length, 8);
  assert.equal(availability.slots[0]?.startAt, "2026-08-27T12:00:00+08:00");
  assert.ok(
    availability.slots.every(
      (slot) =>
        !["13:00", "13:30", "16:00", "16:30"].some((time) =>
          slot.startAt.includes(`T${time}:00`),
        ),
    ),
  );
});

test("missing approval and unsafe recipient input never call the mocked Calendar client", async () => {
  let calls = 0;
  const mockedCalendar: CalendarInsertClient = {
    events: {
      async insert() {
        calls += 1;
        return { data: { id: "must-not-exist" } };
      },
    },
  };
  const base = {
    summary: "Client meeting",
    startAt: "2026-08-27T10:15+08:00",
    attendees: ["nathanhor2001@gmail.com"],
  };

  await assert.rejects(() =>
    createGoogleCalendarEvent(
      { ...base, approved: false },
      { calendar: mockedCalendar },
    ),
  );
  await assert.rejects(() =>
    createGoogleCalendarEvent(
      { ...base, approved: true, attendees: ["victim@example.com\r\nBcc: attacker@example.com"] },
      { calendar: mockedCalendar },
    ),
  );
  await assert.rejects(() =>
    createGoogleCalendarEvent(
      {
        ...base,
        approved: true,
        attendees: ["NATHANHOR2001@gmail.com", "nathanhor2001@gmail.com"],
      },
      { calendar: mockedCalendar },
    ),
  );
  assert.equal(calls, 0);
});

test("approved calendar invitations preserve the reviewed 45- or 60-minute duration across midnight", async () => {
  for (const durationMinutes of [45, 60]) {
    let inserted: Parameters<CalendarInsertClient["events"]["insert"]>[0] | undefined;
    const calendar: CalendarInsertClient = {
      events: {
        async insert(parameters) {
          inserted = parameters;
          return { data: { id: `duration-${durationMinutes}` } };
        },
      },
    };
    const result = await createGoogleCalendarEvent({
      approved: true,
      summary: "Client follow-up",
      startAt: "2026-09-10T23:30:00+08:00",
      durationMinutes,
      attendees: ["chung@example.com"],
    }, { calendar });

    assert.ok(inserted);
    assert.equal(Date.parse(result.endAt) - Date.parse(result.startAt), durationMinutes * 60_000);
    assert.equal(inserted.requestBody.end?.timeZone, "Asia/Kuala_Lumpur");
    assert.match(result.endAt, /^2026-09-11T00:(?:15|30):00\+08:00$/u);
  }
});

test("invalid meeting durations never call Google Calendar", async () => {
  let calls = 0;
  const calendar: CalendarInsertClient = {
    events: {
      async insert() {
        calls += 1;
        return { data: { id: "must-not-exist" } };
      },
    },
  };
  for (const durationMinutes of [0, 4, 481, 45.5, -30, NaN]) {
    await assert.rejects(() => createGoogleCalendarEvent({
      approved: true,
      summary: "Client follow-up",
      startAt: "2026-09-10T13:00:00+08:00",
      durationMinutes,
      attendees: ["chung@example.com"],
    }, { calendar }));
  }
  assert.equal(calls, 0);
});
