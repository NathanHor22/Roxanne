import assert from "node:assert/strict";
import test from "node:test";

import {
  createDeviceSecret,
  createPairingCode,
  hashLanternSecret,
  matchesLanternSecret,
  normalizePairingCode,
  parseDeviceAuthorization,
} from "../lib/lantern-device-auth";

const DEVICE_ID = "11111111-1111-4111-8111-111111111111";

test("pairing codes exclude ambiguous characters and normalize display spacing", () => {
  const code = createPairingCode(Buffer.from([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]));
  assert.equal(code.length, 10);
  assert.doesNotMatch(code, /[01IO]/u);
  assert.equal(normalizePairingCode(`${code.slice(0, 5)}-${code.slice(5)}`), code);
  assert.throws(() => normalizePairingCode("SHORT"), /10-character/u);
});

test("device authorization separates the UUID from a high-entropy secret", () => {
  const secret = createDeviceSecret();
  const parsed = parseDeviceAuthorization(`Device ${DEVICE_ID}.${secret}`);
  assert.deepEqual(parsed, { deviceId: DEVICE_ID, secret });
  assert.equal(parseDeviceAuthorization(`Bearer ${DEVICE_ID}.${secret}`), null);
  assert.equal(parseDeviceAuthorization(`Device ${DEVICE_ID}.short`), null);
});

test("stored device hashes validate without retaining the credential", () => {
  const secret = createDeviceSecret();
  const hash = hashLanternSecret(secret);
  assert.equal(hash.length, 64);
  assert.equal(matchesLanternSecret(secret, hash), true);
  assert.equal(matchesLanternSecret(`${secret}x`, hash), false);
  assert.doesNotMatch(hash, new RegExp(secret, "u"));
});

