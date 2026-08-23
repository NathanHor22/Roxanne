import { NextResponse } from "next/server";
import { requireOwnerSession } from "@/lib/api-security";
import { integrationStatus } from "@/lib/env";
import { env } from "@/lib/env";
import { redisHealth } from "@/lib/redis";
import { getServerSupabase, resolveDemoUserId } from "@/lib/supabase/server";
import { parseWhatsAppStatus, requestWhatsAppRelay } from "@/lib/whatsapp-relay";

export const dynamic = "force-dynamic";

export async function GET() {
  const authError = await requireOwnerSession();
  if (authError) return authError;
  const integrations = integrationStatus();
  const runtime = env();
  const redis = await redisHealth();
  integrations.redis = redis.reachable;

  const client = getServerSupabase();
  if (client) {
    const userId = await resolveDemoUserId(client).catch(() => null);
    if (userId) {
      const { data } = await client.from("provider_connections").select("provider").eq("user_id", userId).eq("provider", "google").maybeSingle();
      if (data) integrations.google = true;
    }
  }

  const whatsappRelay = Boolean(
    runtime.WHATSAPP_RELAY_URL && runtime.WHATSAPP_RELAY_TOKEN,
  );
  if (whatsappRelay) {
    try {
      const status = parseWhatsAppStatus(await requestWhatsAppRelay("/status"));
      integrations.whatsapp = status.status === "connected";
    } catch { integrations.whatsapp = false; }
  }
  return NextResponse.json({
    integrations: { ...integrations, whatsappRelay },
    redis,
    checkedAt: new Date().toISOString(),
  });
}
