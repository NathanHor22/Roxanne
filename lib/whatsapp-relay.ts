import { NextResponse } from "next/server";
import { z } from "zod";
import { env } from "@/lib/env";

export const WHATSAPP_OWNER_PHONE = "601154444038";

const DEFAULT_TIMEOUT_MS = 8_000;
const MAX_RELAY_RESPONSE_BYTES = 1_500_000;
const SAFE_UPSTREAM_STATUSES = new Set([
  400, 401, 403, 404, 409, 413, 422, 429, 500, 502, 503, 504,
]);

const statusSchema = z.object({
  status: z.enum([
    "starting",
    "qr_ready",
    "connected",
    "disconnected",
    "logged_out",
    "error",
  ]),
  phone: z.string().trim().max(24).nullable(),
  since: z.string().datetime({ offset: true }).nullable(),
  qrAvailable: z.boolean(),
  reconnectAttempt: z.number().int().min(0).max(1_000),
});

const qrSchema = z.object({
  qr: z.string().startsWith("data:image/png;base64,").max(MAX_RELAY_RESPONSE_BYTES),
});

const pairSchema = z.object({
  code: z.string().regex(/^\d{4}(?:-?\d{4})?$/u),
  phone: z.literal(WHATSAPP_OWNER_PHONE),
});

const disconnectSchema = z.object({ ok: z.literal(true) });

export type WhatsAppRelayStatus = z.infer<typeof statusSchema>;
export type WhatsAppQr = z.infer<typeof qrSchema>;
export type WhatsAppPairingCode = z.infer<typeof pairSchema>;

export class WhatsAppRelayError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = "WhatsAppRelayError";
    this.status = status;
  }
}

interface RelayConfiguration {
  url: string;
  token: string;
}

interface RelayDependencies {
  configuration?: RelayConfiguration;
  fetcher?: typeof fetch;
  timeoutMs?: number;
}

type RelayPath = "/status" | "/qr" | "/pair" | "/disconnect" | "/send-report";

function relayConfiguration(override?: RelayConfiguration): RelayConfiguration {
  if (override) return override;
  const runtime = env();
  if (!runtime.WHATSAPP_RELAY_URL || !runtime.WHATSAPP_RELAY_TOKEN) {
    throw new WhatsAppRelayError(
      503,
      "The persistent WhatsApp relay is not connected yet.",
    );
  }
  return { url: runtime.WHATSAPP_RELAY_URL, token: runtime.WHATSAPP_RELAY_TOKEN };
}

function safeUpstreamStatus(status: number): number {
  return SAFE_UPSTREAM_STATUSES.has(status) ? status : 502;
}

function safeUpstreamMessage(value: unknown, token: string): string {
  const fallback = "The WhatsApp relay rejected the request.";
  if (typeof value !== "string") return fallback;
  const message = value.replace(/[\u0000-\u001f\u007f]/gu, " ").trim();
  if (!message || message.length > 300 || message.includes(token)) return fallback;
  return message;
}

function parseJson(text: string): unknown {
  if (!text) return {};
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return null;
  }
}

/**
 * Calls the persistent worker without ever making its bearer credential available
 * to browser code. Callers must whitelist the returned shape before responding.
 */
export async function requestWhatsAppRelay(
  path: RelayPath,
  options: { method?: "GET" | "POST"; body?: unknown } = {},
  dependencies: RelayDependencies = {},
): Promise<unknown> {
  const configuration = relayConfiguration(dependencies.configuration);
  const fetcher = dependencies.fetcher ?? fetch;
  const timeoutMs = dependencies.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  try {
    const response = await fetcher(new URL(path, configuration.url), {
      method: options.method ?? "GET",
      headers: {
        accept: "application/json",
        authorization: `Bearer ${configuration.token}`,
        ...(options.body === undefined ? {} : { "content-type": "application/json" }),
      },
      ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
      cache: "no-store",
      redirect: "error",
      signal: AbortSignal.timeout(timeoutMs),
    });
    const text = await response.text();
    if (Buffer.byteLength(text, "utf8") > MAX_RELAY_RESPONSE_BYTES) {
      throw new WhatsAppRelayError(502, "The WhatsApp relay returned an invalid response.");
    }
    const payload = parseJson(text);
    if (!response.ok) {
      const error =
        payload && typeof payload === "object" && !Array.isArray(payload)
          ? (payload as Record<string, unknown>).error
          : undefined;
      throw new WhatsAppRelayError(
        safeUpstreamStatus(response.status),
        safeUpstreamMessage(error, configuration.token),
      );
    }
    if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
      throw new WhatsAppRelayError(502, "The WhatsApp relay returned an invalid response.");
    }
    return payload;
  } catch (error) {
    if (error instanceof WhatsAppRelayError) throw error;
    if (
      error instanceof Error &&
      (error.name === "TimeoutError" || error.name === "AbortError")
    ) {
      throw new WhatsAppRelayError(504, "The WhatsApp relay timed out.");
    }
    throw new WhatsAppRelayError(502, "The WhatsApp relay could not be reached.");
  }
}

function parseRelayPayload<T>(schema: z.ZodType<T>, payload: unknown): T {
  const parsed = schema.safeParse(payload);
  if (!parsed.success) {
    throw new WhatsAppRelayError(502, "The WhatsApp relay returned an invalid response.");
  }
  return parsed.data;
}

export function parseWhatsAppStatus(payload: unknown): WhatsAppRelayStatus {
  return parseRelayPayload(statusSchema, payload);
}

export function parseWhatsAppQr(payload: unknown): WhatsAppQr {
  return parseRelayPayload(qrSchema, payload);
}

export function parseWhatsAppPairingCode(payload: unknown): WhatsAppPairingCode {
  return parseRelayPayload(pairSchema, payload);
}

export function parseWhatsAppDisconnect(payload: unknown): { ok: true } {
  return parseRelayPayload(disconnectSchema, payload);
}

export function normalizeOwnerPairPhone(input: unknown): string {
  if (input === undefined || input === null || input === "") return WHATSAPP_OWNER_PHONE;
  if (typeof input !== "string") {
    throw new WhatsAppRelayError(400, "A Malaysian mobile number is required.");
  }
  let digits = input.replace(/\D/gu, "");
  if (digits.startsWith("00")) digits = digits.slice(2);
  if (digits.startsWith("0")) digits = `6${digits}`;
  else if (digits.startsWith("1")) digits = `60${digits}`;
  if (digits !== WHATSAPP_OWNER_PHONE) {
    throw new WhatsAppRelayError(
      403,
      "This build can pair only with the owner-approved WhatsApp number.",
    );
  }
  return WHATSAPP_OWNER_PHONE;
}

export function whatsappNoStoreJson(body: unknown, status = 200): NextResponse {
  return NextResponse.json(body, {
    status,
    headers: {
      "cache-control": "no-store, max-age=0",
      pragma: "no-cache",
      "x-content-type-options": "nosniff",
    },
  });
}

export function whatsappRelayErrorResponse(error: unknown): NextResponse {
  if (error instanceof WhatsAppRelayError) {
    return whatsappNoStoreJson({ error: error.message }, error.status);
  }
  return whatsappNoStoreJson({ error: "WhatsApp relay request failed." }, 500);
}
