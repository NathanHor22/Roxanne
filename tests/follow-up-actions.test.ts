import assert from "node:assert/strict";
import test from "node:test";

import {
  localFollowUpPatchResult,
  parseFollowUpPatch,
} from "../app/api/follow-ups/[id]/follow-up-update";

test("seed follow-ups support deterministic completed and pending transitions", () => {
  assert.deepEqual(
    localFollowUpPatchResult(
      "seed-follow-up",
      "completed",
      new Date("2026-08-23T10:00:00.000Z"),
    ),
    {
      ok: true,
      id: "seed-follow-up",
      status: "completed",
      completedAt: "2026-08-23T10:00:00.000Z",
      persisted: false,
    },
  );
  assert.equal(
    localFollowUpPatchResult("seed-follow-up", "pending").completedAt,
    null,
  );
});

test("follow-up PATCH input accepts only owner-controlled state transitions", () => {
  assert.deepEqual(parseFollowUpPatch("follow-up-1", { status: "pending" }), {
    id: "follow-up-1",
    status: "pending",
  });
  assert.throws(() => parseFollowUpPatch("follow-up-1", { status: "failed" }));
  assert.throws(() =>
    parseFollowUpPatch("follow-up-1", {
      status: "completed",
      userId: "attacker-selected-owner",
    }),
  );
});
