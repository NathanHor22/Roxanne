import { NextResponse } from "next/server";
import { z } from "zod";

import { requireAuthenticatedSession, requireProductionPersistence } from "@/lib/api-security";
import { env } from "@/lib/env";
import { loadMeetings } from "@/lib/meetings-store";
import { buildRelayConversations } from "@/lib/relay";
import { loadRelayMatches, saveRelayMatches } from "@/lib/relay-store";
import { researchCompaniesWithExa } from "@/lib/providers/exa";
import { findRelayMatchesWithOpenAI } from "@/lib/providers/openai-relay";
import { getServerSupabase, resolveWorkspaceUserId } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const runSchema = z
  .object({
    eventName: z.string().trim().min(1).max(160).optional(),
    venue: z.string().trim().min(1).max(200).optional(),
  })
  .strict();

async function workspaceContext() {
  const client = getServerSupabase();
  const readinessError = requireProductionPersistence(Boolean(client));
  if (readinessError) return { readinessError };
  if (!client) return { client: null, userId: null };
  const userId = await resolveWorkspaceUserId(client);
  if (!userId)
    return {
      readinessError: NextResponse.json(
        { error: "The Lantern workspace is not available in Supabase." },
        { status: 503 },
      ),
    };
  return { client, userId };
}

export async function GET() {
  const authError = await requireAuthenticatedSession();
  if (authError) return authError;
  try {
    const context = await workspaceContext();
    if (context.readinessError) return context.readinessError;
    const matches =
      context.client && context.userId
        ? await loadRelayMatches(context.client, context.userId)
        : [];
    return NextResponse.json(
      { matches },
      { headers: { "cache-control": "no-store, max-age=0" } },
    );
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Relay could not be opened." },
      { status: 500 },
    );
  }
}

export async function POST(request: Request) {
  const authError = await requireAuthenticatedSession();
  if (authError) return authError;
  const parsedRequest = runSchema.safeParse(
    await request.json().catch(() => null),
  );
  if (!parsedRequest.success)
    return NextResponse.json(
      { error: "Invalid Relay request.", issues: parsedRequest.error.flatten() },
      { status: 400 },
    );
  try {
    const input = parsedRequest.data;
    const context = await workspaceContext();
    if (context.readinessError) return context.readinessError;
    const runtime = env();
    if (!runtime.OPENAI_API_KEY)
      return NextResponse.json(
        { error: "Add OPENAI_API_KEY to the Lantern server before running Relay." },
        { status: 503 },
      );
    const { meetings } = await loadMeetings();
    const conversations = buildRelayConversations(meetings);
    if (conversations.length < 2)
      return NextResponse.json(
        { error: "Relay needs at least two ready conversations with contacts." },
        { status: 400 },
      );
    const research = await researchCompaniesWithExa(
      conversations.flatMap((conversation) => conversation.company || []),
    );
    const generated = await findRelayMatchesWithOpenAI(conversations, research, {
      eventName: input.eventName,
      venue: input.venue,
    });
    let matches = generated;
    if (context.client && context.userId) {
      await saveRelayMatches(context.client, context.userId, generated);
      matches = await loadRelayMatches(context.client, context.userId);
    }
    return NextResponse.json(
      {
        matches,
        provider: "openai",
        model: runtime.OPENAI_RELAY_MODEL,
        generatedCount: generated.length,
        research: runtime.EXA_API_KEY ? "exa" : "not_configured",
      },
      {
        status: 201,
        headers: { "cache-control": "no-store, max-age=0" },
      },
    );
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Lantern Relay could not compare the conversations.",
      },
      { status: 502 },
    );
  }
}
