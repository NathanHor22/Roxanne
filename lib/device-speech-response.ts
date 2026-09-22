import type { SupabaseClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";
import { splitSpeechPages } from "./device-briefing";
import { createOpenAISpeech } from "./providers/openai-speech";
import type { AuthenticatedLantern } from "./lantern-device-auth";

export async function deviceSpeechPage(client: SupabaseClient, device: AuthenticatedLantern,
  input: { speech?: string; token?: string; reportId?: string; page?: number; intent?: string; reportContextId?: string }) {
  let id = input.reportId;
  let pages: string[];
  let token = input.token;
  const page = input.page || 0;
  if (id) {
    const { data, error } = await client.from("device_reports").select("pages,review_token")
      .eq("id", id).eq("user_id", device.userId).eq("device_id", device.id)
      .gt("expires_at", new Date().toISOString()).maybeSingle();
    if (error || !data) throw new Error("Report has expired. Request a new report.");
    pages = data.pages;
    token = data.review_token || undefined;
  } else {
    pages = splitSpeechPages(input.speech || "Nothing to report.");
    if (pages.length > 1) {
      const { data, error } = await client.from("device_reports").insert({
        user_id: device.userId, device_id: device.id, pages, review_token: token || null,
      }).select("id").single();
      if (error || !data) throw new Error("Could not prepare report playback.");
      id = data.id;
    }
  }
  if (!pages[page]) throw new Error("Report page is invalid.");
  const audio = await createOpenAISpeech(pages[page]);
  const more = page + 1 < pages.length;
  return new NextResponse(audio.body, { headers: {
    "cache-control": "no-store", "content-type": "audio/pcm", "x-lantern-audio-rate": "24000",
    ...(input.intent ? { "x-lantern-command": input.intent } : {}),
    ...(input.reportContextId ? { "x-quipus-context-id": input.reportContextId } : {}),
    ...(id ? { "x-quipus-playback-id": id, "x-quipus-playback-page": String(page) } : {}),
    ...(more ? { "x-lantern-report-id": id!, "x-lantern-report-page": String(page + 1) } : {}),
    ...(!more && token ? { "x-lantern-review-token": token } : {}),
  } });
}
