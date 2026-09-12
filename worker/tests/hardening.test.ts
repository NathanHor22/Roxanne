import assert from "node:assert/strict";
import test from "node:test";
import { loadConfig } from "../src/config.js";
import { AuthValueCipher } from "../src/database.js";

const AUTH_KEY = "independent-auth-secret-with-more-than-thirty-two-bytes";

const baseEnv: NodeJS.ProcessEnv = {
  NODE_ENV: "test",
  DATABASE_URL: "postgresql://worker:secret@example.test/database",
  WHATSAPP_RELAY_TOKEN: "relay-token-with-at-least-twenty-four-bytes",
  WHATSAPP_AUTH_ENCRYPTION_KEY: AUTH_KEY,
};

test("worker requires a distinct 32-byte auth encryption key", () => {
  assert.throws(
    () => loadConfig({ ...baseEnv, WHATSAPP_AUTH_ENCRYPTION_KEY: "too-short" }),
    /at least 32 bytes/u,
  );
  assert.throws(
    () =>
      loadConfig({
        ...baseEnv,
        WHATSAPP_AUTH_ENCRYPTION_KEY: baseEnv.WHATSAPP_RELAY_TOKEN,
      }),
    /must be separate/u,
  );
  assert.equal(loadConfig(baseEnv).workspaceKey, "lantern");
});

test("auth values are encrypted and bound to their workspace and data key", () => {
  const cipher = new AuthValueCipher(
    AUTH_KEY,
    "lantern",
  );
  const plaintext = '{"privateKey":"super-secret"}';
  const encrypted = cipher.encrypt("auth:creds", plaintext);

  assert.equal(cipher.isEncrypted(encrypted), true);
  assert.equal(encrypted.includes("super-secret"), false);
  assert.equal(cipher.decrypt("auth:creds", encrypted), plaintext);
  assert.throws(() => cipher.decrypt("auth:other-row", encrypted), /Could not decrypt/u);

  const otherWorkspace = new AuthValueCipher(
    AUTH_KEY,
    "somewhere-else",
  );
  assert.throws(
    () => otherWorkspace.decrypt("auth:creds", encrypted),
    /Could not decrypt/u,
  );
});
