import assert from "node:assert/strict";
import test from "node:test";

import { handlePrepareFollowUp } from "../lib/prepare-follow-up-route";
import {
  DEVIN_FALLBACK_WARNING,
  DevinProviderError,
  createFallbackDevinFollowUp,
  prepareDevinFollowUp,
  type DevinFollowUpInput,
} from "../lib/providers/devin";

function followUpInput(): DevinFollowUpInput {
  return {
    contact: {
      id: "contact-james",
      name: "James Tan",
      company: "Acme Manufacturing",
      role: "Procurement Lead",
      email: "james@example.com",
      phone: "+60123456789",
    },
    company: "Acme Manufacturing",
    meetingInsight: {
      meetingType: "Sales",
      intent: "Evaluate procurement automation",
      interestLevel: "high",
      wants: "A pilot and revised pricing",
      concern: "ERP integration",
      promised: "Send revised pricing",
      next: "Meet again for a demo next Thursday",
      keyPoints: ["Pilot requested", "ERP integration must be supported"],
      commitments: [],
      detectedLanguage: "English + Bahasa Malaysia",
    },
    commitments: [
      {
        id: "commitment-pricing",
        ownerType: "user",
        description: "Send revised pricing by Friday",
        dueAt: "2026-08-28",
        status: "open",
      },
    ],
    locale: "en",
  };
}

const validStructuredOutput = {
  whatsapp_message:
    "Hi James, great speaking earlier. I’ll send the revised pricing by Friday, and I look forward to our demo next Thursday.",
  meeting: {
    title: "Acme procurement automation demo",
    duration_minutes: 30,
  },
};

test("credential-free Devin drafting is deterministic and transparently labelled", async () => {
  let called = false;
  const fetchImpl = (async () => {
    called = true;
    throw new Error("fallback must not call Devin");
  }) as typeof fetch;

  const first = await prepareDevinFollowUp(followUpInput(), {
    apiKey: null,
    fetchImpl,
  });
  const second = createFallbackDevinFollowUp(followUpInput());

  assert.deepEqual(first, second);
  assert.equal(called, false);
  assert.equal(first.provider, "fallback");
  assert.equal(first.apiVersion, null);
  assert.equal(first.warning, DEVIN_FALLBACK_WARNING);
  assert.match(first.whatsappMessage, /James.+revised pricing/isu);
  assert.deepEqual(first.meeting, {
    title: "Follow-up with Acme Manufacturing",
    durationMinutes: 30,
  });
});

test("Devin fails closed without credentials in production", async () => {
  await assert.rejects(
    () =>
      prepareDevinFollowUp(followUpInput(), {
        apiKey: null,
        runtimeEnvironment: "production",
      }),
    (error: unknown) => {
      assert.ok(error instanceof DevinProviderError);
      assert.match(error.message, /DEVIN_API_KEY/u);
      assert.doesNotMatch(error.message, /fixture|fallback/iu);
      return true;
    },
  );

  const local = await prepareDevinFollowUp(followUpInput(), {
    apiKey: null,
    runtimeEnvironment: "test",
  });
  assert.equal(local.provider, "fallback");
});

test("DEVIN_ORG_ID selects v3, sends a self-contained Draft-7 schema, and polls", async () => {
  const previousOrgId = process.env.DEVIN_ORG_ID;
  process.env.DEVIN_ORG_ID = "org-demo";
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  const sleeps: number[] = [];
  let polls = 0;
  const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    calls.push({ url, init });

    if (init?.method === "POST") {
      assert.equal(
        url,
        "https://api.devin.ai/v3/organizations/org-demo/sessions",
      );
      assert.equal(
        (init.headers as Record<string, string>).Authorization,
        "Bearer cog_test-key",
      );
      const body = JSON.parse(String(init.body)) as {
        prompt: string;
        structured_output_required: boolean;
        structured_output_schema: Record<string, unknown>;
      };
      assert.equal(body.structured_output_required, true);
      assert.equal(
        body.structured_output_schema.$schema,
        "http://json-schema.org/draft-07/schema#",
      );
      assert.doesNotMatch(JSON.stringify(body.structured_output_schema), /"\$ref"/u);
      assert.match(body.prompt, /proposal only.+Never send/isu);
      assert.match(body.prompt, /Acme Manufacturing/u);
      return new Response(JSON.stringify({ session_id: "devin-session-123" }), {
        status: 200,
      });
    }

    assert.equal(init?.method, "GET");
    assert.equal(
      url,
      "https://api.devin.ai/v3/organizations/org-demo/sessions/devin-session-123",
    );
    polls += 1;
    return new Response(
      JSON.stringify(
        polls === 1
          ? {
              session_id: "devin-session-123",
              status: "running",
              status_detail: "working",
              structured_output: null,
            }
          : {
              session_id: "devin-session-123",
              status: "exit",
              status_detail: "finished",
              structured_output: validStructuredOutput,
            },
      ),
      { status: 200 },
    );
  }) as typeof fetch;

  let result;
  try {
    result = await prepareDevinFollowUp(followUpInput(), {
      apiKey: "cog_test-key",
      fetchImpl,
      pollIntervalMs: 2_000,
      sleepImpl: async (milliseconds) => {
        sleeps.push(milliseconds);
      },
    });
  } finally {
    if (previousOrgId === undefined) delete process.env.DEVIN_ORG_ID;
    else process.env.DEVIN_ORG_ID = previousOrgId;
  }

  assert.equal(calls.length, 3);
  assert.equal(polls, 2);
  assert.deepEqual(sleeps, [2_000]);
  assert.deepEqual(result, {
    whatsappMessage: validStructuredOutput.whatsapp_message,
    meeting: {
      title: "Acme procurement automation demo",
      durationMinutes: 30,
    },
    provider: "devin",
    apiVersion: "v3",
    sessionId: "devin-session-123",
  });
});

test("legacy credentials use the v1 session API when no organization id is set", async () => {
  let calls = 0;
  const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
    calls += 1;
    if (calls === 1) {
      assert.equal(String(input), "https://api.devin.ai/v1/sessions");
      assert.equal(init?.method, "POST");
      const body = JSON.parse(String(init?.body)) as {
        idempotent: boolean;
        unlisted: boolean;
        structured_output_schema: { $schema: string };
        structured_output_required?: unknown;
      };
      assert.equal(body.idempotent, false);
      assert.equal(body.unlisted, true);
      assert.equal(body.structured_output_required, undefined);
      assert.equal(
        body.structured_output_schema.$schema,
        "http://json-schema.org/draft-07/schema#",
      );
      return new Response(JSON.stringify({ session_id: "legacy-session" }), {
        status: 200,
      });
    }

    assert.equal(
      String(input),
      "https://api.devin.ai/v1/session/legacy-session",
    );
    assert.equal(init?.method, "GET");
    return new Response(
      JSON.stringify({
        session_id: "legacy-session",
        status: "finished",
        status_enum: "finished",
        structured_output: JSON.stringify({
          whatsapp_message: "Hi James, thanks for the conversation.",
          meeting: null,
        }),
      }),
      { status: 200 },
    );
  }) as typeof fetch;

  const result = await prepareDevinFollowUp(followUpInput(), {
    apiKey: "apk_test-key",
    orgId: null,
    fetchImpl,
  });

  assert.equal(calls, 2);
  assert.equal(result.provider, "devin");
  assert.equal(result.apiVersion, "v1");
  assert.equal(result.sessionId, "legacy-session");
  assert.equal(result.meeting, null);
});

test("configured Devin HTTP failures surface with status and redact the key", async () => {
  const fetchImpl = (async () =>
    new Response(
      JSON.stringify({ error: "invalid credential cog_super-secret" }),
      { status: 401 },
    )) as typeof fetch;

  await assert.rejects(
    () =>
      prepareDevinFollowUp(followUpInput(), {
        apiKey: "cog_super-secret",
        orgId: "org-demo",
        fetchImpl,
      }),
    (error: unknown) => {
      assert.ok(error instanceof DevinProviderError);
      assert.equal(error.status, 401);
      assert.match(error.message, /HTTP 401/u);
      assert.match(error.message, /\[redacted\]/u);
      assert.doesNotMatch(error.message, /cog_super-secret/u);
      return true;
    },
  );
});

test("invalid Devin structured output is rejected instead of becoming fallback data", async () => {
  let calls = 0;
  const fetchImpl = (async () => {
    calls += 1;
    if (calls === 1) {
      return new Response(JSON.stringify({ session_id: "invalid-output" }), {
        status: 200,
      });
    }
    return new Response(
      JSON.stringify({
        session_id: "invalid-output",
        status: "exit",
        structured_output: {
          ...validStructuredOutput,
          meeting: { title: "Demo", duration_minutes: 0 },
          invented_action: "message sent",
        },
      }),
      { status: 200 },
    );
  }) as typeof fetch;

  await assert.rejects(
    () =>
      prepareDevinFollowUp(followUpInput(), {
        apiKey: "cog_test-key",
        orgId: "org-demo",
        fetchImpl,
      }),
    (error: unknown) => {
      assert.ok(error instanceof DevinProviderError);
      assert.equal(error.sessionId, "invalid-output");
      assert.match(error.message, /invalid structured output/u);
      return true;
    },
  );
});

test("Devin polling enforces the 2-5 second interval and configurable timeout", async () => {
  await assert.rejects(
    () =>
      prepareDevinFollowUp(followUpInput(), {
        apiKey: "cog_test-key",
        orgId: "org-demo",
        pollIntervalMs: 1_999,
      }),
    /between 2000 and 5000/u,
  );

  let calls = 0;
  const fetchImpl = (async () => {
    calls += 1;
    return new Response(
      JSON.stringify(
        calls === 1
          ? { session_id: "slow-session" }
          : {
              session_id: "slow-session",
              status: "running",
              status_detail: "working",
              structured_output: null,
            },
      ),
      { status: 200 },
    );
  }) as typeof fetch;

  await assert.rejects(
    () =>
      prepareDevinFollowUp(followUpInput(), {
        apiKey: "cog_test-key",
        orgId: "org-demo",
        fetchImpl,
        timeoutMs: 20,
        pollIntervalMs: 2_000,
      }),
    (error: unknown) => {
      assert.ok(error instanceof DevinProviderError);
      assert.match(error.message, /timed out after 20ms/u);
      return true;
    },
  );
});

test("prepare-follow-up route validates JSON and returns a proposal without execution", async () => {
  let calls = 0;
  const expectedProposal = {
    whatsappMessage: "Hi James, I’ll send the revised pricing by Friday.",
    meeting: { title: "Acme follow-up", durationMinutes: 30 },
    provider: "devin" as const,
    apiVersion: "v3" as const,
    sessionId: "devin-route-session",
  };
  const request = new Request(
    "http://localhost/api/actions/prepare-follow-up",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(followUpInput()),
    },
  );

  const response = await handlePrepareFollowUp(
    request,
    async (input, options) => {
      calls += 1;
      assert.equal(
        typeof input.contact === "string" ? input.contact : input.contact.name,
        "James Tan",
      );
      assert.equal(options?.signal, request.signal);
      return expectedProposal;
    },
  );
  const body = (await response.json()) as {
    proposal: typeof expectedProposal;
    requiresApproval: boolean;
  };

  assert.equal(response.status, 200);
  assert.equal(response.headers.get("Cache-Control"), "no-store");
  assert.equal(calls, 1);
  assert.deepEqual(body.proposal, expectedProposal);
  assert.equal(body.requiresApproval, true);
  assert.deepEqual(Object.keys(body).sort(), ["proposal", "requiresApproval"]);
});

test("prepare-follow-up route returns useful validation and provider statuses", async () => {
  let called = false;
  const invalidJson = await handlePrepareFollowUp(
    new Request("http://localhost/api/actions/prepare-follow-up", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{",
    }),
    async () => {
      called = true;
      throw new Error("must not run");
    },
  );
  assert.equal(invalidJson.status, 400);
  assert.equal(called, false);

  const invalidContext = await handlePrepareFollowUp(
    new Request("http://localhost/api/actions/prepare-follow-up", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...followUpInput(), approved: true }),
    }),
    async () => {
      called = true;
      throw new Error("must not run");
    },
  );
  assert.equal(invalidContext.status, 400);
  assert.equal(called, false);

  const upstreamFailure = await handlePrepareFollowUp(
    new Request("http://localhost/api/actions/prepare-follow-up", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(followUpInput()),
    }),
    async () => {
      throw new DevinProviderError("Devin request failed with HTTP 401.", {
        status: 401,
        sessionId: "devin-failed-session",
      });
    },
  );
  const failureBody = (await upstreamFailure.json()) as {
    error: string;
    sessionId: string;
  };
  assert.equal(upstreamFailure.status, 502);
  assert.equal(failureBody.sessionId, "devin-failed-session");
  assert.match(failureBody.error, /HTTP 401/u);

  const timeout = await handlePrepareFollowUp(
    new Request("http://localhost/api/actions/prepare-follow-up", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(followUpInput()),
    }),
    async () => {
      throw new DevinProviderError("Devin follow-up timed out after 60000ms.");
    },
  );
  assert.equal(timeout.status, 504);
});
