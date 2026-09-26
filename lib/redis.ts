import "server-only";

import { createHash } from "node:crypto";
import { Redis } from "@upstash/redis";
import { env } from "@/lib/env";

let cached: Redis | null | undefined;
export const PROCESSING_WAKEUP_CHANNEL = "quipus:processing:wakeup";
export const PROCESSING_EVENTS_CHANNEL = "quipus:processing:events";

export function getRedis(): Redis | null {
  if (cached !== undefined) return cached;
  const runtime = env();
  const url = runtime.UPSTASH_REDIS_REST_URL || runtime.KV_REST_API_URL;
  const token = runtime.UPSTASH_REDIS_REST_TOKEN || runtime.KV_REST_API_TOKEN;
  if (!url || !token) {
    cached = null;
    return null;
  }
  cached = new Redis({ url, token });
  return cached;
}

function processingKey(userId: string, recordingId: string) {
  return `processing:${userId}:${recordingId}`;
}

export async function setProcessingState(userId: string, recordingId: string, state: Record<string, unknown>) {
  const redis = getRedis();
  if (!redis) return false;
  try {
    const value = { ...state, recordingId, updatedAt: new Date().toISOString() };
    await redis.set(processingKey(userId, recordingId), value, { ex: 60 * 60 });
    await redis.publish(PROCESSING_EVENTS_CHANNEL, JSON.stringify(value));
    return true;
  } catch { return false; }
}

/**
 * Best-effort low-latency signal. PostgreSQL remains the durable queue, so a
 * missing Redis configuration or dropped pub/sub message cannot lose a job.
 */
export async function publishProcessingWakeup(input: {
  sessionId: string;
  userId: string;
}) {
  const redis = getRedis();
  if (!redis) return false;
  try {
    await redis.publish(PROCESSING_WAKEUP_CHANNEL, JSON.stringify({
      ...input,
      queuedAt: new Date().toISOString(),
    }));
    return true;
  } catch {
    return false;
  }
}

export async function getProcessingState(userId: string, recordingId: string) {
  const redis = getRedis();
  if (!redis) return null;
  try { return await redis.get<Record<string, unknown>>(processingKey(userId, recordingId)); }
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

function companyResearchKey(company: string) {
  const identity = company.normalize("NFKC").trim().toLocaleLowerCase("en");
  return `research:company:${createHash("sha256").update(identity).digest("hex")}`;
}

export async function getCachedCompanyResearch<T>(company: string): Promise<T | null> {
  const redis = getRedis();
  if (!redis) return null;
  try { return await redis.get<T>(companyResearchKey(company)); }
  catch { return null; }
}

export async function cacheCompanyResearch(company: string, research: unknown) {
  const redis = getRedis();
  if (!redis) return false;
  try {
    await redis.set(companyResearchKey(company), research, { ex: 60 * 60 * 24 * 7 });
    return true;
  } catch { return false; }
}

export async function redisHealth() {
  const redis = getRedis();
  if (!redis) return { configured: false, reachable: false };
  try { return { configured: true, reachable: (await redis.ping()) === "PONG" }; }
  catch { return { configured: true, reachable: false }; }
}
