import { createHash } from "node:crypto";
import { google } from "googleapis";
import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createAuthorizedGoogleOAuthClient } from "./providers/google-calendar";

export const GMAIL_SEND_SCOPE = "https://www.googleapis.com/auth/gmail.send";
export const emailActionSchema = z.object({
  followUpId: z.string().uuid(), recipient: z.string().trim().email().max(254),
  subject: z.string().trim().min(1).max(240), body: z.string().trim().min(1).max(2000), approved: z.literal(true),
}).strict();
export function encodeEmail(input: z.infer<typeof emailActionSchema>) {
  const parsed = emailActionSchema.parse(input);
  const raw = [`To: ${parsed.recipient}`, `Subject: =?UTF-8?B?${Buffer.from(parsed.subject).toString("base64")}?=`,
    "MIME-Version: 1.0", "Content-Type: text/plain; charset=UTF-8", "Content-Transfer-Encoding: base64", "",
    Buffer.from(parsed.body).toString("base64").match(/.{1,76}/gu)!.join("\r\n")].join("\r\n");
  return Buffer.from(raw).toString("base64url");
}
export async function sendApprovedEmail(client: SupabaseClient, userId: string, raw: unknown) {
  const input = emailActionSchema.parse(raw);
  const { data: task, error } = await client.from("follow_ups").select("id,meeting_id,type,status,draft")
    .eq("id", input.followUpId).eq("user_id", userId).maybeSingle();
  if (error || !task || task.type !== "email" || task.status === "dismissed") throw new Error("Email follow-up was not found.");
  const key = `email:${createHash("sha256").update(`${userId}\0${task.id}\0${input.recipient}\0${input.subject}\0${input.body}`).digest("hex")}`;
  const { data: prior, error: priorError } = await client.from("actions").select("id,idempotency_key,status,external_id")
    .eq("user_id", userId).eq("follow_up_id", task.id).eq("type", "send_email").maybeSingle();
  if (priorError) throw priorError;
  if (prior) {
    if (prior.idempotency_key === key && prior.status === "completed") {
      const { error: repairError } = await client.from("follow_ups").update({ status: "completed" }).eq("id", task.id).eq("user_id", userId);
      if (repairError) throw new Error("Gmail sent this email, but the follow-up status could not be saved. Refresh to retry saving it.");
      return { id: prior.external_id, duplicate: true };
    }
    throw new Error("This email was already submitted. Check Gmail Sent before trying again; delivery may have succeeded.");
  }
  if (task.status === "completed") throw new Error("This follow-up is already completed.");
  const { data: connection } = await client.from("provider_connections").select("scopes").eq("user_id", userId).eq("provider", "google").maybeSingle();
  if (!connection?.scopes?.includes(GMAIL_SEND_SCOPE)) throw new Error("Connect Gmail in Settings before sending email.");
  const auth = await createAuthorizedGoogleOAuthClient({ client, userId });
  const { data: action, error: actionError } = await client.from("actions").insert({
    user_id: userId, meeting_id: task.meeting_id, follow_up_id: task.id, type: "send_email", provider: "gmail",
    payload: input, status: "executing", approved_at: new Date().toISOString(), idempotency_key: key,
  }).select("id").single();
  if (actionError || !action) throw new Error("This email may already be queued. Refresh before retrying.");
  try {
    // Gmail has no idempotency key for messages.send. Never automatically retry
    // an ambiguous send; the durable action prevents a second submission.
    const sent = await google.gmail({ version: "v1", auth }).users.messages.send(
      { userId: "me", requestBody: { raw: encodeEmail(input) } }, { retry: false, timeout: 20000 });
    if (!sent.data.id) throw new Error("Gmail did not confirm delivery.");
    const { error: finishError } = await client.from("actions").update({ status: "completed", external_id: sent.data.id, executed_at: new Date().toISOString() }).eq("id", action.id).eq("user_id", userId);
    if (finishError) throw finishError;
    const { error: taskError } = await client.from("follow_ups").update({ status: "completed", completed_at: new Date().toISOString() }).eq("id", task.id).eq("user_id", userId);
    if (taskError) throw taskError;
    return { id: sent.data.id, duplicate: false };
  } catch {
    await client.from("actions").update({ error_message: "Delivery needs checking in Gmail Sent. Do not resend automatically." }).eq("id", action.id).eq("user_id", userId);
    throw new Error("I could not confirm the email result. Check Gmail Sent before resending.");
  }
}
