import { createHash, randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { z } from "zod";
import { requireOwnerSession } from "@/lib/api-security";
import { getServerSupabase, resolveDemoUserId } from "@/lib/supabase/server";
import { conversationInputSchema } from "@/lib/workspace/model";
import { extractWithIlmu } from "@/lib/providers/ilmu";
import { persistProcessedMeeting } from "@/lib/persistence";
import type { Meeting } from "@/lib/types";

export const runtime = "nodejs";
export const maxDuration = 120;

/** Completed transcript boundary. Future device gateways authenticate separately
 * and normalize Agora segments into this contract. No device auth bypass here. */
export async function POST(request: Request) {
  const authError = await requireOwnerSession();
  if (authError) return authError;
  const client = getServerSupabase();
  if (!client)
    return NextResponse.json(
      { error: "Connect workspace storage before importing conversations." },
      { status: 503 },
    );
  let claimedMeeting: { id: string; userId: string } | null = null;
  try {
    const raw = await request.text();
    if (Buffer.byteLength(raw, "utf8") > 2_000_000)
      return NextResponse.json(
        { error: "Conversation exceeds the 2 MB import limit." },
        { status: 413 },
      );
    const input = conversationInputSchema.parse(JSON.parse(raw));
    if (input.sourceReference.startsWith("sample:"))
      return NextResponse.json(
        { error: "Sample conversations stay in the sample workspace." },
        { status: 400 },
      );
    const userId = await resolveDemoUserId(client, { createIfMissing: false });
    if (!userId)
      return NextResponse.json(
        { error: "Your workspace could not be found." },
        { status: 404 },
      );
    const clientReference = `conversation:${createHash("sha256").update(input.sourceReference).digest("hex")}`;
    const { data: existing, error: lookupError } = await client
      .from("meetings")
      .select("id,status")
      .eq("user_id", userId)
      .eq("client_reference", clientReference)
      .maybeSingle();
    if (lookupError) throw new Error("The conversation could not be checked.");
    if (existing?.status === "ready")
      return NextResponse.json({
        persisted: true,
        conversationId: clientReference,
        duplicate: true,
      });
    if (existing && existing.status !== "failed")
      return NextResponse.json(
        {
          error:
            "This conversation is already being processed. Refresh your workspace before retrying.",
        },
        { status: 409 },
      );

    // The unique owner/reference key is an atomic claim. Two imports must not
    // concurrently replace the same conversation's follow-ups and approvals.
    const claim = existing
      ? await client
          .from("meetings")
          .update({ status: "processing" })
          .eq("id", existing.id)
          .eq("user_id", userId)
          .eq("status", "failed")
          .select("id")
          .maybeSingle()
      : await client
          .from("meetings")
          .insert({
            user_id: userId,
            client_reference: clientReference,
            title: input.title,
            start_at: input.startedAt,
            end_at: input.endedAt,
            status: "processing",
            source: input.source === "agora" ? "agora" : "upload",
          })
          .select("id")
          .single();
    if (claim.error?.code === "23505" || (!claim.error && !claim.data))
      return NextResponse.json(
        {
          error:
            "This conversation is already being processed. Refresh your workspace before retrying.",
        },
        { status: 409 },
      );
    if (claim.error || !claim.data)
      throw new Error("The conversation could not be reserved for processing.");
    claimedMeeting = { id: claim.data.id, userId };
    const segments = input.segments;
    const extraction = await extractWithIlmu(segments, {
      title: input.title,
      referenceDate: input.startedAt,
      timezone: input.timeZone,
      outputLanguage: "English",
    });
    const meeting: Meeting = {
      id: clientReference,
      title: input.title,
      startAt: input.startedAt,
      endAt: input.endedAt,
      status: "ready",
      source: input.source === "agora" ? "agora" : "upload",
      contacts: extraction.participants.map((contact) => ({
        ...contact,
        id: randomUUID(),
      })),
      transcript: segments,
      insight: extraction.insight,
      followUps: [],
    };
    const persistence = await persistProcessedMeeting({
      clientReference,
      meeting,
      extraction,
      transcription: {
        text: segments
          .map((segment) => `${segment.speaker}: ${segment.text}`)
          .join("\n"),
        segments,
        language: extraction.insight.detectedLanguage,
        provider: input.source === "agora" ? "agora" : "import",
      },
    });
    return NextResponse.json(
      {
        meeting,
        persisted: persistence.persisted,
        conversationId: clientReference,
        duplicate: false,
      },
      { status: 201 },
    );
  } catch (cause) {
    if (claimedMeeting)
      await client
        .from("meetings")
        .update({ status: "failed" })
        .eq("id", claimedMeeting.id)
        .eq("user_id", claimedMeeting.userId)
        .eq("status", "processing");
    if (cause instanceof z.ZodError || cause instanceof SyntaxError)
      return NextResponse.json(
        { error: "The conversation or extracted meeting details are invalid." },
        { status: 400 },
      );
    return NextResponse.json(
      {
        error:
          cause instanceof Error
            ? cause.message
            : "The conversation could not be processed.",
      },
      { status: 502 },
    );
  }
}
