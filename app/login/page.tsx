import Link from "next/link";

import { sanitizeAuthReturnTo } from "@/lib/auth-policy";
import { publicSupabaseConfig } from "@/lib/supabase/session";

import { LoginButton } from "./LoginButton";
import styles from "./login.module.css";

export const dynamic = "force-dynamic";

type LoginPageProps = {
  searchParams: Promise<{ error?: string; next?: string }>;
};

const messages: Record<string, string> = {
  oauth: "Google sign-in did not complete. Please try again.",
  unauthorized: "That Google account is not authorized for this workspace.",
};

export default async function LoginPage({ searchParams }: LoginPageProps) {
  const query = await searchParams;
  const nextPath = sanitizeAuthReturnTo(query.next);
  const { url, anonKey } = publicSupabaseConfig();
  const configured = Boolean(url && anonKey);
  const message = query.error ? messages[query.error] : null;

  return (
    <main className={styles.page}>
      <section className={styles.card} aria-labelledby="login-title">
        <div className={styles.logo} aria-hidden="true">R</div>
        <p className={styles.eyebrow}>ROXANNE</p>
        <h1 id="login-title">Your business memory, kept private.</h1>
        <p className={styles.description}>
          Sign in with the workspace owner’s Google account to continue.
        </p>

        {message ? <p className={styles.notice} role="alert">{message}</p> : null}

        {configured ? (
          <LoginButton nextPath={nextPath} />
        ) : (
          <div className={styles.localNotice}>
            <strong>Local development mode</strong>
            <span>Supabase Auth is not configured, so local access remains open.</span>
            <Link href={nextPath}>Return to Roxanne</Link>
          </div>
        )}

        <p className={styles.footnote}>
          Access is restricted to the email configured for this deployment.
        </p>
      </section>
    </main>
  );
}
