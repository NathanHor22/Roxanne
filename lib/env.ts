import { z } from "zod";

const optionalUrl = z.string().url().optional().or(z.literal(""));

const serverEnvSchema = z.object({
  NEXT_PUBLIC_APP_URL: optionalUrl,
  NEXT_PUBLIC_SUPABASE_URL: optionalUrl,
  NEXT_PUBLIC_SUPABASE_ANON_KEY: z.string().optional(),
  SUPABASE_SERVICE_ROLE_KEY: z.string().optional(),
  ELEVENLABS_API_KEY: z.string().optional(),
  ELEVENLABS_SCRIBE_MODEL_ID: z.string().default("scribe_v2"),
  GROQ_API_KEY: z.string().optional(),
  GROQ_TRANSCRIPTION_MODEL: z.string().default("whisper-large-v3-turbo"),
  QWEN_API_KEY: z.string().optional(),
  QWEN_BASE_URL: optionalUrl,
  QWEN_MODEL: z.string().default("qwen-plus"),
  DEVIN_API_KEY: z.string().optional(),
  DEVIN_API_BASE_URL: optionalUrl,
  DEVIN_ORG_ID: z.string().optional(),
  DEVIN_POLL_TIMEOUT_MS: z.coerce.number().int().min(10_000).max(300_000).default(60_000),
  GOOGLE_CLIENT_ID: z.string().optional(),
  GOOGLE_CLIENT_SECRET: z.string().optional(),
  GOOGLE_REDIRECT_URI: optionalUrl,
  GOOGLE_REFRESH_TOKEN: z.string().optional(),
  GOOGLE_CALENDAR_ID: z.string().default("primary"),
  WHATSAPP_RELAY_URL: optionalUrl,
  WHATSAPP_RELAY_TOKEN: z.string().optional(),
  WHATSAPP_ALLOWED_RECIPIENT: z.string().regex(/^60\d{8,11}$/).default("601154444038"),
  WHATSAPP_WORKSPACE_KEY: z.string().min(1).max(80).default("roxanne"),
  NEXT_PUBLIC_AGORA_APP_ID: z.string().optional(),
  AGORA_APP_CERTIFICATE: z.string().optional(),
  AGORA_CUSTOMER_ID: z.string().optional(),
  AGORA_CUSTOMER_SECRET: z.string().optional(),
  AGORA_CONVOAI_ASR_LANGUAGE: z.string().default("en-US"),
  AGORA_CONVOAI_TTS: z.string().optional(),
  UPSTASH_REDIS_REST_URL: optionalUrl,
  UPSTASH_REDIS_REST_TOKEN: z.string().optional(),
  KV_REST_API_URL: optionalUrl,
  KV_REST_API_TOKEN: z.string().optional(),
  APP_TIMEZONE: z.string().default("Asia/Kuala_Lumpur"),
  ACTION_APPROVAL_SECRET: z.string().optional(),
  DEMO_USER_EMAIL: z.string().email().default("nathanhor2001@gmail.com"),
  DEMO_USER_ID: z.string().uuid().optional(),
  DEMO_ACCESS_MODE: z.enum(["owner", "public"]).default("owner"),
});

export type ServerEnv = z.infer<typeof serverEnvSchema>;

let cached: ServerEnv | undefined;

export function env(): ServerEnv {
  if (cached) return cached;
  const result = serverEnvSchema.safeParse(process.env);
  if (!result.success) {
    throw new Error(`Invalid environment configuration: ${result.error.message}`);
  }
  cached = result.data;
  return cached;
}

export function integrationStatus() {
  const value = env();
  return {
    supabase: Boolean(value.NEXT_PUBLIC_SUPABASE_URL && value.SUPABASE_SERVICE_ROLE_KEY),
    elevenlabs: Boolean(value.ELEVENLABS_API_KEY || value.GROQ_API_KEY),
    qwen: Boolean(value.QWEN_API_KEY),
    devin: Boolean(value.DEVIN_API_KEY),
    google: Boolean(value.GOOGLE_CLIENT_ID && value.GOOGLE_CLIENT_SECRET && value.GOOGLE_REFRESH_TOKEN),
    whatsapp: Boolean(value.WHATSAPP_RELAY_URL && value.WHATSAPP_RELAY_TOKEN),
    agora: Boolean(
      value.NEXT_PUBLIC_AGORA_APP_ID &&
      value.AGORA_APP_CERTIFICATE &&
      value.AGORA_CUSTOMER_ID &&
      value.AGORA_CUSTOMER_SECRET,
    ),
    redis: Boolean(
      (value.UPSTASH_REDIS_REST_URL && value.UPSTASH_REDIS_REST_TOKEN) ||
        (value.KV_REST_API_URL && value.KV_REST_API_TOKEN),
    ),
  };
}
