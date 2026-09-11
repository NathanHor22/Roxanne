import assert from "node:assert/strict";
import test from "node:test";

import {
  advanceLantern,
  createLanternMachine,
  lanternMachineSchema,
  LanternTransitionError,
} from "../lib/lantern-state";

const at = "2026-09-11T10:00:00+08:00";
const later = "2026-09-11T10:00:10+08:00";
const expires = "2026-09-11T10:00:30+08:00";

test("quick mode cannot record before its exact consent prompt is confirmed", () => {
  const ready = createLanternMachine("ready");
  const awaiting = advanceLantern(ready, {
    type: "BEGIN_QUICK",
    at,
    sessionId: "session-1",
    promptId: "consent-1",
    promptExpiresAt: expires,
  });

  assert.equal(awaiting.state, "awaiting_recording_consent");
  assert.throws(
    () =>
      advanceLantern(awaiting, {
        type: "RECORDING_CONSENT",
        at: later,
        promptId: "an-incidental-yes",
        accepted: true,
      }),
    LanternTransitionError,
  );

  const recording = advanceLantern(awaiting, {
    type: "RECORDING_CONSENT",
    at: later,
    promptId: "consent-1",
    accepted: true,
  });
  assert.equal(recording.state, "recording");
  assert.equal(recording.consentConfirmedAt, later);
  assert.equal(recording.prompt, null);
});

test("an expired consent response does not start recording", () => {
  const awaiting = advanceLantern(createLanternMachine("ready"), {
    type: "BEGIN_QUICK",
    at,
    sessionId: "session-1",
    promptId: "consent-1",
    promptExpiresAt: expires,
  });

  assert.throws(
    () =>
      advanceLantern(awaiting, {
        type: "RECORDING_CONSENT",
        at: "2026-09-11T10:00:31+08:00",
        promptId: "consent-1",
        accepted: true,
      }),
    /expired/,
  );
});

test("quick meeting follows pause, finalise, processing and report states", () => {
  let machine = advanceLantern(createLanternMachine("ready"), {
    type: "BEGIN_QUICK",
    at,
    sessionId: "session-2",
    promptId: "consent-2",
    promptExpiresAt: expires,
  });
  machine = advanceLantern(machine, {
    type: "RECORDING_CONSENT",
    at: later,
    promptId: "consent-2",
    accepted: true,
  });
  machine = advanceLantern(machine, { type: "PAUSE", at: later });
  assert.equal(machine.state, "paused");
  machine = advanceLantern(machine, { type: "RESUME", at: later });
  machine = advanceLantern(machine, { type: "STOP", at: later });
  assert.equal(machine.state, "finalising");
  machine = advanceLantern(machine, { type: "ARCHIVE_ACCEPTED", at: later });
  assert.equal(machine.state, "processing");
  machine = advanceLantern(machine, { type: "PROCESSING_COMPLETE", at: later });
  assert.equal(machine.state, "report_ready");
  assert.equal(machine.sessionId, null);
  assert.equal(machine.mode, null);
});

test("voice confirmation creates a dashboard approval and never executes externally", () => {
  let machine = advanceLantern(createLanternMachine("ready"), {
    type: "BEGIN_STATUS",
    at,
    sessionId: "status-1",
  });
  machine = advanceLantern(machine, {
    type: "OATH_RESULT",
    at: later,
    accepted: true,
  });
  machine = advanceLantern(machine, {
    type: "ACTION_PROPOSED",
    at: later,
    proposalId: "proposal-1",
    promptId: "proposal-confirmation-1",
    promptExpiresAt: expires,
  });
  machine = advanceLantern(machine, {
    type: "ACTION_CONFIRMATION",
    at: later,
    promptId: "proposal-confirmation-1",
    accepted: true,
  });

  assert.equal(machine.state, "pending_dashboard_approval");
  assert.equal(machine.proposalId, "proposal-1");
});

test("connection loss buffers only from an active meeting and restores its state", () => {
  let machine = advanceLantern(createLanternMachine("ready"), {
    type: "BEGIN_QUICK",
    at,
    sessionId: "session-3",
    promptId: "consent-3",
    promptExpiresAt: expires,
  });
  machine = advanceLantern(machine, {
    type: "RECORDING_CONSENT",
    at: later,
    promptId: "consent-3",
    accepted: true,
  });
  machine = advanceLantern(machine, { type: "CONNECTION_LOST", at: later });
  machine = advanceLantern(machine, {
    type: "BUFFER_UPDATED",
    at: later,
    bufferedSeconds: 12,
  });
  assert.equal(machine.state, "offline_buffering");
  assert.equal(machine.bufferedSeconds, 12);
  machine = advanceLantern(machine, {
    type: "CONNECTION_RESTORED",
    at: later,
  });
  assert.equal(machine.state, "recording");
  assert.equal(machine.bufferedSeconds, 0);
});

test("stored machines reject inconsistent modes, sessions and prompts", () => {
  assert.equal(
    lanternMachineSchema.safeParse({
      ...createLanternMachine("ready"),
      state: "recording",
    }).success,
    false,
  );
  assert.equal(
    lanternMachineSchema.safeParse({
      ...createLanternMachine("ready"),
      state: "awaiting_recording_consent",
      mode: "quick",
      sessionId: "session-4",
      prompt: null,
    }).success,
    false,
  );
});
