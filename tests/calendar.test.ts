import assert from "node:assert/strict";
import test from "node:test";

import {
  formatCompactDate,
  formatCompactTime,
  formatDateKey,
  formatMonthTitle,
  formatWeekdayLabels,
  getCalendarWeeks,
  getMeetingState,
  getMeetingVisualState,
  getMeetingsForDay,
  getMonthGrid,
  getOpenFollowUps,
  isFollowUpOverdue,
} from "../lib/calendar";
import {
  DEMO_IDS,
  DEMO_NOW,
  demoContacts,
  demoFollowUps,
  demoMeetings,
  jamesMeeting,
} from "../lib/demo-data";

test("August 2026 renders as exactly six Monday-start weeks", () => {
  const days = getMonthGrid("2026-08", { today: "2026-08-23" });

  assert.equal(days.length, 42);
  assert.equal(days[0].isoDate, "2026-07-27");
  assert.equal(days[0].date.getUTCDay(), 1);
  assert.equal(days[41].isoDate, "2026-09-06");
  assert.equal(days[41].date.getUTCDay(), 0);
  assert.equal(days.filter((day) => day.inCurrentMonth).length, 31);
  assert.equal(days.find((day) => day.isToday)?.isoDate, "2026-08-23");

  const weeks = getCalendarWeeks("2026-08", { today: "2026-08-23" });
  assert.equal(weeks.length, 6);
  assert.ok(weeks.every((week) => week.length === 7));
});

test("month selection and day keys respect Asia/Kuala_Lumpur", () => {
  const instant = new Date("2026-08-31T16:30:00.000Z");
  const days = getMonthGrid(instant, { timeZone: "Asia/Kuala_Lumpur" });

  assert.equal(days.find((day) => day.inCurrentMonth)?.isoDate, "2026-09-01");
  assert.equal(formatDateKey(instant, "Asia/Kuala_Lumpur"), "2026-09-01");
  assert.equal(formatDateKey(instant, "UTC"), "2026-08-31");
});

test("formatters produce compact Malaysian calendar labels", () => {
  const instant = "2026-08-23T06:00:00.000Z";

  assert.equal(formatCompactTime(instant), "14:00");
  assert.equal(formatCompactDate(instant), "23 Aug");
  assert.equal(formatMonthTitle("2026-08"), "August 2026");
  assert.deepEqual(formatWeekdayLabels("en"), ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]);
  assert.equal(formatWeekdayLabels("ms")[0].toLocaleLowerCase("ms-MY"), "isn");
});

test("meetings are selected by local day and sorted by start time", () => {
  const meetings = getMeetingsForDay(demoMeetings, "2026-08-23");

  assert.deepEqual(
    meetings.map((meeting) => meeting.id),
    [DEMO_IDS.meetings.james, DEMO_IDS.meetings.processing],
  );
});

test("overdue checks ignore completed work and do not mark the exact due instant late", () => {
  const overdue = demoFollowUps.find(
    (followUp) => followUp.id === DEMO_IDS.followUps.amirRequirements,
  )!;
  const completed = demoFollowUps.find(
    (followUp) => followUp.id === DEMO_IDS.followUps.sarahThanks,
  )!;

  assert.equal(isFollowUpOverdue(overdue, DEMO_NOW), true);
  assert.equal(isFollowUpOverdue(overdue, overdue.dueAt!), false);
  assert.equal(isFollowUpOverdue(completed, DEMO_NOW), false);
});

test("meeting state prioritises processing, overdue, and required follow-ups", () => {
  const amir = demoMeetings.find((meeting) => meeting.id === DEMO_IDS.meetings.amir)!;
  const processing = demoMeetings.find(
    (meeting) => meeting.id === DEMO_IDS.meetings.processing,
  )!;

  assert.equal(getMeetingVisualState(amir, DEMO_NOW), "overdue");
  assert.equal(getMeetingVisualState(jamesMeeting, DEMO_NOW), "follow-up-required");
  assert.equal(getMeetingVisualState(processing, DEMO_NOW), "processing");

  const jamesState = getMeetingState(jamesMeeting, DEMO_NOW);
  assert.equal(jamesState.isCompleted, true);
  assert.equal(jamesState.hasRecording, true);
  assert.equal(jamesState.followUpRequired, true);
});

test("open follow-ups are ordered by due date with undated work last", () => {
  const undated = {
    ...demoFollowUps[0],
    id: "follow-up-undated",
    dueAt: null,
  };
  const ordered = getOpenFollowUps([...demoFollowUps, undated]);

  assert.equal(ordered[0].id, DEMO_IDS.followUps.amirRequirements);
  assert.equal(ordered.at(-1)?.id, "follow-up-undated");
  assert.ok(ordered.every((followUp) => followUp.status !== "completed"));
});

test("seeded data keeps references coherent and the James golden path complete", () => {
  const contactIds = new Set(demoContacts.map((contact) => contact.id));
  const meetingIds = new Set(demoMeetings.map((meeting) => meeting.id));

  assert.ok(demoMeetings.every((meeting) => meeting.contacts.every((item) => contactIds.has(item.id))));
  assert.ok(demoFollowUps.every((followUp) => meetingIds.has(followUp.meetingId)));
  assert.equal(jamesMeeting.contacts[0].company, "Acme Manufacturing");
  assert.equal(jamesMeeting.insight?.wants, "Pilot");
  assert.equal(jamesMeeting.insight?.concern, "ERP integration");
  assert.equal(jamesMeeting.insight?.promised, "Pricing Friday");
  assert.equal(jamesMeeting.insight?.next, "Demo next Thursday");
});
