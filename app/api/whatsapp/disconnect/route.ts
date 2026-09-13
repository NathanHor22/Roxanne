import { z } from "zod";
import { requireAuthenticatedSession } from "@/lib/api-security";
import {
  parseWhatsAppDisconnect,
  requestWhatsAppRelay,
  whatsappNoStoreJson,
  whatsappRelayErrorResponse,
} from "@/lib/whatsapp-relay";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

const requestSchema = z.object({ approved: z.literal(true) }).strict();

export async function POST(request: Request) {
  const authError = await requireAuthenticatedSession();
  if (authError) return authError;
  try {
    requestSchema.parse(await request.json());
    const result = parseWhatsAppDisconnect(
      await requestWhatsAppRelay("/disconnect", { method: "POST" }),
    );
    return whatsappNoStoreJson(result);
  } catch (error) {
    if (error instanceof z.ZodError || error instanceof SyntaxError) {
      return whatsappNoStoreJson(
        { error: "Disconnecting WhatsApp requires explicit approval." },
        400,
      );
    }
    return whatsappRelayErrorResponse(error);
  }
}
