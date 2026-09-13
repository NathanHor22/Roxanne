import { z } from "zod";
import { requireAuthenticatedSession } from "@/lib/api-security";
import {
  normalizeOwnerPairPhone,
  parseWhatsAppPairingCode,
  requestWhatsAppRelay,
  whatsappNoStoreJson,
  whatsappRelayErrorResponse,
} from "@/lib/whatsapp-relay";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

const requestSchema = z.object({
  approved: z.literal(true),
  phone: z.string().trim().max(32).optional(),
}).strict();

export async function POST(request: Request) {
  const authError = await requireAuthenticatedSession();
  if (authError) return authError;
  try {
    const input = requestSchema.parse(await request.json());
    const phone = normalizeOwnerPairPhone(input.phone);
    const pairing = parseWhatsAppPairingCode(
      await requestWhatsAppRelay("/pair", {
        method: "POST",
        body: { phone },
      }),
    );
    return whatsappNoStoreJson(pairing);
  } catch (error) {
    if (error instanceof z.ZodError || error instanceof SyntaxError) {
      return whatsappNoStoreJson(
        { error: "Pairing requires explicit approval and a valid phone number." },
        400,
      );
    }
    return whatsappRelayErrorResponse(error);
  }
}
