import Link from "next/link";
import { Check, Headphones, ShieldCheck } from "lucide-react";

import { LanternMark } from "@/components/brand/LanternMark";
import styles from "./login/login.module.css";

export default function HomePage() {
  return (
    <main className={styles.page}>
      <div className={styles.gridGlow} aria-hidden="true" />
      <div className={styles.authShell}>
        <section className={styles.intro} aria-labelledby="launch-title">
          <div className={styles.brandLockup}>
            <span className={styles.logo}><LanternMark /></span>
            <strong>Lantern</strong>
          </div>
          <p className={styles.eyebrow}>CONVERSATION INTELLIGENCE</p>
          <h1 id="launch-title">Carry every conversation forward.</h1>
          <p className={styles.introCopy}>
            Lantern turns real client conversations into a searchable memory,
            clear commitments, and follow-ups that wait for your approval.
          </p>
          <ul className={styles.signalList}>
            <li><Headphones /><span>Original audio and transcript stay together</span></li>
            <li><Check /><span>Malaysian language and context become clear next steps</span></li>
            <li><ShieldCheck /><span>Nothing reaches a client until you approve it</span></li>
          </ul>
        </section>

        <section className={styles.card} aria-label="Open Lantern">
          <span className={styles.accessPill}><i /> SYSTEM READY</span>
          <p className={styles.cardKicker}>YOUR PRIVATE WORKSPACE</p>
          <h2>See what needs your attention.</h2>
          <p className={styles.description}>
            Review captured conversations, replay the source audio, and approve
            the meetings Lantern prepared for you.
          </p>
          <Link className={styles.googleButton} href="/dashboard">
            Open Lantern
            <span className={styles.buttonArrow} aria-hidden="true">→</span>
          </Link>
          <p className={styles.footnote}>Asia/Kuala_Lumpur · Approval required for every external action</p>
        </section>
      </div>
    </main>
  );
}
