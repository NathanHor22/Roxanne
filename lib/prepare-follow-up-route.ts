import { NextResponse } from "next/server";

import {
  DevinProviderError,
  devinFollowUpInputSchema,
  prepareDevinFollowUp,
  type DevinFollowUpInput,
  type DevinFollowUpOptions,
  type DevinFollowUpResult,
} from "@/lib/providers/devin";

type FollowUpPreparer = (
  input: DevinFollowUpInput,
  options?: Pick<DevinFollowUpOptions, "signal">,
) => Promise<DevinFollowUpResult>;

function providerHttpStatus(error: DevinProviderError): number {
  if (/timed out/iu.test(error.message)) return 504;
  if (error.status === 429) return 429;
  return 502;
}

/** Proposal-only handler kept outside the route module for isolated testing. */
export async function handlePrepareFollowUp(
  request: Request,
  prepare: FollowUpPreparer = prepareDevinFollowUp,
): Promise<NextResponse> {
  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return NextResponse.json(
      { error: "Request body must be valid JSON." },
      { status: 400 },
    );
  }

  const parsed = devinFollowUpInputSchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid follow-up context.", issues: parsed.error.flatten() },
      { status: 400 },
    );
  }

  try {
    const proposal = await prepare(parsed.data, { signal: request.signal });
    return NextResponse.json(
      { proposal, requiresApproval: true },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    if (error instanceof DevinProviderError) {
      return NextResponse.json(
        {
          error: error.message,
          ...(error.sessionId ? { sessionId: error.sessionId } : {}),
        },
        { status: providerHttpStatus(error) },
      );
    }
    return NextResponse.json(
      { error: "The follow-up proposal could not be prepared." },
      { status: 500 },
    );
  }
}
