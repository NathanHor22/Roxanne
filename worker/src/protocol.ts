import { timingSafeEqual } from "node:crypto";

/** The hackathon safety rail: no API request can address another recipient. */
export const ALLOWED_WHATSAPP_RECIPIENT = "601154444038";

export class RequestError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = "RequestError";
    this.status = status;
  }
}

/**
 * Converts common Malaysian mobile formats to E.164 digits without a leading +.
 * Examples: 011-5444 4038 -> 601154444038, +60 11-5444 4038 -> 601154444038.
 */
export function normalizeMalaysianPhone(input: unknown): string {
  if (typeof input !== "string" || !input.trim()) {
    throw new RequestError(400, "A Malaysian mobile number is required.");
  }

  let digits = input.replace(/\D/gu, "");
  if (digits.startsWith("00")) digits = digits.slice(2);
  if (digits.startsWith("0")) digits = `6${digits}`;
  else if (digits.startsWith("1")) digits = `60${digits}`;

  // Malaysian mobile numbers are 01X + 7/8 subscriber digits locally.
  if (!/^601\d{8,9}$/u.test(digits)) {
    throw new RequestError(400, "Enter a valid Malaysian mobile number.");
  }
  return digits;
}

export function assertAllowedRecipient(input: unknown): string {
  const phone = normalizeMalaysianPhone(input);
  if (phone !== ALLOWED_WHATSAPP_RECIPIENT) {
    throw new RequestError(
      403,
      "This worker can send and pair only with the owner-approved WhatsApp number.",
    );
  }
  return phone;
}

export function isValidBearerAuthorization(
  authorization: string | undefined,
  expectedToken: string,
): boolean {
  if (!authorization) return false;
  const match = authorization.match(/^Bearer\s+(.+)$/iu);
  if (!match?.[1]) return false;

  const supplied = Buffer.from(match[1], "utf8");
  const expected = Buffer.from(expectedToken, "utf8");
  return supplied.length === expected.length && timingSafeEqual(supplied, expected);
}

export function parseSendPayload(value: unknown): {
  to: string;
  text: string;
  idempotencyKey: string;
} {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new RequestError(400, "Expected a JSON object.");
  }
  const body = value as Record<string, unknown>;
  const to = assertAllowedRecipient(body.to);
  const text = typeof body.text === "string" ? body.text.trim() : "";
  const idempotencyKey =
    typeof body.idempotencyKey === "string" ? body.idempotencyKey.trim() : "";

  if (!text) throw new RequestError(400, "Message text is required.");
  if (text.length > 4_000) {
    throw new RequestError(400, "Message text must be 4,000 characters or fewer.");
  }
  if (!/^[A-Za-z0-9._:-]{8,200}$/u.test(idempotencyKey)) {
    throw new RequestError(
      400,
      "idempotencyKey must be 8-200 URL-safe characters.",
    );
  }
  return { to, text, idempotencyKey };
}
