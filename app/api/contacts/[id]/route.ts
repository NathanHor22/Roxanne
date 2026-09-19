import { NextResponse } from "next/server";
import { z } from "zod";

import {
  requireAuthenticatedSession,
  requireProductionPersistence,
} from "@/lib/api-security";
import {
  getServerSupabase,
  resolveWorkspaceUserId,
} from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

const contactUpdateSchema = z
  .object({
    name: z.string().trim().min(1).max(120),
    company: z.string().trim().max(160).nullable(),
    role: z.string().trim().max(120).nullable(),
    email: z.string().trim().email().max(320).nullable(),
  })
  .strict();

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const authError = await requireAuthenticatedSession();
  if (authError) return authError;

  try {
    const { id } = await params;
    const contactId = z.string().uuid().parse(id);
    const input = contactUpdateSchema.parse(await request.json());
    const client = getServerSupabase();
    const readinessError = requireProductionPersistence(
      Boolean(client),
      "Supabase is required to update contacts.",
    );
    if (readinessError) return readinessError;
    if (!client)
      return NextResponse.json(
        { error: "Contact storage is unavailable." },
        { status: 503 },
      );

    const userId = await resolveWorkspaceUserId(client);
    if (!userId)
      return NextResponse.json(
        { error: "Authentication required." },
        { status: 401 },
      );

    const { data, error } = await client
      .from("contacts")
      .update({
        ...input,
        updated_at: new Date().toISOString(),
      })
      .eq("id", contactId)
      .eq("user_id", userId)
      .select("id,name,company,role,email,phone")
      .maybeSingle();

    if (error) throw error;
    if (!data)
      return NextResponse.json(
        { error: "Contact not found." },
        { status: 404 },
      );

    return NextResponse.json(
      { contact: data },
      { headers: { "cache-control": "no-store" } },
    );
  } catch (error) {
    const status = error instanceof z.ZodError ? 400 : 500;
    if (status === 500) console.error("[contact:update]", error);
    return NextResponse.json(
      {
        error:
          error instanceof z.ZodError
            ? error.issues[0]?.message || "Invalid contact details."
            : "The contact could not be updated.",
      },
      { status, headers: { "cache-control": "no-store" } },
    );
  }
}
