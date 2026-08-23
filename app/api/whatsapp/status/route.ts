import { requireOwnerSession } from "@/lib/api-security";
import {
  parseWhatsAppStatus,
  requestWhatsAppRelay,
  whatsappNoStoreJson,
  whatsappRelayErrorResponse,
} from "@/lib/whatsapp-relay";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET() {
  const authError = await requireOwnerSession();
  if (authError) return authError;
  try {
    const status = parseWhatsAppStatus(await requestWhatsAppRelay("/status"));
    return whatsappNoStoreJson(status);
  } catch (error) {
    return whatsappRelayErrorResponse(error);
  }
}
