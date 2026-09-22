import test from "node:test";
import assert from "node:assert/strict";
import { localDateTime, localDateTimeToIso, workspaceTime } from "../lib/workspace-time";

test("the journal and calendar group the same recording by the profile timezone", () => {
  const instant = "2026-09-22T00:30:00Z";
  assert.equal(workspaceTime("Asia/Kuala_Lumpur").dateKey(instant), "2026-09-22");
  assert.equal(workspaceTime("America/Los_Angeles").dateKey(instant), "2026-09-21");
  assert.equal(localDateTime(instant, "Asia/Kuala_Lumpur"), "2026-09-22T08:30");
  assert.equal(localDateTime(instant, "America/Los_Angeles"), "2026-09-21T17:30");
});

test("approval dates round-trip without relying on the server or browser timezone", () => {
  for (const zone of ["Asia/Kuala_Lumpur", "Asia/Kathmandu", "Australia/Adelaide", "America/New_York", "Pacific/Kiritimati", "UTC"]) {
    const instant = "2026-09-22T08:15:00.000Z";
    assert.equal(localDateTimeToIso(localDateTime(instant, zone), zone), instant);
  }
});

test("approval editing rejects invalid dates and ambiguous or missing DST times", () => {
  assert.throws(() => localDateTimeToIso("2026-02-30T10:00", "Asia/Kuala_Lumpur"), /valid/);
  assert.throws(() => localDateTimeToIso("2026-03-08T02:30", "America/New_York"), /skipped/);
  assert.throws(() => localDateTimeToIso("2026-11-01T01:30", "America/New_York"), /twice/);
  assert.equal(localDateTimeToIso("2026-11-01T02:30", "America/New_York"), "2026-11-01T07:30:00.000Z");
});
