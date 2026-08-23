import { NextRequest, NextResponse } from "next/server";

const FIRMWARE_VERSION = "3.0.0";
const FIRMWARE_PATH = "/firmware/roxanne-wearable-v3.0.0.bin";

function otaResponse(request: NextRequest) {
  return NextResponse.json(
    {
      firmware: {
        version: FIRMWARE_VERSION,
        url: new URL(FIRMWARE_PATH, request.nextUrl.origin).toString(),
        force: 1,
      },
      server_time: {
        timestamp: Date.now(),
        timezone_offset: 480,
      },
    },
    {
      headers: {
        "Cache-Control": "no-store, max-age=0",
      },
    },
  );
}

export async function GET(request: NextRequest) {
  return otaResponse(request);
}

export async function POST(request: NextRequest) {
  return otaResponse(request);
}
