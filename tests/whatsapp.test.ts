import assert from "node:assert/strict";
import test from "node:test";

import {
  ALLOWED_WHATSAPP_RECIPIENT,
  assertAllowedRecipient,
  isValidBearerAuthorization,
  normalizeMalaysianPhone,
  parseSendPayload,
  RequestError,
} from "../worker/src/protocol";

test("Malaysian mobile numbers normalize to E.164 digits", () => {
  assert.equal(normalizeMalaysianPhone("011-5444 4038"), "601154444038");
  assert.equal(normalizeMalaysianPhone("+60 11 5444 4038"), "601154444038");
  assert.equal(normalizeMalaysianPhone("0060 11 5444 4038"), "601154444038");
  assert.equal(normalizeMalaysianPhone("11 5444 4038"), "601154444038");
  assert.equal(ALLOWED_WHATSAPP_RECIPIENT, "601154444038");
});

test("recipient allowlist rejects every non-owner number", () => {
  assert.equal(assertAllowedRecipient("01154444038"), "601154444038");
  assert.throws(
    () => assertAllowedRecipient("0123456789"),
    (error: unknown) => error instanceof RequestError && error.status === 403,
  );
  assert.throws(
    () => normalizeMalaysianPhone("not a phone"),
    (error: unknown) => error instanceof RequestError && error.status === 400,
  );
});

test("bearer auth is exact and case-insensitive only for the scheme", () => {
  const token = "a-secure-token-with-24-bytes";
  assert.equal(isValidBearerAuthorization(`Bearer ${token}`, token), true);
  assert.equal(isValidBearerAuthorization(`bearer ${token}`, token), true);
  assert.equal(isValidBearerAuthorization(`Bearer ${token}x`, token), false);
  assert.equal(isValidBearerAuthorization(token, token), false);
  assert.equal(isValidBearerAuthorization(undefined, token), false);
});

test("send payload requires approved recipient, bounded text, and idempotency", () => {
  assert.deepEqual(
    parseSendPayload({
      to: "011 5444 4038",
      text: "  Hello from Lantern  ",
      idempotencyKey: "followup:12345678",
    }),
    {
      to: "601154444038",
      text: "Hello from Lantern",
      idempotencyKey: "followup:12345678",
    },
  );
  assert.throws(() =>
    parseSendPayload({
      to: "601154444038",
      text: "hello",
      idempotencyKey: "short",
    }),
  );
  assert.throws(() =>
    parseSendPayload({
      to: "60123456789",
      text: "hello",
      idempotencyKey: "long-enough-key",
    }),
  );
});
