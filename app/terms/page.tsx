import type { Metadata } from "next";
import Link from "next/link";

import { LanternMark } from "@/components/brand/LanternMark";
import styles from "../legal.module.css";

export const metadata: Metadata = {
  title: "Terms of Use · Quipus",
  description: "Terms for using the Quipus conversation and follow-up prototype.",
};

export default function TermsPage() {
  return (
    <main className={styles.page}>
      <div className={styles.shell}>
        <Link className={styles.brand} href="/">
          <span className={styles.mark}><LanternMark /></span>
          Quipus
        </Link>
        <article className={styles.article}>
          <p className={styles.eyebrow}>TERMS</p>
          <h1>Terms of Use</h1>
          <p className={styles.updated}>Effective 13 September 2026</p>

          <p>
            Quipus is an early prototype that captures consented conversations,
            prepares summaries and follow-ups, and creates Google Calendar events
            after approval. By using Quipus, you agree to these terms.
          </p>

          <h2>Recording consent</h2>
          <p>
            You are responsible for telling participants that Quipus is recording
            and for obtaining every consent required by the laws and rules that apply
            to you. Do not use Quipus for covert or unlawful recording.
          </p>

          <h2>Review before acting</h2>
          <p>
            Transcripts, summaries, names, email addresses, dates, and proposed
            actions may be incomplete or incorrect. Review the source audio and all
            invitation details before approval. You remain responsible for messages,
            invitations, and other actions sent from your connected accounts.
          </p>

          <h2>Account and device security</h2>
          <p>
            Keep control of your Google account, paired Quipus devices, hotspot
            credentials, and pairing codes. Revoke a device promptly if it is lost or
            transferred. You may not access another person&apos;s workspace or interfere
            with the service.
          </p>

          <h2>Prototype availability</h2>
          <p>
            Quipus may change, lose features, or be unavailable while it is under
            development. Do not rely on it as the only copy of important recordings,
            commitments, or appointments.
          </p>

          <h2>Acceptable use</h2>
          <p>
            Do not use Quipus to violate privacy, intellectual property, employment,
            surveillance, anti-spam, or other applicable laws; upload malicious
            material; impersonate others; or send invitations without authority.
          </p>

          <h2>Contact</h2>
          <p>
            Questions about these terms can be sent to{` `}
            <a href="mailto:nathanhor2001@gmail.com">nathanhor2001@gmail.com</a>.
          </p>
        </article>
        <footer className={styles.footer}>
          <Link href="/">Home</Link>
          <Link href="/privacy">Privacy</Link>
          <Link href="/login?next=/dashboard">Sign in</Link>
        </footer>
      </div>
    </main>
  );
}
