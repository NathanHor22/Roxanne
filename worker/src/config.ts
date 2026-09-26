export interface WorkerConfig {
  databaseUrl: string;
  relayToken: string;
  authEncryptionKey: string;
  workspaceKey: string;
  redisUrl?: string;
  host: string;
  port: number;
}

function required(env: NodeJS.ProcessEnv, key: string): string {
  const value = env[key]?.trim();
  if (!value) throw new Error(`${key} environment variable is required.`);
  return value;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): WorkerConfig {
  if (env.LANTERN_APP_URL || env.PROCESSING_WORKER_SECRET) {
    if (!env.LANTERN_APP_URL || !env.PROCESSING_WORKER_SECRET || env.PROCESSING_WORKER_SECRET.length < 32) {
      throw new Error("Set LANTERN_APP_URL and a PROCESSING_WORKER_SECRET of at least 32 characters together.");
    }
    const app = new URL(env.LANTERN_APP_URL);
    if (app.protocol !== "https:" || app.username || app.password) throw new Error("LANTERN_APP_URL must be an HTTPS application URL.");
  }
  if (env.MEDIA_STORAGE_ORIGIN) {
    const storage = new URL(env.MEDIA_STORAGE_ORIGIN);
    if (storage.protocol !== "https:" || storage.username || storage.password || storage.pathname !== "/" || storage.search || storage.hash) {
      throw new Error("MEDIA_STORAGE_ORIGIN must be the HTTPS Supabase project origin, without a path.");
    }
  }
  let redisUrl: string | undefined;
  if (env.UPSTASH_REDIS_URL?.trim()) {
    const redis = new URL(env.UPSTASH_REDIS_URL.trim());
    const localRedis = redis.protocol === "redis:" && ["localhost", "127.0.0.1"].includes(redis.hostname);
    if (redis.protocol !== "rediss:" && !localRedis) {
      throw new Error("UPSTASH_REDIS_URL must use encrypted rediss:// (redis:// is allowed only for localhost)." );
    }
    redisUrl = redis.toString();
  }
  const databaseUrl = required(env, "DATABASE_URL");
  const relayToken = required(env, "WHATSAPP_RELAY_TOKEN");
  if (Buffer.byteLength(relayToken, "utf8") < 24) {
    throw new Error("WHATSAPP_RELAY_TOKEN must contain at least 24 bytes.");
  }

  const authEncryptionKey = required(env, "WHATSAPP_AUTH_ENCRYPTION_KEY");
  if (Buffer.byteLength(authEncryptionKey, "utf8") < 32) {
    throw new Error(
      "WHATSAPP_AUTH_ENCRYPTION_KEY must contain at least 32 bytes.",
    );
  }
  if (authEncryptionKey === relayToken) {
    throw new Error(
      "WHATSAPP_AUTH_ENCRYPTION_KEY must be separate from WHATSAPP_RELAY_TOKEN.",
    );
  }

  const workspaceKey = (env.WHATSAPP_WORKSPACE_KEY || "lantern").trim();
  if (!/^[A-Za-z0-9._:-]{1,80}$/u.test(workspaceKey)) {
    throw new Error("WHATSAPP_WORKSPACE_KEY contains unsupported characters.");
  }

  const port = Number(env.PORT || "3001");
  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new Error("PORT must be an integer between 1 and 65535.");
  }

  return {
    databaseUrl,
    relayToken,
    authEncryptionKey,
    workspaceKey,
    redisUrl,
    host: env.HOST?.trim() || "0.0.0.0",
    port,
  };
}
