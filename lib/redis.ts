import "server-only";

import { Redis } from "@upstash/redis";
import { env } from "@/lib/env";

let cached: Redis | null | undefined;

export function getRedis(): Redis | null {
  if (cached !== undefined) return cached;
  const runtime = env();
  if (!runtime.UPSTASH_REDIS_REST_URL || !runtime.UPSTASH_REDIS_REST_TOKEN) {
    cached = null;
    return null;
  }
  cached = new Redis({ url: runtime.UPSTASH_REDIS_REST_URL, token: runtime.UPSTASH_REDIS_REST_TOKEN });
  return cached;
}

export async function setProcessingState(recordingId: string, state: Record<string, unknown>) {
  const redis = getRedis();
  if (!redis) return false;
  try {
    await redis.set(`processing:${recordingId}`, { ...state, updatedAt: new Date().toISOString() }, { ex: 60 * 60 });
    return true;
  } catch { return false; }
}

export async function getProcessingState(recordingId: string) {
  const redis = getRedis();
  if (!redis) return null;
  try { return await redis.get<Record<string, unknown>>(`processing:${recordingId}`); }
  catch { return null; }
}

export async function rememberPerson(personId: string, memory: Record<string, unknown>) {
  const redis = getRedis();
  if (!redis) return false;
  try { await redis.set(`person:${personId}:recent`, memory, { ex: 60 * 60 * 24 * 30 }); return true; }
  catch { return false; }
}

export async function rememberSession(sessionId: string, context: Record<string, unknown>) {
  const redis = getRedis();
  if (!redis) return false;
  try { await redis.set(`session:${sessionId}`, context, { ex: 60 * 60 * 6 }); return true; }
  catch { return false; }
}

export async function redisHealth() {
  const redis = getRedis();
  if (!redis) return { configured: false, reachable: false };
  try { return { configured: true, reachable: (await redis.ping()) === "PONG" }; }
  catch { return { configured: true, reachable: false }; }
}
