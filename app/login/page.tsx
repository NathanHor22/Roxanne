import Link from "next/link";
import { Check, Headphones, ShieldCheck } from "lucide-react";

import { LanternMark } from "@/components/brand/LanternMark";
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
};

export default async function LoginPage({ searchParams }: LoginPageProps) {
  const query = await searchParams;
  const nextPath = sanitizeAuthReturnTo(query.next);
  const { url, anonKey } = publicSupabaseConfig();
  const configured = Boolean(url && anonKey);
  const message = query.error ? messages[query.error] : null;

  return (
    <main className={styles.page}>
      <div className={styles.gridGlow} aria-hidden="true" />
      <div className={styles.authShell}>
        <section className={styles.intro} aria-label="About Quipus">
          <div className={styles.brandLockup}>
            <span className={styles.logo}><LanternMark /></span>
            <strong>Quipus</strong>
          </div>
          <p className={styles.eyebrow}>CONVERSATION INTELLIGENCE</p>
          <h1>Carry every conversation forward.</h1>
          <p className={styles.introCopy}>
            Your meetings, source audio, commitments, and follow-ups stay in one
            private workspace.
          </p>
          <ul className={styles.signalList}>
            <li><Headphones /><span>Replay the original conversation</span></li>
            <li><Check /><span>Review every extracted commitment</span></li>
            <li><ShieldCheck /><span>Approve before Quipus acts</span></li>
          </ul>
        </section>

        <section className={styles.card} aria-labelledby="login-title">
          <span className={styles.accessPill}><i /> SECURE ACCESS</span>
          <p className={styles.cardKicker}>WELCOME BACK</p>
          <h2 id="login-title">Sign in to your Quipus.</h2>
          <p className={styles.description}>
            Continue with any Google account. Each account receives its own
            private Quipus workspace.
          </p>

          {message ? <p className={styles.notice} role="alert">{message}</p> : null}

          {configured ? (
            <LoginButton nextPath={nextPath} />
          ) : (
            <div className={styles.localNotice}>
              <strong>Local development mode</strong>
              <span>Supabase Auth is not configured, so local access remains open.</span>
              <Link href={nextPath}>Return to Quipus</Link>
            </div>
          )}

          <p className={styles.footnote}>
            Conversations, devices, and Calendar access stay tied to the account
            you choose.
          </p>
          <p className={styles.footnote}>
            <Link href="/privacy">Privacy</Link> · <Link href="/terms">Terms</Link>
          </p>
        </section>
      </div>
    </main>
  );
}
