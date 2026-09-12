import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
} from "node:crypto";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Credentials, OAuth2Client } from "google-auth-library";
import { google, type calendar_v3 } from "googleapis";
import { z } from "zod";

import { env } from "../env";

export const GOOGLE_CONNECTION_PROVIDER = "google";
export const GOOGLE_TIME_ZONE = "Asia/Kuala_Lumpur";
export const GOOGLE_CALENDAR_SCOPE =
  "https://www.googleapis.com/auth/calendar.events";
export const GOOGLE_CALENDAR_FREEBUSY_SCOPE =
  "https://www.googleapis.com/auth/calendar.freebusy";
export const GOOGLE_OAUTH_SCOPES = [
  GOOGLE_CALENDAR_SCOPE,
  GOOGLE_CALENDAR_FREEBUSY_SCOPE,
] as const;

const CIPHER_VERSION = "v1";
const CIPHER_ALGORITHM = "aes-256-gcm";
const CIPHER_IV_BYTES = 12;
const MIN_APPROVAL_SECRET_BYTES = 32;
const OAUTH_STATE_MAX_AGE_MS = 10 * 60_000;
const OAUTH_STATE_FUTURE_SKEW_MS = 60_000;

export type GoogleCalendarProviderErrorCode =
  | "configuration"
  | "not_connected"
  | "storage"
  | "invalid_credentials"
  | "oauth_state"
  | "calendar_failure";

export class GoogleCalendarProviderError extends Error {
  readonly code: GoogleCalendarProviderErrorCode;
  readonly status?: number;

  constructor(
    message: string,
    code: GoogleCalendarProviderErrorCode,
    status?: number,
  ) {
    super(message);
    this.name = "GoogleCalendarProviderError";
    this.code = code;
    this.status = status;
  }
}

export interface GoogleOAuthConfig {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  calendarId: string;
  approvalSecret?: string;
  refreshToken?: string;
}

export interface GoogleOAuthState {
  userId: string;
  returnTo: string;
  issuedAt: number;
  nonce: string;
}

export interface CalendarInsertClient {
  events: {
    insert(parameters: {
      calendarId: string;
      sendUpdates: "all";
      requestBody: calendar_v3.Schema$Event;
    }): Promise<{ data: calendar_v3.Schema$Event }>;
  };
}

export interface CalendarFreeBusyClient {
  freebusy: {
    query(parameters: {
      requestBody: calendar_v3.Schema$FreeBusyRequest;
    }): Promise<{ data: calendar_v3.Schema$FreeBusyResponse }>;
  };
}

export interface GoogleAvailabilitySlot {
  startAt: string;
  endAt: string;
}

export interface GoogleCalendarAvailability {
  date: string;
  period: "day" | "morning" | "afternoon";
  timeZone: typeof GOOGLE_TIME_ZONE;
  durationMinutes: 30;
  slots: GoogleAvailabilitySlot[];
}

const attendeeEmailSchema = z
  .string()
  .trim()
  .max(254)
  .email()
  .transform((value) => value.toLowerCase());

const startAtSchema = z.string().trim().min(1).max(40).refine(
  (value) => {
    try {
      normalizeMalaysiaDateTime(value);
      return true;
    } catch {
      return false;
    }
  },
  "startAt must be a valid ISO date-time, with an offset or as Malaysia local time.",
);

export const googleCalendarEventSchema = z
  .object({
    approved: z.literal(true),
    summary: z.string().trim().min(1).max(200),
    startAt: startAtSchema,
    durationMinutes: z.number().int().min(5).max(480).default(30),
    attendees: z.array(attendeeEmailSchema).min(1).max(20),
    description: z.string().trim().max(5000).optional(),
    location: z.string().trim().max(500).optional(),
    conferenceUrl: z.string().url().max(2000).optional(),
    idempotencyKey: z.string().trim().min(8).max(160).optional(),
    // Public Meeting.id values can be a database UUID or the stable
    // meetings.client_reference used by the local/demo calendar.
    meetingId: z.string().trim().min(1).max(120).optional(),
    clientReference: z.string().trim().min(1).max(120).optional(),
    followUpId: z.string().trim().min(1).max(120).optional(),
  })
  .strict()
  .superRefine((value, context) => {
    if (new Set(value.attendees).size !== value.attendees.length) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["attendees"],
        message: "Attendee email addresses must be unique.",
      });
    }
    if (
      value.meetingId &&
      value.clientReference &&
      value.meetingId !== value.clientReference
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["clientReference"],
        message: "meetingId and clientReference must identify the same meeting.",
      });
    }
  });

export const googleAvailabilitySchema = z
  .object({
    date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/u),
    period: z.enum(["day", "morning", "afternoon"]).default("day"),
  })
  .strict()
  .superRefine((value, context) => {
    try {
      normalizeMalaysiaDateTime(`${value.date}T00:00`);
    } catch {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["date"],
        message: "date must be a real calendar date.",
      });
    }
  });

export type GoogleCalendarEventInput = z.input<typeof googleCalendarEventSchema>;
export type ParsedGoogleCalendarEvent = z.output<typeof googleCalendarEventSchema>;

export interface CreatedGoogleCalendarEvent {
  id: string;
  htmlLink: string | null;
  summary: string;
  startAt: string;
  endAt: string;
  timeZone: typeof GOOGLE_TIME_ZONE;
  attendees: string[];
}

const storedCredentialsSchema = z
  .object({
    access_token: z.string().min(1).nullable().optional(),
    refresh_token: z.string().min(1).nullable().optional(),
    scope: z.string().min(1).optional(),
    token_type: z.string().min(1).nullable().optional(),
    expiry_date: z.number().int().positive().nullable().optional(),
    id_token: z.string().min(1).nullable().optional(),
  })
  .strict()
  .refine((value) => Boolean(value.access_token || value.refresh_token), {
    message: "The stored Google credentials contain no usable token.",
  });

const oauthStateSchema = z
  .object({
    userId: z.string().uuid(),
    returnTo: z.string().min(1).max(1000),
    issuedAt: z.number().int().nonnegative(),
    nonce: z.string().min(20).max(100),
  })
  .strict();

function requireNonEmpty(value: string | undefined, name: string): string {
  const trimmed = value?.trim();
  if (!trimmed) {
    throw new GoogleCalendarProviderError(
      `${name} is required for Google Calendar.`,
      "configuration",
    );
  }
  return trimmed;
}

export function getGoogleOAuthConfig(): GoogleOAuthConfig {
  const runtime = env();
  return {
    clientId: requireNonEmpty(runtime.GOOGLE_CLIENT_ID, "GOOGLE_CLIENT_ID"),
    clientSecret: requireNonEmpty(
      runtime.GOOGLE_CLIENT_SECRET,
      "GOOGLE_CLIENT_SECRET",
    ),
    redirectUri: requireNonEmpty(
      runtime.GOOGLE_REDIRECT_URI,
      "GOOGLE_REDIRECT_URI",
    ),
    calendarId: runtime.GOOGLE_CALENDAR_ID.trim() || "primary",
    approvalSecret: runtime.ACTION_APPROVAL_SECRET?.trim() || undefined,
    refreshToken: runtime.GOOGLE_REFRESH_TOKEN?.trim() || undefined,
  };
}

export function requireApprovalSecret(secret: string | undefined): string {
  const value = secret?.trim();
  if (!value || Buffer.byteLength(value, "utf8") < MIN_APPROVAL_SECRET_BYTES) {
    throw new GoogleCalendarProviderError(
      `ACTION_APPROVAL_SECRET must be at least ${MIN_APPROVAL_SECRET_BYTES} UTF-8 bytes.`,
      "configuration",
    );
  }
  return value;
}

function encryptionKey(secret: string): Buffer {
  return createHash("sha256").update(requireApprovalSecret(secret)).digest();
}

function encryptJson(value: unknown, secret: string, purpose: string): string {
  const iv = randomBytes(CIPHER_IV_BYTES);
  const cipher = createCipheriv(CIPHER_ALGORITHM, encryptionKey(secret), iv);
  cipher.setAAD(Buffer.from(purpose, "utf8"));
  const ciphertext = Buffer.concat([
    cipher.update(JSON.stringify(value), "utf8"),
    cipher.final(),
  ]);
  const authenticationTag = cipher.getAuthTag();
  return [
    CIPHER_VERSION,
    iv.toString("base64url"),
    authenticationTag.toString("base64url"),
    ciphertext.toString("base64url"),
  ].join(".");
}

function decryptJson(value: string, secret: string, purpose: string): unknown {
  try {
    const [version, encodedIv, encodedTag, encodedCiphertext, extra] =
      value.split(".");
    if (
      version !== CIPHER_VERSION ||
      !encodedIv ||
      !encodedTag ||
      !encodedCiphertext ||
      extra
    ) {
      throw new Error("Invalid encrypted value format");
    }
    const decipher = createDecipheriv(
      CIPHER_ALGORITHM,
      encryptionKey(secret),
      Buffer.from(encodedIv, "base64url"),
    );
    decipher.setAAD(Buffer.from(purpose, "utf8"));
    decipher.setAuthTag(Buffer.from(encodedTag, "base64url"));
    const plaintext = Buffer.concat([
      decipher.update(Buffer.from(encodedCiphertext, "base64url")),
      decipher.final(),
    ]).toString("utf8");
    return JSON.parse(plaintext) as unknown;
  } catch (error) {
    if (error instanceof GoogleCalendarProviderError) throw error;
    throw new GoogleCalendarProviderError(
      "Stored Google credentials could not be decrypted.",
      "invalid_credentials",
    );
  }
}

function compactCredentials(credentials: Credentials): Credentials {
  const compact: Credentials = {};
  if (credentials.access_token) compact.access_token = credentials.access_token;
  if (credentials.refresh_token) compact.refresh_token = credentials.refresh_token;
  if (credentials.scope) compact.scope = credentials.scope;
  if (credentials.token_type) compact.token_type = credentials.token_type;
  if (credentials.expiry_date) compact.expiry_date = credentials.expiry_date;
  if (credentials.id_token) compact.id_token = credentials.id_token;
  return compact;
}

export function encryptGoogleCredentials(
  credentials: Credentials,
  secret: string,
): string {
  const parsed = storedCredentialsSchema.parse(compactCredentials(credentials));
  return encryptJson(parsed, secret, "roxanne:google-credentials");
}

export function decryptGoogleCredentials(
  encryptedCredentials: string,
  secret: string,
): Credentials {
  const decrypted = decryptJson(
    encryptedCredentials,
    secret,
    "roxanne:google-credentials",
  );
  const parsed = storedCredentialsSchema.safeParse(decrypted);
  if (!parsed.success) {
    throw new GoogleCalendarProviderError(
      "Stored Google credentials are invalid.",
      "invalid_credentials",
    );
  }
  return parsed.data;
}

export function sanitizeGoogleReturnTo(value: string | null | undefined): string {
  const candidate = value?.trim();
  if (!candidate || !candidate.startsWith("/") || candidate.startsWith("//")) {
    return "/";
  }
  if (candidate.includes("\\")) return "/";
  try {
    const parsed = new URL(candidate, "https://lantern.local");
    if (parsed.origin !== "https://lantern.local") return "/";
    return `${parsed.pathname}${parsed.search}`;
  } catch {
    return "/";
  }
}

export function createGoogleOAuthState(
  input: { userId: string; returnTo?: string | null },
  secret: string,
  now = Date.now(),
): string {
  const state = oauthStateSchema.parse({
    userId: input.userId,
    returnTo: sanitizeGoogleReturnTo(input.returnTo),
    issuedAt: now,
    nonce: randomBytes(24).toString("base64url"),
  });
  return encryptJson(state, secret, "roxanne:google-oauth-state");
}

export function readGoogleOAuthState(
  encryptedState: string,
  secret: string,
  now = Date.now(),
): GoogleOAuthState {
  const result = oauthStateSchema.safeParse(
    decryptJson(encryptedState, secret, "roxanne:google-oauth-state"),
  );
  if (!result.success) {
    throw new GoogleCalendarProviderError(
      "The Google connection state is invalid.",
      "oauth_state",
    );
  }
  if (
    result.data.issuedAt > now + OAUTH_STATE_FUTURE_SKEW_MS ||
    now - result.data.issuedAt > OAUTH_STATE_MAX_AGE_MS
  ) {
    throw new GoogleCalendarProviderError(
      "The Google connection request expired. Please connect again.",
      "oauth_state",
    );
  }
  return result.data;
}

export function createGoogleOAuthClient(config: GoogleOAuthConfig): OAuth2Client {
  return new google.auth.OAuth2(
    config.clientId,
    config.clientSecret,
    config.redirectUri,
  );
}

export function createGoogleAuthorizationUrl(
  state: string,
  options: {
    config?: GoogleOAuthConfig;
    loginHint?: string;
    oauthClient?: OAuth2Client;
  } = {},
): string {
  const config = options.config ?? getGoogleOAuthConfig();
  const oauthClient = options.oauthClient ?? createGoogleOAuthClient(config);
  return oauthClient.generateAuthUrl({
    access_type: "offline",
    include_granted_scopes: true,
    prompt: "consent select_account",
    scope: [...GOOGLE_OAUTH_SCOPES],
    state,
    ...(options.loginHint?.trim()
      ? { login_hint: options.loginHint.trim() }
      : {}),
  });
}

export async function exchangeGoogleAuthorizationCode(
  code: string,
  options: { config?: GoogleOAuthConfig; oauthClient?: OAuth2Client } = {},
): Promise<Credentials> {
  const cleanCode = code.trim();
  if (!cleanCode || cleanCode.length > 4096) {
    throw new GoogleCalendarProviderError(
      "The Google authorization code is invalid.",
      "invalid_credentials",
    );
  }
  const config = options.config ?? getGoogleOAuthConfig();
  const oauthClient = options.oauthClient ?? createGoogleOAuthClient(config);
  try {
    const { tokens } = await oauthClient.getToken(cleanCode);
    return compactCredentials(tokens);
  } catch {
    throw new GoogleCalendarProviderError(
      "Google authorization could not be completed.",
      "invalid_credentials",
    );
  }
}

interface ProviderConnectionRow {
  encrypted_credentials: string;
}

async function readConnectionRow(
  client: SupabaseClient,
  userId: string,
): Promise<ProviderConnectionRow | null> {
  const { data, error } = await client
    .from("provider_connections")
    .select("encrypted_credentials")
    .eq("user_id", userId)
    .eq("provider", GOOGLE_CONNECTION_PROVIDER)
    .maybeSingle();
  if (error) {
    throw new GoogleCalendarProviderError(
      "The saved Google connection could not be read.",
      "storage",
    );
  }
  return data as ProviderConnectionRow | null;
}

export async function loadPersistedGoogleCredentials(
  client: SupabaseClient,
  userId: string,
  secret: string,
): Promise<Credentials | null> {
  const row = await readConnectionRow(client, userId);
  if (!row) return null;
  return decryptGoogleCredentials(row.encrypted_credentials, secret);
}

export async function persistGoogleCredentials(
  client: SupabaseClient,
  userId: string,
  credentials: Credentials,
  secret: string,
): Promise<Credentials> {
  const existing = await loadPersistedGoogleCredentials(client, userId, secret);
  const merged = compactCredentials({ ...existing, ...compactCredentials(credentials) });
  if (!merged.refresh_token) {
    throw new GoogleCalendarProviderError(
      "Google did not return a refresh token. Reconnect and grant offline access.",
      "invalid_credentials",
    );
  }

  const now = new Date().toISOString();
  const scopes = merged.scope?.split(/\s+/u).filter(Boolean) ?? [];
  const expiresAt = merged.expiry_date
    ? new Date(merged.expiry_date).toISOString()
    : null;
  const { error } = await client.from("provider_connections").upsert(
    {
      user_id: userId,
      provider: GOOGLE_CONNECTION_PROVIDER,
      encrypted_credentials: encryptGoogleCredentials(merged, secret),
      scopes,
      expires_at: expiresAt,
      updated_at: now,
    },
    { onConflict: "user_id,provider" },
  );
  if (error) {
    throw new GoogleCalendarProviderError(
      "The Google connection could not be saved.",
      "storage",
    );
  }
  return merged;
}

export async function createAuthorizedGoogleOAuthClient(options: {
  config?: GoogleOAuthConfig;
  client?: SupabaseClient | null;
  userId?: string | null;
} = {}): Promise<OAuth2Client> {
  const config = options.config ?? getGoogleOAuthConfig();
  let credentials: Credentials | null = config.refreshToken
    ? { refresh_token: config.refreshToken }
    : null;

  if (!credentials && options.client && options.userId) {
    credentials = await loadPersistedGoogleCredentials(
      options.client,
      options.userId,
      requireApprovalSecret(config.approvalSecret),
    );
  }
  if (!credentials?.refresh_token) {
    throw new GoogleCalendarProviderError(
      "Google Calendar is not connected.",
      "not_connected",
    );
  }

  const oauthClient = createGoogleOAuthClient(config);
  oauthClient.setCredentials(credentials);
  return oauthClient;
}

function parseLocalDateTime(value: string): number | null {
  const match =
    /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,3}))?)?$/u.exec(
      value,
    );
  if (!match) return null;
  const [year, month, day, hour, minute, second] = match
    .slice(1, 7)
    .map((part) => Number(part ?? 0));
  const millisecond = Number((match[7] ?? "").padEnd(3, "0") || 0);
  const localAnchor = new Date(
    Date.UTC(year, month - 1, day, hour, minute, second, millisecond),
  );
  if (
    localAnchor.getUTCFullYear() !== year ||
    localAnchor.getUTCMonth() !== month - 1 ||
    localAnchor.getUTCDate() !== day ||
    localAnchor.getUTCHours() !== hour ||
    localAnchor.getUTCMinutes() !== minute ||
    localAnchor.getUTCSeconds() !== second
  ) {
    return Number.NaN;
  }
  return localAnchor.getTime() - 8 * 60 * 60_000;
}

function malaysiaRfc3339(instantMs: number): string {
  const local = new Date(instantMs + 8 * 60 * 60_000);
  return `${local.toISOString().slice(0, 19)}+08:00`;
}

export function normalizeMalaysiaDateTime(value: string): string {
  const trimmed = value.trim();
  const localTime = parseLocalDateTime(trimmed);
  const instant = localTime === null ? Date.parse(trimmed) : localTime;
  if (!Number.isFinite(instant)) {
    throw new RangeError("Invalid calendar start time.");
  }
  // Offset-bearing values must be RFC 3339-like; Date.parse alone accepts unsafe
  // implementation-specific formats.
  if (
    localTime === null &&
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?(?:Z|[+-]\d{2}:\d{2})$/u.test(
      trimmed,
    )
  ) {
    throw new RangeError("Invalid calendar start time.");
  }
  return malaysiaRfc3339(instant);
}

export function buildGoogleCalendarInsert(
  input: unknown,
  calendarId = "primary",
  eventId?: string,
) {
  const parsed = googleCalendarEventSchema.parse(input);
  const startInstant = Date.parse(normalizeMalaysiaDateTime(parsed.startAt));
  const startAt = malaysiaRfc3339(startInstant);
  const endAt = malaysiaRfc3339(startInstant + parsed.durationMinutes * 60_000);
  const conferenceLine = parsed.conferenceUrl
    ? `Join the meeting: ${parsed.conferenceUrl}`
    : "";
  const description = [parsed.description, conferenceLine]
    .filter(Boolean)
    .join("\n\n") || undefined;

  return {
    parsed,
    startAt,
    endAt,
    parameters: {
      calendarId,
      sendUpdates: "all" as const,
      requestBody: {
        ...(eventId ? { id: eventId } : {}),
        summary: parsed.summary,
        ...(description ? { description } : {}),
        ...(parsed.location ? { location: parsed.location } : {}),
        start: { dateTime: startAt, timeZone: GOOGLE_TIME_ZONE },
        end: { dateTime: endAt, timeZone: GOOGLE_TIME_ZONE },
        attendees: parsed.attendees.map((email) => ({ email })),
      } satisfies calendar_v3.Schema$Event,
    },
  };
}

const AVAILABILITY_HOURS = {
  day: { start: 9, end: 18 },
  morning: { start: 9, end: 12 },
  afternoon: { start: 12, end: 18 },
} as const;

/**
 * Returns 30-minute business-hour slots which do not overlap Google busy time.
 * Malaysia has a fixed UTC+08:00 offset, so these wall-clock boundaries are
 * deterministic on Vercel regardless of the server's own timezone.
 */
export async function getGoogleCalendarAvailability(
  input: unknown,
  options: {
    calendar?: CalendarFreeBusyClient;
    oauthClient?: OAuth2Client;
    calendarId?: string;
  } = {},
): Promise<GoogleCalendarAvailability> {
  const parsed = googleAvailabilitySchema.parse(input);
  const calendarId = options.calendarId?.trim() || "primary";
  const hours = AVAILABILITY_HOURS[parsed.period];
  const windowStart = Date.parse(
    normalizeMalaysiaDateTime(
      `${parsed.date}T${String(hours.start).padStart(2, "0")}:00`,
    ),
  );
  const windowEnd = Date.parse(
    normalizeMalaysiaDateTime(
      `${parsed.date}T${String(hours.end).padStart(2, "0")}:00`,
    ),
  );
  if (!options.calendar && !options.oauthClient) {
    throw new GoogleCalendarProviderError(
      "An authorized Google client is required.",
      "configuration",
    );
  }
  const calendar =
    options.calendar ??
    (google.calendar({
      version: "v3",
      auth: options.oauthClient,
    }) as unknown as CalendarFreeBusyClient);

  try {
    const response = await calendar.freebusy.query({
      requestBody: {
        timeMin: malaysiaRfc3339(windowStart),
        timeMax: malaysiaRfc3339(windowEnd),
        timeZone: GOOGLE_TIME_ZONE,
        items: [{ id: calendarId }],
      },
    });
    const calendars = response.data.calendars ?? {};
    const calendarResult =
      calendars[calendarId] ?? Object.values(calendars)[0];
    if (calendarResult?.errors?.length) {
      throw new Error("Google returned a free/busy calendar error");
    }
    const busy = (calendarResult?.busy ?? [])
      .map((period) => ({
        start: period.start ? Date.parse(period.start) : Number.NaN,
        end: period.end ? Date.parse(period.end) : Number.NaN,
      }))
      .filter(
        (period) =>
          Number.isFinite(period.start) &&
          Number.isFinite(period.end) &&
          period.end > period.start,
      );
    const slots: GoogleAvailabilitySlot[] = [];
    for (let start = windowStart; start + 30 * 60_000 <= windowEnd; start += 30 * 60_000) {
      const end = start + 30 * 60_000;
      if (busy.some((period) => period.start < end && period.end > start)) {
        continue;
      }
      slots.push({
        startAt: malaysiaRfc3339(start),
        endAt: malaysiaRfc3339(end),
      });
    }
    return {
      date: parsed.date,
      period: parsed.period,
      timeZone: GOOGLE_TIME_ZONE,
      durationMinutes: 30,
      slots,
    };
  } catch (error) {
    if (error instanceof GoogleCalendarProviderError) throw error;
    throw new GoogleCalendarProviderError(
      "Google Calendar availability could not be checked.",
      "calendar_failure",
      responseStatus(error),
    );
  }
}

function responseStatus(error: unknown): number | undefined {
  if (!error || typeof error !== "object") return undefined;
  const record = error as {
    status?: unknown;
    code?: unknown;
    response?: { status?: unknown };
  };
  const candidate = record.response?.status ?? record.status ?? record.code;
  return typeof candidate === "number" ? candidate : undefined;
}

export async function createGoogleCalendarEvent(
  input: unknown,
  options: {
    calendar?: CalendarInsertClient;
    oauthClient?: OAuth2Client;
    calendarId?: string;
    /** Deterministic Google event ID used to make ambiguous retries safe. */
    eventId?: string;
  } = {},
): Promise<CreatedGoogleCalendarEvent> {
  const calendarId = options.calendarId?.trim() || "primary";
  const eventId = options.eventId?.trim();
  if (eventId && !/^[0-9a-v]{5,1024}$/u.test(eventId)) {
    throw new GoogleCalendarProviderError(
      "The deterministic Google event ID is invalid.",
      "configuration",
    );
  }
  const insert = buildGoogleCalendarInsert(input, calendarId, eventId);
  if (!options.calendar && !options.oauthClient) {
    throw new GoogleCalendarProviderError(
      "An authorized Google client is required.",
      "configuration",
    );
  }
  const calendar =
    options.calendar ??
    (google.calendar({
      version: "v3",
      auth: options.oauthClient,
    }) as unknown as CalendarInsertClient);

  try {
    const response = await calendar.events.insert(insert.parameters);
    if (!response.data.id) {
      throw new Error("Google returned no event ID");
    }
    return {
      id: response.data.id,
      htmlLink: response.data.htmlLink ?? null,
      summary: insert.parsed.summary,
      startAt: insert.startAt,
      endAt: insert.endAt,
      timeZone: GOOGLE_TIME_ZONE,
      attendees: [...insert.parsed.attendees],
    };
  } catch (error) {
    // Google reserves a caller-supplied event ID. A 409 therefore means an
    // earlier ambiguous attempt created this exact deterministic event; treat
    // it as recovered success instead of sending a second invitation.
    if (eventId && responseStatus(error) === 409) {
      return {
        id: eventId,
        htmlLink: null,
        summary: insert.parsed.summary,
        startAt: insert.startAt,
        endAt: insert.endAt,
        timeZone: GOOGLE_TIME_ZONE,
        attendees: [...insert.parsed.attendees],
      };
    }
    throw new GoogleCalendarProviderError(
      "Google Calendar could not create the event.",
      "calendar_failure",
      responseStatus(error),
    );
  }
}
