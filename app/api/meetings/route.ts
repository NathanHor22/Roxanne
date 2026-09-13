import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAuthenticatedSession, requireProductionPersistence } from "@/lib/api-security";
import { loadMeetings } from "@/lib/meetings-store";
import { getServerSupabase, resolveWorkspaceUserId } from "@/lib/supabase/server";
import type { Meeting } from "@/lib/types";

export const dynamic = "force-dynamic";

const createMeetingSchema = z.object({
  clientReference: z.string().trim().min(1).max(120),
  title: z.string().trim().min(1).max(200),
  startAt: z.string().datetime({ offset: true }),
  endAt: z.string().datetime({ offset: true }),
  contact: z.object({
    name: z.string().trim().min(1).max(120),
    company: z.string().trim().max(160).nullable().optional(),
    email: z.string().email().nullable().optional(),
    phone: z.string().max(40).nullable().optional(),
  }).optional(),
}).strict().refine((value) => Date.parse(value.endAt) > Date.parse(value.startAt), {
  message: "Meeting end must be after its start.", path: ["endAt"],
});

export async function GET() {
  const authError = await requireAuthenticatedSession();
  if (authError) return authError;
  const readinessError = requireProductionPersistence(Boolean(getServerSupabase()));
  if (readinessError) return readinessError;
  try {
    return NextResponse.json(await loadMeetings());
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Could not load meetings." }, { status: 500 });
  }
}

export async function POST(request: Request) {
  const authError = await requireAuthenticatedSession();
  if (authError) return authError;
  try {
    const input = createMeetingSchema.parse(await request.json());
    const contactId = input.contact ? randomUUID() : null;
    const meeting: Meeting = {
      id: input.clientReference, title: input.title, startAt: input.startAt, endAt: input.endAt,
      status: "upcoming", source: "manual",
      contacts: input.contact ? [{ id: contactId!, name: input.contact.name, company: input.contact.company || null, email: input.contact.email || null, phone: input.contact.phone || null }] : [],
    };
    const client = getServerSupabase();
    const readinessError = requireProductionPersistence(Boolean(client));
    if (readinessError) return readinessError;
    if (!client) return NextResponse.json({ meeting, persisted: false });
    const userId = await resolveWorkspaceUserId(client);
    if (!userId) throw new Error("No Supabase user is available.");
    if (input.contact) {
      const { error } = await client.from("contacts").insert({ id: contactId, user_id: userId, name: input.contact.name, company: input.contact.company || null, email: input.contact.email || null, phone: input.contact.phone || null });
      if (error) throw new Error(error.message);
    }
    const { data: row, error } = await client.from("meetings").insert({ user_id: userId, client_reference: input.clientReference, title: input.title, start_at: input.startAt, end_at: input.endAt, status: "upcoming", source: "manual" }).select("id").single();
    if (error || !row) throw new Error(error?.message || "Could not save meeting.");
    if (contactId) {
      const { error: linkError } = await client.from("meeting_contacts").insert({ meeting_id: row.id, contact_id: contactId, is_primary: true });
      if (linkError) throw new Error(linkError.message);
    }
    return NextResponse.json({ meeting, persisted: true }, { status: 201 });
  } catch (error) {
    const status = error instanceof z.ZodError ? 400 : 500;
    return NextResponse.json({ error: error instanceof Error ? error.message : "Could not create meeting." }, { status });
  }
}
