import assert from "node:assert/strict";
import test from "node:test";

import {
  authEnforcementMode,
  isOwnerEmail,
  isPublicAuthPath,
  sanitizeAuthReturnTo,
} from "../lib/auth-policy";

test("auth can be omitted only in unconfigured local development", () => {
  assert.equal(authEnforcementMode({ nodeEnv: "development" }), "disabled");
  assert.equal(authEnforcementMode({ nodeEnv: "test" }), "disabled");
  assert.equal(authEnforcementMode({ nodeEnv: "production" }), "misconfigured");
});

test("auth fails closed for partial Supabase public configuration", () => {
  assert.equal(
    authEnforcementMode({
      nodeEnv: "development",
      supabaseUrl: "https://project.supabase.co",
    }),
    "misconfigured",
  );
  assert.equal(
    authEnforcementMode({ nodeEnv: "development", supabaseAnonKey: "key" }),
    "misconfigured",
  );
});

test("auth is enabled when both Supabase public values exist", () => {
  assert.equal(
    authEnforcementMode({
      nodeEnv: "development",
      supabaseUrl: "https://project.supabase.co",
      supabaseAnonKey: "key",
    }),
    "enabled",
  );
});

test("owner email comparison is trimmed and case insensitive", () => {
  assert.equal(isOwnerEmail(" NathanHor2001@gmail.com ", "nathanhor2001@gmail.com"), true);
  assert.equal(isOwnerEmail("someone@example.com", "nathanhor2001@gmail.com"), false);
  assert.equal(isOwnerEmail(undefined, "nathanhor2001@gmail.com"), false);
});

test("OAuth return path accepts only same-origin relative paths", () => {
  assert.equal(sanitizeAuthReturnTo("/people?view=active#top"), "/people?view=active#top");
  assert.equal(sanitizeAuthReturnTo("https://attacker.invalid"), "/");
  assert.equal(sanitizeAuthReturnTo("//attacker.invalid/path"), "/");
  assert.equal(sanitizeAuthReturnTo(undefined), "/");
});

test("only login, auth callback and logout are public auth endpoints", () => {
  assert.equal(isPublicAuthPath("/login"), true);
  assert.equal(isPublicAuthPath("/auth/callback"), true);
  assert.equal(isPublicAuthPath("/api/auth/logout"), true);
  assert.equal(isPublicAuthPath("/api/agora/token"), false);
  assert.equal(isPublicAuthPath("/api/google/callback"), false);
});
