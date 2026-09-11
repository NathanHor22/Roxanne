import { randomUUID } from "node:crypto";

import { NextResponse } from "next/server";
import { z } from "zod";

import {
  createDeviceSecret,
  hashLanternSecret,
  normalizePairingCode,
} from "@/lib/lantern-device-auth";
import { getServerSupabase } from "@/lib/supabase/server";

export const runtime = "nodejs";

const requestSchema = z
  .object({
    pairingCode: z.string().trim().min(1).max(20),
    hardwareId: z.string().trim().min(8).max(120),
    model: z.string().trim().min(1).max(100),
    firmwareVersion: z.string().trim().min(1).max(80),
  })
  .strict();

export async function POST(request: Request) {
  const client = getServerSupabase();
  if (!client) {
    return NextResponse.json(
      { error: "Lantern pairing is unavailable." },
      { status: 503, headers: { "cache-control": "no-store" } },
    );
  }

  try {
    const input = requestSchema.parse(await request.json());
    const code = normalizePairingCode(input.pairingCode);
    const deviceId = randomUUID();
    const deviceSecret = createDeviceSecret();
    const { data, error } = await client.rpc("claim_lantern_pairing", {
      p_code_hash: hashLanternSecret(code),
      p_device_id: deviceId,
      p_hardware_id: input.hardwareId,
      p_model: input.model,
      p_firmware_version: input.firmwareVersion,
      p_credential_hash: hashLanternSecret(deviceSecret),
    });
    if (error) throw new Error(error.message);
    const claimed = Array.isArray(data) ? data[0] : data;
    if (!claimed?.device_id) {
      return NextResponse.json(
        { error: "The pairing code is invalid or has expired." },
        { status: 404, headers: { "cache-control": "no-store" } },
      );
    }

    return NextResponse.json(
      {
        device: {
          id: claimed.device_id,
          name: claimed.device_name,
        },
        credential: {
          scheme: "Device",
          secret: deviceSecret,
        },
      },
      { status: 201, headers: { "cache-control": "no-store" } },
    );
  } catch (error) {
    console.error("[device-claim]", error);
    return NextResponse.json(
      {
        error:
          error instanceof z.ZodError
            ? "Lantern claim details are invalid."
            : "Lantern could not be paired.",
      },
      {
        status: error instanceof z.ZodError ? 400 : 500,
        headers: { "cache-control": "no-store" },
      },
    );
  }
}

