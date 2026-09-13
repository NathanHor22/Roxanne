import { NextResponse } from "next/server";
import { z } from "zod";

import { requireAuthenticatedSession, requireProductionPersistence } from "@/lib/api-security";
import { getServerSupabase, resolveWorkspaceUserId } from "@/lib/supabase/server";
import {
  localFollowUpPatchResult,
  parseFollowUpPatch,
} from "./follow-up-update";

export const runtime = "nodejs";

const uuidSchema = z.string().uuid();

function json(body: unknown, init?: ResponseInit) {
  const response = NextResponse.json(body, init);
  response.headers.set("cache-control", "no-store");
  return response;
}

export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const authError = await requireAuthenticatedSession();
  if (authError) return authError;
  try {
    const params = await context.params;
    const { id, status, schedule } = parseFollowUpPatch(params.id, await request.json());
    if (id.startsWith("sample:")) return json({ error: "Sample changes belong in the sample workspace." }, { status: 400 });
    const completedAt = status === "completed" ? new Date().toISOString() : null;
    const client = getServerSupabase();
    const readinessError = requireProductionPersistence(Boolean(client));
    if (readinessError) return readinessError;

    // Seed IDs have intentionally human-readable values. There is no durable
    // row to mutate in local mode, so acknowledge the optimistic UI transition
    // without pretending it was persisted.
    if (!client || !uuidSchema.safeParse(id).success) {
      if (process.env.NODE_ENV === "production") return json({ error: "The follow-up could not be found." }, { status: 404 });
      return json(localFollowUpPatchResult(id, status || "pending"));
    }

    const userId = await resolveWorkspaceUserId(client);
    if (!userId) {
      return json({ error: "The follow-up could not be found." }, { status: 404 });
    }

    const { data, error } = await client
      .from("follow_ups")
      .update({ ...(status ? { status, completed_at: completedAt } : {}), ...(schedule ? { schedule_details: schedule } : {}) })
      .eq("id", id)
      .eq("user_id", userId)
      .select("id,status,completed_at")
      .maybeSingle();
    if (error) throw new Error("Could not update the follow-up.");
    if (!data) {
      // A service-role client bypasses RLS, so the explicit user filter and a
      // non-revealing 404 are both required here.
      return json({ error: "The follow-up could not be found." }, { status: 404 });
    }

    return json({
      ok: true,
      id: data.id,
      status: data.status,
      completedAt: data.completed_at,
      persisted: true,
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return json(
        { error: "Invalid follow-up update.", issues: error.flatten() },
        { status: 400 },
      );
    }
    return json(
      { error: error instanceof Error ? error.message : "Could not update the follow-up." },
      { status: 500 },
    );
  }
}
