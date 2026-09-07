import assert from "node:assert/strict";
import test from "node:test";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  PLAYBACK_URL_SECONDS,
  recordingIdSchema,
  recordingPlaybackResponse,
} from "../app/api/recordings/[id]/playback/playback-response";
import { GET } from "../app/api/recordings/[id]/playback/route";

const ownerId = "16b03c76-6d48-4a8e-a215-c14603d4ae42";
const recordingId = "7b3f3d3c-41e3-45dc-90ce-a8c86b09ea50";
const storagePath = `${ownerId}/2026/09/${recordingId}.webm`;
const url =
  "https://storage.example.test/storage/v1/object/sign/recordings/private?token=short-lived";

function mockPlayback(
  options: {
    row?: Record<string, unknown> | null;
    queryError?: unknown;
    signingError?: unknown;
    signedUrl?: string | null;
  } = {},
) {
  const filters: Array<[string, string]> = [];
  const signed: Array<[string, number]> = [];
  const query = {
    select() {
      return query;
    },
    eq(key: string, value: string) {
      filters.push([key, value]);
      return query;
    },
    async maybeSingle() {
      return {
        data:
          options.row === undefined
            ? { id: recordingId, user_id: ownerId, storage_path: storagePath }
            : options.row,
        error: options.queryError || null,
      };
    },
  };
  const client = {
    from(table: string) {
      assert.equal(table, "recordings");
      return query;
    },
    storage: {
      from(bucket: string) {
        assert.equal(bucket, "recordings");
        return {
          async createSignedUrl(path: string, seconds: number) {
            signed.push([path, seconds]);
            return {
              data: {
                signedUrl:
                  options.signedUrl === undefined ? url : options.signedUrl,
              },
              error: options.signingError || null,
            };
          },
        };
      },
    },
  } as unknown as SupabaseClient;
  return { client, filters, signed };
}

test("playback signs only the owned original object for two hours without proxying audio", async () => {
  const mock = mockPlayback();
  const response = await recordingPlaybackResponse(
    mock.client,
    recordingId,
    ownerId,
    Date.parse("2026-09-07T01:00:00Z"),
  );
  assert.equal(response.status, 200);
  assert.deepEqual(mock.filters, [
    ["id", recordingId],
    ["user_id", ownerId],
  ]);
  assert.deepEqual(mock.signed, [[storagePath, 7200]]);
  assert.equal(PLAYBACK_URL_SECONDS, 7200);
  assert.equal(response.headers.get("cache-control"), "no-store, max-age=0");
  assert.deepEqual(await response.json(), {
    url,
    expiresAt: "2026-09-07T03:00:00.000Z",
  });
});

test("missing, transcript-only, foreign and malformed recording paths never reach signing", async () => {
  const paths = [
    null,
    "",
    `other-owner/2026/09/${recordingId}.webm`,
    `${ownerId}/../09/${recordingId}.webm`,
    `${ownerId}/2026/09/another-recording.webm`,
    `https://example.test/${recordingId}.webm`,
    `${ownerId}/2026/09/${recordingId}.txt`,
  ];
  for (const path of paths) {
    const mock = mockPlayback({
      row: { id: recordingId, user_id: ownerId, storage_path: path },
    });
    const response = await recordingPlaybackResponse(
      mock.client,
      recordingId,
      ownerId,
    );
    assert.equal(response.status, 404, String(path));
    assert.deepEqual(mock.signed, []);
    assert.equal(response.headers.get("cache-control"), "no-store, max-age=0");
  }
  for (const row of [
    null,
    { id: recordingId, user_id: "another-owner", storage_path: storagePath },
  ]) {
    const mock = mockPlayback({ row });
    assert.equal(
      (await recordingPlaybackResponse(mock.client, recordingId, ownerId))
        .status,
      404,
    );
    assert.deepEqual(mock.signed, []);
  }
});

test("playback failures redact storage errors and distinguish a missing object", async () => {
  const signingError = { statusCode: "500", message: "service-role-secret" };
  for (const options of [
    { signingError },
    { queryError: signingError },
    { signedUrl: null },
  ]) {
    const mock = mockPlayback(options);
    const response = await recordingPlaybackResponse(
      mock.client,
      recordingId,
      ownerId,
    );
    assert.equal(response.status, 502);
    assert.equal(response.headers.get("cache-control"), "no-store, max-age=0");
    assert.ok(!(await response.text()).includes("service-role-secret"));
  }
  const missing = mockPlayback({
    signingError: { code: "not_found", statusCode: "400" },
  });
  assert.equal(
    (await recordingPlaybackResponse(missing.client, recordingId, ownerId))
      .status,
    404,
  );
});

test("playback IDs reject sample and malformed references", () => {
  assert.equal(recordingIdSchema.safeParse(recordingId).success, true);
  for (const id of [
    "sample:conversation:0",
    "../recordings",
    "",
    "not-a-uuid",
  ]) {
    assert.equal(recordingIdSchema.safeParse(id).success, false);
  }
});

test("playback authenticates before validation and never caches configuration or invalid-ID errors", async () => {
  const keys = [
    "NODE_ENV",
    "DEMO_ACCESS_MODE",
    "NEXT_PUBLIC_SUPABASE_URL",
    "NEXT_PUBLIC_SUPABASE_ANON_KEY",
  ];
  const saved = Object.fromEntries(keys.map((key) => [key, process.env[key]]));
  try {
    for (const key of keys) delete process.env[key];
    Object.assign(process.env, { NODE_ENV: "production" });
    const request = new Request(
      "http://localhost/api/recordings/sample:0/playback",
    );
    const context = { params: Promise.resolve({ id: "sample:0" }) };
    const unavailable = await GET(request, context);
    assert.equal(unavailable.status, 503);
    assert.equal(
      unavailable.headers.get("cache-control"),
      "no-store, max-age=0",
    );
    Object.assign(process.env, { NODE_ENV: "development" });
    const invalid = await GET(request, context);
    assert.equal(invalid.status, 400);
    assert.equal(invalid.headers.get("cache-control"), "no-store, max-age=0");
  } finally {
    for (const key of keys) {
      if (saved[key] === undefined) delete process.env[key];
      else process.env[key] = saved[key];
    }
  }
});
