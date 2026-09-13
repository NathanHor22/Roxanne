import { NextResponse } from "next/server";
import { RtcRole, RtcTokenBuilder } from "agora-token";
import { z } from "zod";
import { requireAuthenticatedSession } from "@/lib/api-security";
import { env } from "@/lib/env";

export const runtime = "nodejs";

const tokenRequestSchema = z.object({
  channel: z.string().trim().min(1).max(64).regex(/^[A-Za-z0-9_-]+$/u),
  uid: z.number().int().min(1).max(2_147_483_647),
}).strict();

export async function POST(request: Request) {
  const authError = await requireAuthenticatedSession();
  if (authError) return authError;
  try {
    const { channel, uid } = tokenRequestSchema.parse(await request.json());
    const runtime = env();
    const appId = runtime.NEXT_PUBLIC_AGORA_APP_ID?.trim();
    const certificate = runtime.AGORA_APP_CERTIFICATE?.trim();
    if (!appId) return NextResponse.json({ error: "Agora App ID is not configured." }, { status: 503 });
    if (!/^[0-9a-f]{32}$/iu.test(appId)) return NextResponse.json({ error: "Agora App ID must be 32 hexadecimal characters." }, { status: 500 });
    if (!certificate) {
      if (process.env.NODE_ENV === "production") {
        return NextResponse.json({ error: "Agora App Certificate is required in production." }, { status: 503 });
      }
      return NextResponse.json({ appId, channel, uid, token: null, secured: false });
    }
    if (!/^[0-9a-f]{32}$/iu.test(certificate)) return NextResponse.json({ error: "Agora App Certificate must be 32 hexadecimal characters." }, { status: 500 });

    const ttlSeconds = 60 * 60;
    const privilegeExpiresAt = Math.floor(Date.now() / 1000) + ttlSeconds;
    const token = RtcTokenBuilder.buildTokenWithUid(appId, certificate, channel, uid, RtcRole.PUBLISHER, ttlSeconds, ttlSeconds);
    if (!token) throw new Error("Agora did not issue an RTC token.");
    return NextResponse.json({ appId, channel, uid, token, secured: true, expiresAt: new Date(privilegeExpiresAt * 1000).toISOString() });
  } catch (error) {
    const status = error instanceof z.ZodError ? 400 : 500;
    return NextResponse.json({ error: error instanceof Error ? error.message : "Could not issue Agora credentials." }, { status });
  }
}
