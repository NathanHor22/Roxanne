import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { meetingReportDetails, splitSpeechPages } from "./device-briefing";
import { env } from "./env";
import { requestWhatsAppRelay } from "./whatsapp-relay";

export const deliveryPhone = z.string().trim().transform(value => {
  const digits = value.replace(/[\s()+-]/gu, "");
  return digits.startsWith("0") ? `6${digits}` : digits;
}).pipe(z.string().regex(/^[1-9]\d{7,14}$/u));

export async function queueMeetingDelivery(client: SupabaseClient, userId: string, reference: string, phone?: string) {
  // This prototype relay is bound to one explicitly configured account. Other
  // users' conversations must never be forwarded to the prototype owner's phone.
  if (userId !== process.env.WHATSAPP_OWNER_USER_ID) {
    if (phone) throw new Error("WhatsApp delivery is not configured for this account.");
    return;
  }
  const { data: preference } = await client.from("meeting_delivery_preferences").select("enabled,phone").eq("user_id", userId).maybeSingle();
  if (!phone && !preference?.enabled) return;
  const recipient = deliveryPhone.parse(phone || preference!.phone);
  const { meetingId, payload } = await meetingDeliveryPayload(client, userId, reference);
  const { error: queueError } = await client.from("meeting_deliveries").upsert({
    user_id: userId, meeting_id: meetingId, phone: recipient, kind: phone ? "client" : "self", payload,
  }, { onConflict: "user_id,meeting_id,phone", ignoreDuplicates: true });
  if (queueError) throw new Error("Could not queue the approved report.");
}

async function meetingDeliveryPayload(client: SupabaseClient, userId: string, reference: string) {
  let query = client.from("meetings").select("id,title,start_at,recording_id,status").eq("user_id", userId);
  query = z.string().uuid().safeParse(reference).success ? query.eq("id", reference) : query.eq("client_reference", reference);
  const { data: meeting, error } = await query.maybeSingle();
  if (error || !meeting || meeting.status !== "ready") throw new Error("The completed meeting could not be found.");
  const [recording, transcript, insight, tasks, commitments] = await Promise.all([
    client.from("recordings").select("storage_path").eq("id", meeting.recording_id).eq("user_id", userId).single(),
    client.from("transcripts").select("text,segments").eq("recording_id", meeting.recording_id).eq("user_id", userId).single(),
    client.from("meeting_insights").select("*").eq("meeting_id", meeting.id).eq("user_id", userId).single(),
    client.from("follow_ups").select("description,status").eq("meeting_id", meeting.id).eq("user_id", userId),
    client.from("commitments").select("description,owner_type,due_at,status").eq("meeting_id", meeting.id).eq("user_id", userId),
  ]);
  if ([recording, transcript, insight, tasks, commitments].some(r => r.error) || !recording.data?.storage_path) throw new Error("The original audio and transcript are not ready to share.");
  const summary = `${meeting.title}\n${new Intl.DateTimeFormat("en-MY", { timeZone: "Asia/Kuala_Lumpur", dateStyle: "full", timeStyle: "short" }).format(new Date(meeting.start_at))} (Malaysia time)\n\n${meetingReportDetails({ title: meeting.title, keyPoints: insight.data.key_points || [], intent: insight.data.intent,
      wants: insight.data.wants, concern: insight.data.concern, promised: insight.data.promised, nextAction: insight.data.next_action,
      commitments: (commitments.data || []).map(c => `${c.owner_type}: ${c.description}${c.due_at ? `, due ${c.due_at}` : ""}`)
  }).map(detail => `- ${detail}`).join("\n")}\n\nAction items:\n${(tasks.data || []).map(t => `- ${t.description} (${t.status})`).join("\n") || "None identified."}`;
  const segments = transcript.data?.segments as Array<{ speaker: string; text: string; startSeconds?: number }>;
  const fullTranscript = segments?.length ? segments.map(s => `[${s.startSeconds === undefined ? "" : `${Math.floor(s.startSeconds / 60)}:${String(Math.floor(s.startSeconds % 60)).padStart(2, "0")}`}] ${s.speaker}: ${s.text}`).join("\n\n") : transcript.data?.text || "";
  return { meetingId: meeting.id, payload: { title: meeting.title, summary, transcript: fullTranscript, storagePath: recording.data.storage_path } };
}

export async function deliverNextMeeting(client: SupabaseClient) {
  if (!env().WHATSAPP_RELAY_URL || !env().WHATSAPP_RELAY_TOKEN) return;
  const { data, error } = await client.rpc("claim_meeting_delivery");
  if (error) throw error;
  const job = data?.[0];
  if (!job) return;
  try {
    if (job.user_id !== process.env.WHATSAPP_OWNER_USER_ID || job.attempts > 5) throw new Error("Delivery needs account setup or manual retry.");
    let payload = job.payload as { title: string; summary: string; transcript: string; storagePath: string };
    if (!payload.storagePath) {
      payload = (await meetingDeliveryPayload(client, job.user_id, job.meeting_id)).payload;
      const { error: snapshotError } = await client.from("meeting_deliveries").update({ payload }).eq("id", job.id).eq("lease_token", job.lease_token);
      if (snapshotError) throw snapshotError;
    }
    const deadline = Date.now() + 240000;
    const send = async (part: string, content: Record<string, unknown>) => {
      const remaining = deadline - Date.now();
      if (remaining < 15000) throw new Error("Delivery will resume on the next attempt.");
      const result = await requestWhatsAppRelay("/send-report", { method: "POST", body: {
        to: job.phone, approved: true, idempotencyKey: `report:${job.id}:${part}`, ...content,
      } }, { timeoutMs: Math.min(content.document ? 90000 : 20000, remaining) }) as { ok?: boolean; id?: string };
      if (!result.ok || !result.id) throw new Error("WhatsApp did not confirm delivery.");
    };
    for (const [index, text] of splitSpeechPages(payload.summary, 3500).entries()) await send(`summary-${index}`, { text });
    await send("transcript", { document: { fileName: "Full transcript.txt", mimeType: "text/plain", base64: Buffer.from(payload.transcript).toString("base64") } });
    const { data: signed, error: signingError } = await client.storage.from("recordings").createSignedUrl(payload.storagePath, 600);
    if (signingError || !signed) throw new Error("Original recording is unavailable.");
    await send("audio", { document: { fileName: "Original recording.wav", mimeType: "audio/wav", url: signed.signedUrl } });
    const { error: saved } = await client.from("meeting_deliveries").update({ state: "sent", sent_at: new Date().toISOString(), lease_until: null, last_error: null })
      .eq("id", job.id).eq("lease_token", job.lease_token);
    if (saved) throw saved;
  } catch {
    await client.from("meeting_deliveries").update({ state: job.attempts >= 5 ? "failed" : "queued", lease_until: null,
      available_at: new Date(Date.now() + Math.min(job.attempts * 60000, 300000)).toISOString(), last_error: "WhatsApp delivery was not confirmed. Check the relay connection." })
      .eq("id", job.id).eq("lease_token", job.lease_token);
  }
}
