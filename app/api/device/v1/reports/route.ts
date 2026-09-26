import { NextResponse } from "next/server";
import { z } from "zod";

import { deviceReportManifest } from "@/lib/device-report-session";
import { authenticateLantern } from "@/lib/lantern-device-auth";
import { getServerSupabase } from "@/lib/supabase/server";

export const runtime = "nodejs";

const schema = z.object({ limit: z.number().int().min(1).max(5).default(5) }).strict();

export async function POST(request: Request) {
  const client = getServerSupabase();
  if (!client) return NextResponse.json({ error: "Quipus service is unavailable." }, { status: 503 });
  const device = await authenticateLantern(request, client);
  if (!device) return NextResponse.json({ error: "Device credential is invalid or revoked." }, { status: 403 });
  try {
    const input = schema.parse(await request.json());
    const reports = await deviceReportManifest(client, device.userId, input.limit);
    return NextResponse.json({ reports }, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    console.error("[device-reports]", error);
    return NextResponse.json(
      { error: error instanceof z.ZodError ? "Invalid report request." : "Reports are unavailable." },
      { status: error instanceof z.ZodError ? 400 : 502, headers: { "cache-control": "no-store" } },
    );
  }
}
