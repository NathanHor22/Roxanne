import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import pino from "pino";
import { Redis } from "ioredis";
import { loadConfig } from "./config.js";
import {
  createDatabasePool,
  DeliveryStore,
  PostgresAuthStore,
} from "./database.js";
import {
  isValidBearerAuthorization,
  parseSendPayload,
  RequestError,
} from "./protocol.js";
import { WhatsAppWorker } from "./whatsapp.js";
import { parseDocument, reportRecipient } from "./media.js";

const logger = pino({
  level: process.env.LOG_LEVEL || "info",
  redact: ["req.headers.authorization", "authorization", "token"],
});
const MAX_BODY_BYTES = 2 * 1024 * 1024;
const PROCESSING_WAKEUP_CHANNEL = "quipus:processing:wakeup";

function json(
  response: ServerResponse,
  status: number,
  body: unknown,
): void {
  const payload = JSON.stringify(body);
  response.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(payload),
    "cache-control": "no-store",
    "x-content-type-options": "nosniff",
  });
  response.end(payload);
}

async function readJson(request: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let bytes = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    bytes += buffer.length;
    if (bytes > MAX_BODY_BYTES) {
      throw new RequestError(413, "Request body is too large.");
    }
    chunks.push(buffer);
  }
  if (chunks.length === 0) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown;
  } catch {
    throw new RequestError(400, "Request body must be valid JSON.");
  }
}

async function main(): Promise<void> {
  const config = loadConfig();
  const pool = createDatabasePool(config.databaseUrl);
  const worker = new WhatsAppWorker(
    new PostgresAuthStore(
      pool,
      config.workspaceKey,
      config.authEncryptionKey,
    ),
    new DeliveryStore(pool, config.workspaceKey),
    config.workspaceKey,
  );

  // Fail fast when the migration or credentials are wrong, before Railway marks ready.
  await pool.query("select 1 from public.roxanne_whatsapp_auth limit 1");
  await pool.query(
    `select lease_token, lease_expires_at, attempt_count, completed_at, updated_at
       from public.whatsapp_delivery_keys
      limit 1`,
  );

  const server = createServer(async (request, response) => {
    const startedAt = Date.now();
    const method = request.method || "GET";
    const pathname = new URL(request.url || "/", "http://worker.local").pathname;
    try {
      if (method === "GET" && pathname === "/health") {
        json(response, 200, {
          ok: true,
          service: "quipus-whatsapp-worker",
          uptimeSeconds: Math.floor(process.uptime()),
          whatsapp: worker.snapshot().status,
        });
        return;
      }

      if (!isValidBearerAuthorization(request.headers.authorization, config.relayToken)) {
        response.setHeader("www-authenticate", "Bearer");
        throw new RequestError(401, "Unauthorized.");
      }

      if (method === "GET" && pathname === "/status") {
        json(response, 200, worker.snapshot());
        return;
      }

      if (method === "GET" && pathname === "/qr") {
        const qr = worker.getQr();
        if (!qr) {
          throw new RequestError(
            404,
            "No QR code is available; the worker may be connected or still starting.",
          );
        }
        json(response, 200, { qr });
        return;
      }

      if (method === "POST" && pathname === "/pair") {
        const body = await readJson(request);
        const phone =
          body && typeof body === "object" && !Array.isArray(body)
            ? (body as Record<string, unknown>).phone
            : undefined;
        json(response, 200, await worker.requestPairingCode(phone));
        return;
      }

      if (method === "POST" && pathname === "/send") {
        const input = parseSendPayload(await readJson(request));
        const result = await worker.send(input.to, input.text, input.idempotencyKey);
        json(response, 200, { ok: true, ...result });
        return;
      }
      if (method === "POST" && pathname === "/send-report") {
        const body = await readJson(request) as Record<string, unknown>;
        if (!body || body.approved !== true || typeof body.idempotencyKey !== "string" || !/^[A-Za-z0-9._:-]{8,200}$/u.test(body.idempotencyKey)) throw new RequestError(400, "Report approval and delivery key are required.");
        const to = reportRecipient(body.to);
        const document = body.document ? parseDocument(body.document) : undefined;
        const text = typeof body.text === "string" ? body.text : "";
        if (!document && (!text.trim() || text.length > 4000)) throw new RequestError(400, "Report text is invalid.");
        json(response, 200, { ok: true, ...await worker.send(to, text, body.idempotencyKey, { approved: true, document }) });
        return;
      }

      if (method === "POST" && pathname === "/disconnect") {
        await worker.disconnect();
        json(response, 200, { ok: true });
        return;
      }

      throw new RequestError(404, "Route not found.");
    } catch (error) {
      const status = error instanceof RequestError ? error.status : 500;
      const message =
        error instanceof RequestError ? error.message : "Internal worker error.";
      if (status >= 500) logger.error({ err: error, method, pathname }, message);
      json(response, status, { error: message });
    } finally {
      logger.info({ method, pathname, status: response.statusCode, ms: Date.now() - startedAt });
    }
  });

  server.listen(config.port, config.host, () => {
    logger.info(
      { host: config.host, port: config.port, workspace: config.workspaceKey },
      "WhatsApp worker listening",
    );
    void worker.start();
  });

  let shuttingDown = false;
  let processingTimer: NodeJS.Timeout | undefined;
  let processingSubscriber: Redis | undefined;
  let kicking = false;
  if (process.env.LANTERN_APP_URL && process.env.PROCESSING_WORKER_SECRET) {
    const endpoint = new URL("/api/internal/process-recordings", process.env.LANTERN_APP_URL);
    if (endpoint.protocol !== "https:") throw new Error("LANTERN_APP_URL must use HTTPS.");
    const kick = async () => {
      if (kicking || shuttingDown) return;
      kicking = true;
      try {
        const response = await fetch(endpoint, { method: "POST", redirect: "error", signal: AbortSignal.timeout(15000), headers: { authorization: `Bearer ${process.env.PROCESSING_WORKER_SECRET}` } });
        if (!response.ok) logger.warn({ status: response.status }, "Recording queue wakeup failed");
        await response.body?.cancel();
      } catch { logger.warn("Recording queue wakeup could not reach Quipus"); }
      finally { kicking = false; }
    };
    processingTimer = setInterval(() => void kick(), 60000);
    processingTimer.unref();
    void kick();
    if (config.redisUrl) {
      processingSubscriber = new Redis(config.redisUrl, {
        lazyConnect: true,
        maxRetriesPerRequest: null,
        enableReadyCheck: true,
      });
      processingSubscriber.on("message", (channel: string) => {
        if (channel === PROCESSING_WAKEUP_CHANNEL) void kick();
      });
      processingSubscriber.on("error", (error: Error) => {
        logger.warn({ err: error }, "Redis processing wakeup listener is unavailable");
      });
      void processingSubscriber.connect()
        .then(() => processingSubscriber?.subscribe(PROCESSING_WAKEUP_CHANNEL))
        .then(() => logger.info("Redis processing wakeup listener connected"))
        .catch((error: unknown) => logger.warn({ err: error }, "Redis processing wakeup listener could not connect"));
    }
  }
  const shutdown = (signal: string) => {
    if (shuttingDown) return;
    shuttingDown = true;
    if (processingTimer) clearInterval(processingTimer);
    if (processingSubscriber) {
      processingSubscriber.removeAllListeners();
      processingSubscriber.disconnect(false);
    }
    logger.info({ signal }, "Shutting down WhatsApp worker");
    worker.shutdown();
    server.close(() => {
      void pool.end().finally(() => process.exit(0));
    });
    setTimeout(() => process.exit(1), 10_000).unref();
  };
  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT", () => shutdown("SIGINT"));
}

void main().catch((error: unknown) => {
  logger.fatal({ err: error }, "WhatsApp worker failed to start");
  process.exitCode = 1;
});
