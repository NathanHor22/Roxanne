import assert from "node:assert/strict";
import test from "node:test";

import { requireProductionPersistence } from "../lib/api-security";

test("production persistence readiness fails closed with a non-cacheable 503", async () => {
  const response = requireProductionPersistence(
    false,
    "Durable storage is required.",
    "production",
  );

  assert.ok(response);
  assert.equal(response.status, 503);
  assert.equal(response.headers.get("cache-control"), "no-store, max-age=0");
  assert.deepEqual(await response.json(), { error: "Durable storage is required." });
});

test("persistence readiness permits configured production and local fallback", () => {
  assert.equal(requireProductionPersistence(true, undefined, "production"), null);
  assert.equal(requireProductionPersistence(false, undefined, "development"), null);
});
