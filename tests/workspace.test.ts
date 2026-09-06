import assert from "node:assert/strict";
import test from "node:test";

import {
  approveSample,
  conversationInputSchema,
  getApprovals,
  liveApprovalRequest,
  missingApprovalDetails,
  sourceConversation,
  updateApproval,
  type ConversationInput,
  type MeetingApproval,
} from "../lib/workspace/model";
import {
  createSampleWorkspace,
  readSampleWorkspace,
} from "../lib/workspace/sample";

const NOW = new Date("2026-09-06T04:00:00Z");

function sampleApproval() {
  const workspace = createSampleWorkspace(NOW);
  const approval = getApprovals(workspace.meetings)[0]!;
  return { workspace, approval };
}

function realApproval(): MeetingApproval {
  const { approval } = sampleApproval();
  return {
    ...approval,
    id: "follow-up-chung",
    conversationId: "conversation-chung",
  };
}

test("approving a captured agreement adds one calendar event linked to the original recap after reload", () => {
  const { workspace, approval } = sampleApproval();
  const original = workspace.meetings.find(
    (meeting) => meeting.id === approval.conversationId,
  )!;
  const meetings = approveSample(workspace.meetings, approval, NOW);

  assert.equal(meetings.length, workspace.meetings.length + 1);
  assert.equal(getApprovals(meetings)[0]?.status, "completed");
  assert.equal(getApprovals(workspace.meetings)[0]?.status, "pending");

  const reloaded = readSampleWorkspace(JSON.stringify({ version: 1, meetings }));
  assert.ok(reloaded);
  const event = reloaded.meetings.find(
    (meeting) => meeting.sourceApprovalId === approval.id,
  );
  assert.ok(event);
  assert.equal(event.source, "calendar");
  assert.equal(event.startAt, approval.details.startAt);
  assert.equal(
    Date.parse(event.endAt) - Date.parse(event.startAt),
    45 * 60_000,
  );
  const recap = sourceConversation(reloaded.meetings, event);
  assert.equal(recap?.id, original.id);
  assert.deepEqual(recap?.insight, original.insight);
  assert.deepEqual(recap?.transcript, original.transcript);
  assert.deepEqual(
    recap?.followUps?.filter((item) => item.type !== "schedule"),
    original.followUps?.filter((item) => item.type !== "schedule"),
  );
  assert.equal(event.insight, undefined);
  assert.equal(event.transcript, undefined);
});

test("a stale approval retry after reload or after the meeting time cannot add a duplicate sample event", () => {
  const { workspace, approval } = sampleApproval();
  const approved = approveSample(workspace.meetings, approval, NOW);
  const reloaded = readSampleWorkspace(
    JSON.stringify({ version: 1, meetings: approved }),
  )!;
  const retried = approveSample(
    reloaded.meetings,
    approval,
    new Date("2027-01-01T00:00:00Z"),
  );

  assert.equal(retried, reloaded.meetings);
  assert.equal(
    retried.filter((meeting) => meeting.sourceApprovalId === approval.id).length,
    1,
  );
});

test("missing date, duration, or attendee email prevents sample approval", () => {
  const { workspace, approval } = sampleApproval();
  for (const patch of [
    { startAt: null },
    { durationMinutes: null },
    { attendees: [] },
  ]) {
    const incomplete = { ...approval, details: { ...approval.details, ...patch } };
    assert.equal(missingApprovalDetails(incomplete.details).length, 1);
    assert.throws(
      () => approveSample(workspace.meetings, incomplete, NOW),
      /Complete the meeting details/u,
    );
  }
  assert.equal(getApprovals(workspace.meetings)[0]?.status, "pending");
});

test("tentative agreements stay out of the approval inbox and cannot create an event", () => {
  const { workspace, approval } = sampleApproval();
  const details = { ...approval.details, agreement: "tentative" as const };
  const meetings = updateApproval(workspace.meetings, approval.id, {
    schedule: details,
  });
  assert.ok(getApprovals(meetings).every((item) => item.id !== approval.id));
  assert.throws(
    () => approveSample(meetings, { ...approval, details }, NOW),
    /Complete the meeting details/u,
  );
});

test("dismissed or completed approvals reject a stale action when no event exists", () => {
  const { workspace, approval } = sampleApproval();
  for (const status of ["dismissed", "completed"] as const) {
    const meetings = updateApproval(workspace.meetings, approval.id, { status });
    assert.throws(
      () => approveSample(meetings, approval, NOW),
      /no longer pending/u,
    );
    assert.equal(meetings.length, workspace.meetings.length);
  }
});

test("sample and live approvals cannot cross the workspace boundary", () => {
  const { workspace, approval } = sampleApproval();
  assert.throws(() => liveApprovalRequest(approval, NOW), /Sample approvals/u);
  assert.throws(
    () => approveSample(workspace.meetings, realApproval(), NOW),
    /sample workspace/u,
  );
  assert.throws(
    () => approveSample(
      [...workspace.meetings, { ...workspace.meetings[0]!, id: "real-conversation" }],
      approval,
      NOW,
    ),
    /sample workspace/u,
  );
});

test("live approval carries the reviewed time, duration, recipients, and source IDs while leaving the recap private", () => {
  const approval = realApproval();
  approval.details.evidence = "A private quote from the conversation.";
  const request = liveApprovalRequest(approval, NOW);

  assert.deepEqual(request, {
    approved: true,
    summary: approval.title,
    startAt: approval.details.startAt,
    durationMinutes: 45,
    attendees: ["chung@example.com"],
    location: approval.details.location,
    meetingId: "conversation-chung",
    followUpId: "follow-up-chung",
    idempotencyKey: "approval:follow-up-chung",
  });
  assert.doesNotMatch(JSON.stringify(request), /private quote|evidence|insight|transcript|description/u);
});

test("live approval rejects a passed time, an incomplete agreement, or invalid recipients", () => {
  const approval = realApproval();
  assert.throws(
    () => liveApprovalRequest(approval, new Date(approval.details.startAt!)),
    /time has passed/u,
  );
  for (const patch of [
    { startAt: null },
    { durationMinutes: null },
    { attendees: [] },
    { agreement: "tentative" as const },
    { attendees: ["chung@example.com\r\nBcc: other@example.com"] },
  ]) {
    assert.throws(() => liveApprovalRequest({
      ...approval,
      details: { ...approval.details, ...patch },
    }, NOW));
  }
});

test("legacy task deadlines do not become supposedly agreed meeting times", () => {
  const { workspace, approval } = sampleApproval();
  for (const dueAt of ["2026-09-08", "2026-09-08T17:00:00+08:00"]) {
    const meetings = structuredClone(workspace.meetings);
    const task = meetings[0]!.followUps!.find((item) => item.id === approval.id)!;
    delete task.schedule;
    task.dueAt = dueAt;
    const legacy = getApprovals(meetings).find((item) => item.id === approval.id)!;
    assert.equal(legacy.details.startAt, null);
    assert.deepEqual(missingApprovalDetails(legacy.details), [
      "date and time", "duration", "attendee email",
    ]);
  }
});

test("corrupt or live data in sample storage is rejected before rendering", () => {
  assert.equal(readSampleWorkspace(null), null);
  assert.equal(readSampleWorkspace("not json"), null);
  assert.equal(readSampleWorkspace('{"version":2,"meetings":[]}'), null);
  const valid = createSampleWorkspace(NOW);
  assert.ok(readSampleWorkspace(JSON.stringify(valid)));
  const corruptions: ((value: typeof valid) => void)[] = [
    (value) => { value.meetings[0]!.id = "live-conversation"; },
    (value) => { value.meetings[0]!.startAt = "yesterday"; },
    (value) => { value.meetings[0]!.insight!.keyPoints = 42 as unknown as string[]; },
    (value) => { value.meetings[0]!.followUps![0]!.schedule!.durationMinutes = -15; },
    (value) => { value.meetings[3]!.sourceConversationId = "live-conversation"; },
  ];
  for (const corrupt of corruptions) {
    const workspace = structuredClone(valid);
    corrupt(workspace);
    assert.equal(readSampleWorkspace(JSON.stringify(workspace)), null);
  }
});

function conversationInput(): ConversationInput {
  return {
    version: 1,
    sourceReference: "agora-session-123",
    source: "agora",
    title: "Client conversation",
    startedAt: "2026-09-06T10:00:00+08:00",
    endedAt: "2026-09-06T11:32:00+08:00",
    timeZone: "Asia/Kuala_Lumpur",
    segments: [
      { id: "segment-1", speaker: "Unknown speaker", text: "Kita discuss the pilot dulu.", startSeconds: 0, endSeconds: 7 },
      { id: "segment-2", speaker: "Speaker 2", text: "Okay, agreed.", startSeconds: 5400, endSeconds: 5404 },
    ],
  };
}

test("the completed transcript boundary accepts a long conversation without inventing speaker identities", () => {
  const input = conversationInput();
  assert.deepEqual(conversationInputSchema.parse(input), input);
  assert.equal(
    conversationInputSchema.parse({ ...input, source: "transcript_import" }).source,
    "transcript_import",
  );
});

test("the transcript boundary rejects duplicate IDs, reversed or out-of-range segments, and invalid conversation timing", () => {
  const invalidations: ((value: ConversationInput) => void)[] = [
    (value) => { value.segments[1]!.id = value.segments[0]!.id; },
    (value) => { value.segments[0]!.endSeconds = -1; },
    (value) => { value.segments[1]!.endSeconds = 5399; },
    (value) => { value.segments[1]!.endSeconds = 5521; },
    (value) => { value.segments.reverse(); },
    (value) => { value.endedAt = value.startedAt; },
    (value) => { value.startedAt = "2026-09-06T10:00:00"; },
    (value) => { value.segments = []; },
  ];
  for (const invalidate of invalidations) {
    const input = conversationInput();
    invalidate(input);
    assert.equal(conversationInputSchema.safeParse(input).success, false);
  }
});
