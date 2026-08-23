import Link from "next/link";

import styles from "./login/login.module.css";

export default function HomePage() {
  return (
    <main className={styles.page}>
      <section className={styles.card} aria-labelledby="launch-title">
        <div className={styles.logo} aria-hidden="true">R</div>
        <p className={styles.eyebrow}>ROXANNE</p>
        <h1 id="launch-title">Your business memory, ready.</h1>
        <p className={styles.description}>
          Capture a conversation, turn it into commitments, and follow through.
        </p>
        <Link className={styles.googleButton} href="/dashboard">
          Open dashboard
        </Link>
        <p className={styles.footnote}>Live hackathon workspace</p>
      </section>
    </main>
  );
}
