import { createHash } from "node:crypto";

import { NextResponse } from "next/server";
import { z } from "zod";

import { requireOwnerSession } from "@/lib/api-security";
import { env } from "@/lib/env";
import {
  GoogleCalendarProviderError,
  buildGoogleCalendarInsert,
  createAuthorizedGoogleOAuthClient,
  createGoogleCalendarEvent,
  getGoogleOAuthConfig,
  googleCalendarEventSchema,
} from "@/lib/providers/google-calendar";
import {
  getServerSupabase,
  resolveDemoUserId,
} from "@/lib/supabase/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function internalIdempotencyKey(
  userId: string | null,
  input: z.output<typeof googleCalendarEventSchema>,
): string {
  const canonicalPayload = JSON.stringify({
    summary: input.summary,
    startAt: input.startAt,
    attendees: [...input.attendees].sort(),
    description: input.description ?? null,
    location: input.location ?? null,
    conferenceUrl: input.conferenceUrl ?? null,
    meetingReference: input.clientReference ?? input.meetingId ?? null,
  });
  const callerKey = input.idempotencyKey ?? "canonical";
  return `calendar:${createHash("sha256")
    .update(`${userId ?? "environment"}\0${callerKey}\0${canonicalPayload}`)
    .digest("hex")}`;
}

function providerStatus(error: GoogleCalendarProviderError): number {
  if (error.code === "configuration" || error.code === "not_connected") {
    return 503;
  }
  if (error.code === "calendar_failure") return 502;
  return 500;
}

type ServerSupabase = NonNullable<ReturnType<typeof getServerSupabase>>;

async function persistCalendarMeeting(
  client: ServerSupabase,
  userId: string,
  input: z.output<typeof googleCalendarEventSchema>,
  event: {
    id: string;
    startAt: string;
    endAt: string;
  },
) {
  const clientReference = `calendar:${event.id}`;
  const { data: meeting, error } = await client
    .from("meetings")
    .upsert(
      {
        user_id: userId,
        calendar_event_id: event.id,
        client_reference: clientReference,
        title: input.summary,
        start_at: event.startAt,
        end_at: event.endAt,
        status: "upcoming",
        source: "calendar",
      },
      { onConflict: "user_id,client_reference" },
    )
    .select("id")
    .single();
  if (error || !meeting) {
    throw new Error("The Calendar event was created but Roxanne could not save it.");
  }

  const { data: contacts, error: contactsError } = await client
    .from("contacts")
    .select("id")
    .eq("user_id", userId)
    .in("email", input.attendees);
  if (contactsError) throw new Error("Could not match Calendar attendees.");
  if (contacts?.length) {
    const { error: linkError } = await client.from("meeting_contacts").upsert(
      contacts.map((contact, index) => ({
        meeting_id: meeting.id,
        contact_id: contact.id,
        is_primary: index === 0,
      })),
      { onConflict: "meeting_id,contact_id" },
    );
    if (linkError) throw new Error("Could not link Calendar attendees.");
  }
  return clientReference;
}

export async function POST(request: Request) {
  const authError = await requireOwnerSession();
  if (authError) return authError;
  let actionId: string | null = null;
  let ownerUserId: string | null = null;
  const client = getServerSupabase();

  try {
    const raw = (await request.json()) as unknown;
    if (
      !raw ||
      typeof raw !== "object" ||
      (raw as { approved?: unknown }).approved !== true
    ) {
      return NextResponse.json(
        { error: "Explicit approval is required before inviting attendees." },
        { status: 403 },
      );
    }
    const input = googleCalendarEventSchema.parse(raw);
    const runtime = env();
    const config = getGoogleOAuthConfig();

    let userId = runtime.DEMO_USER_ID ?? null;
    if (!config.refreshToken) {
      if (!client) {
        throw new GoogleCalendarProviderError(
          "Google Calendar is not connected.",
          "not_connected",
        );
      }
      userId = await resolveDemoUserId(client, { createIfMissing: false });
    } else if (client && !userId) {
      // Auditing is best-effort for the environment refresh-token path. Calendar
      // remains usable even when no Supabase demo user has been created yet.
      try {
        userId = await resolveDemoUserId(client, { createIfMissing: false });
      } catch {
        userId = null;
      }
    }
    if (process.env.NODE_ENV === "production" && (!client || !userId)) {
      throw new GoogleCalendarProviderError(
        "Supabase action persistence is required in production.",
        "configuration",
      );
    }
    ownerUserId = userId;

    const idempotencyKey = internalIdempotencyKey(userId, input);
    const googleEventId = idempotencyKey.slice("calendar:".length);
    let databaseMeetingId: string | null = null;
    let databaseFollowUpId: string | null = null;
    if (client && userId) {
      const meetingReference = input.clientReference ?? input.meetingId;
      if (meetingReference) {
        const { data: byReference, error: referenceError } = await client
          .from("meetings")
          .select("id")
          .eq("user_id", userId)
          .eq("client_reference", meetingReference)
          .maybeSingle();
        if (referenceError) throw new Error("Could not resolve the meeting reference.");
        databaseMeetingId = (byReference?.id as string | undefined) ?? null;
        if (!databaseMeetingId && z.string().uuid().safeParse(meetingReference).success) {
          const { data: byId, error: idError } = await client
            .from("meetings")
            .select("id")
            .eq("user_id", userId)
            .eq("id", meetingReference)
            .maybeSingle();
          if (idError) throw new Error("Could not resolve the meeting ID.");
          databaseMeetingId = (byId?.id as string | undefined) ?? null;
        }
      }
      if (input.followUpId && z.string().uuid().safeParse(input.followUpId).success) {
        const { data: followUp, error: followUpError } = await client
          .from("follow_ups")
          .select("id")
          .eq("user_id", userId)
          .eq("id", input.followUpId)
          .maybeSingle();
        if (followUpError) throw new Error("Could not resolve the follow-up ID.");
        databaseFollowUpId = (followUp?.id as string | undefined) ?? null;
      }
      const { data: existing, error: existingError } = await client
        .from("actions")
        .select("id,status,external_id")
        .eq("user_id", userId)
        .eq("idempotency_key", idempotencyKey)
        .maybeSingle();
      if (existingError) throw new Error("Could not check the calendar action.");
      if (existing?.external_id) {
        actionId = existing.id as string;
        const existingEvent = buildGoogleCalendarInsert(input, config.calendarId);
        const roxanneMeetingId = await persistCalendarMeeting(
          client,
          userId,
          input,
          {
            id: existing.external_id,
            startAt: existingEvent.startAt,
            endAt: existingEvent.endAt,
          },
        );
        const completedAt = new Date().toISOString();
        await client
          .from("actions")
          .update({
            status: "completed",
            executed_at: completedAt,
            error_message: null,
          })
          .eq("id", existing.id)
          .eq("user_id", userId);
        if (databaseFollowUpId) {
          const { error: followUpCompletionError } = await client
            .from("follow_ups")
            .update({ status: "completed", completed_at: completedAt })
            .eq("id", databaseFollowUpId)
            .eq("user_id", userId);
          if (followUpCompletionError) throw new Error("Could not complete the calendar follow-up.");
        }
        return NextResponse.json({
          event: {
            id: existing.external_id,
            htmlLink: null,
            summary: input.summary,
            startAt: existingEvent.startAt,
            endAt: existingEvent.endAt,
            timeZone: "Asia/Kuala_Lumpur",
            attendees: input.attendees,
          },
          roxanneMeetingId,
          duplicate: true,
        });
      }
      const actionPayload = {
        summary: input.summary,
        startAt: input.startAt,
        durationMinutes: 30,
        timeZone: "Asia/Kuala_Lumpur",
        attendees: input.attendees,
      };
      if (existing?.id) {
        actionId = existing.id as string;
        const { error } = await client
          .from("actions")
          .update({
            payload: actionPayload,
            status: "executing",
            approved_at: new Date().toISOString(),
            error_message: null,
          })
          .eq("id", actionId)
          .eq("user_id", userId);
        if (error) throw new Error("Could not update the calendar action.");
      } else {
        const { data: created, error } = await client
          .from("actions")
          .insert({
            user_id: userId,
            meeting_id: databaseMeetingId,
            follow_up_id: databaseFollowUpId,
            type: "calendar_event",
            provider: "google_calendar",
            payload: actionPayload,
            status: "executing",
            idempotency_key: idempotencyKey,
            approved_at: new Date().toISOString(),
          })
          .select("id")
          .single();
        if (error || !created) {
          throw new Error("Could not record the calendar action.");
        }
        actionId = created.id as string;
      }
    }

    const oauthClient = await createAuthorizedGoogleOAuthClient({
      config,
      client,
      userId,
    });
    const event = await createGoogleCalendarEvent(input, {
      oauthClient,
      calendarId: config.calendarId,
      eventId: googleEventId,
    });

    let roxanneMeetingId: string | null = null;
    if (client && userId && actionId) {
      const completedAt = new Date().toISOString();
      const { error: executionRecordError } = await client
        .from("actions")
        .update({
          status: "executing",
          external_id: event.id,
          error_message: null,
        })
        .eq("id", actionId)
        .eq("user_id", userId);
      if (executionRecordError) {
        throw new Error("The Calendar event was created but its result could not be recorded.");
      }
      roxanneMeetingId = await persistCalendarMeeting(client, userId, input, event);
      const { error: completionError } = await client
        .from("actions")
        .update({
          status: "completed",
          executed_at: completedAt,
          error_message: null,
        })
        .eq("id", actionId)
        .eq("user_id", userId);
      if (completionError) throw new Error("Could not finish the Calendar action log.");
      if (databaseFollowUpId) {
        const { error: followUpCompletionError } = await client
          .from("follow_ups")
          .update({ status: "completed", completed_at: completedAt })
          .eq("id", databaseFollowUpId)
          .eq("user_id", userId);
        if (followUpCompletionError) throw new Error("Could not complete the calendar follow-up.");
      }
    }

    return NextResponse.json(
      { event, roxanneMeetingId, duplicate: false },
      { status: 201 },
    );
  } catch (error) {
    if (client && actionId && ownerUserId) {
      await client
        .from("actions")
        .update({
          status: "failed",
          error_message: "Google Calendar action failed.",
        })
        .eq("id", actionId)
        .eq("user_id", ownerUserId);
    }
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: "Invalid calendar invitation.", issues: error.flatten() },
        { status: 400 },
      );
    }
    if (error instanceof GoogleCalendarProviderError) {
      return NextResponse.json(
        { error: error.message },
        { status: providerStatus(error) },
      );
    }
    return NextResponse.json(
      { error: "The calendar invitation could not be created." },
      { status: 500 },
    );
  }
}
