import type { Metadata } from "next";
import Link from "next/link";

import { LanternMark } from "@/components/brand/LanternMark";
import styles from "../legal.module.css";

export const metadata: Metadata = {
  title: "Privacy Policy · Lantern",
  description: "How Lantern collects, uses, and protects account and conversation data.",
};

export default function PrivacyPage() {
  return (
    <main className={styles.page}>
      <div className={styles.shell}>
        <Link className={styles.brand} href="/">
          <span className={styles.mark}><LanternMark /></span>
          Lantern
        </Link>
        <article className={styles.article}>
          <p className={styles.eyebrow}>PRIVACY</p>
          <h1>Privacy Policy</h1>
          <p className={styles.updated}>Effective 13 September 2026</p>

          <p>
            Lantern is a conversation memory and follow-up prototype. This policy
            explains the information Lantern handles when you sign in, connect a
            device, process a conversation, or connect Google Calendar.
          </p>

          <h2>Information Lantern handles</h2>
          <ul>
            <li>Your Google account identifier, email address, and display name.</li>
            <li>Audio you choose to capture, transcripts, summaries, contacts, commitments, and follow-up drafts.</li>
            <li>Google Calendar authorization tokens, granted scopes, availability, and events you explicitly approve.</li>
            <li>Paired device identifiers, firmware version, connection status, battery level, and operational logs.</li>
          </ul>

          <h2>How information is used</h2>
          <p>
            Lantern uses this information to authenticate you, keep your workspace
            separate, transcribe and summarize conversations, prepare follow-ups,
            show device status, check availability, and create an approved Calendar
            event with its invitation and Google Meet link.
          </p>

          <h2>Google user data</h2>
          <p>
            Lantern requests Calendar event access so it can create or update only
            the meetings you approve. It requests free/busy access to check whether
            a proposed time is available. Google credentials are encrypted before
            storage and are tied to the Lantern account that granted access. Lantern
            does not sell Google user data or use it for advertising.
          </p>
          <p>
            Lantern&apos;s use and transfer of information received from Google APIs
            adheres to the Google API Services User Data Policy, including the
            Limited Use requirements.
          </p>

          <h2>Processors and sharing</h2>
          <p>
            Lantern uses service providers to run the product: Supabase for account
            and database storage, Vercel for hosting, Agora for live audio transport
            and speech services, and OpenAI for transcription and structured meeting
            understanding. When Exa is enabled, Lantern sends public company names
            for research; it does not send recordings, transcripts, or contact email
            addresses to Exa. Calendar data is sent to Google only to complete the
            Calendar features you request.
          </p>

          <h2>Storage, security, and retention</h2>
          <p>
            Workspace rows are partitioned by user ID. Recordings are stored in a
            private bucket and played through short-lived links. Calendar tokens are
            encrypted on the server. Lantern keeps account and workspace data while
            the prototype is operating or until deletion is requested, subject to
            necessary backup and security retention.
          </p>

          <h2>Your choices</h2>
          <p>
            You can decline Calendar access and still sign in. You can revoke Lantern
            in your Google Account permissions. To request access, correction, export,
            or deletion of your Lantern data, email{` `}
            <a href="mailto:nathanhor2001@gmail.com">nathanhor2001@gmail.com</a>.
          </p>

          <h2>Contact and changes</h2>
          <p>
            Questions can be sent to the address above. Material policy changes will
            be reflected on this page with a new effective date.
          </p>
        </article>
        <footer className={styles.footer}>
          <Link href="/">Home</Link>
          <Link href="/terms">Terms</Link>
          <Link href="/login?next=/dashboard">Sign in</Link>
        </footer>
      </div>
    </main>
  );
}
