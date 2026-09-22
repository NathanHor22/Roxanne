import { requireWhatsAppOwner } from "@/lib/whatsapp-owner-auth";
import {
  parseWhatsAppQr,
  requestWhatsAppRelay,
  whatsappNoStoreJson,
  whatsappRelayErrorResponse,
} from "@/lib/whatsapp-relay";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET() {
  const authError = await requireWhatsAppOwner();
  if (authError) return authError;
  try {
    const qr = parseWhatsAppQr(await requestWhatsAppRelay("/qr"));
    return whatsappNoStoreJson(qr);
  } catch (error) {
    return whatsappRelayErrorResponse(error);
  }
}
