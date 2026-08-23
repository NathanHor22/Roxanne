export type AuthEnforcementMode = "disabled" | "enabled" | "misconfigured";

type AuthEnvironment = {
  nodeEnv?: string;
  supabaseUrl?: string;
  supabaseAnonKey?: string;
};

/**
 * Authentication is optional only for an unconfigured local development server.
 * A production deployment, or any environment with either public Supabase value
 * present, fails closed until both values are configured.
 */
export function authEnforcementMode({
  nodeEnv,
  supabaseUrl,
  supabaseAnonKey,
}: AuthEnvironment): AuthEnforcementMode {
  const hasUrl = Boolean(supabaseUrl?.trim());
  const hasAnonKey = Boolean(supabaseAnonKey?.trim());

  if (hasUrl && hasAnonKey) return "enabled";
  if (nodeEnv === "production" || hasUrl || hasAnonKey) return "misconfigured";
  return "disabled";
}

export function isOwnerEmail(
  actualEmail: string | null | undefined,
  ownerEmail: string | null | undefined,
): boolean {
  if (!actualEmail || !ownerEmail) return false;
  return actualEmail.trim().toLowerCase() === ownerEmail.trim().toLowerCase();
}

/** Prevent OAuth callbacks from becoming open redirects. */
export function sanitizeAuthReturnTo(value: string | null | undefined): string {
  if (!value || !value.startsWith("/") || value.startsWith("//")) return "/";

  try {
    const parsed = new URL(value, "https://roxanne.invalid");
    if (parsed.origin !== "https://roxanne.invalid") return "/";
    return `${parsed.pathname}${parsed.search}${parsed.hash}`;
  } catch {
    return "/";
  }
}

export function isPublicAuthPath(pathname: string): boolean {
  return (
    pathname === "/login" ||
    pathname === "/auth/callback" ||
    pathname === "/api/auth/logout"
  );
}
