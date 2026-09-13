export const LANTERN_SCHEMA_OUTDATED = "LANTERN_SCHEMA_OUTDATED";

export const lanternSchemaUpgradeMessage =
  "Lantern's device database is not ready. Apply Supabase migrations 004–007, then try again.";

const schemaErrorCodes = new Set(["42P01", "42703", "42883", "PGRST200", "PGRST202", "PGRST205"]);

export function isLanternSchemaOutdated(error: unknown) {
  const details =
    error && typeof error === "object"
      ? (error as { code?: unknown; message?: unknown; details?: unknown; hint?: unknown })
      : null;
  const code = typeof details?.code === "string" ? details.code.toUpperCase() : "";
  const message = [details?.message, details?.details, details?.hint]
    .filter((value): value is string => typeof value === "string")
    .join(" ");

  if (schemaErrorCodes.has(code)) {
    return /device_pairings|devices|claim_lantern_pairing|lantern_sessions|lantern_device_events/i.test(
      message,
    );
  }

  return /device_pairings|claim_lantern_pairing|column\s+(?:public\.)?devices\.[a-z_]+\s+does not exist|could not find the table ['"]public\.device_pairings/i.test(
    message,
  );
}
