"use client";
import { useState } from "react";
import type { FollowUp } from "@/lib/types";
import styles from "./delivery.module.css";

export function EmailFollowUp({ task, recipient: initialRecipient, sample, onSent }: {
  task: FollowUp; recipient: string; sample: boolean; onSent: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [recipient, setRecipient] = useState(initialRecipient);
  const [subject, setSubject] = useState(task.description);
  const [body, setBody] = useState(task.draft || "");
  const [approved, setApproved] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [sent, setSent] = useState(false);
  const send = async () => {
    if (!approved || busy || sample) return;
    setBusy(true); setMessage("");
    try {
      const response = await fetch("/api/actions/email", { method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ followUpId: task.id, recipient, subject, body, approved: true }) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Could not confirm delivery.");
      setSent(true); setOpen(false); setMessage("Gmail confirmed this email was sent."); onSent();
    } catch (error) { setMessage(error instanceof Error ? error.message : "Check Gmail Sent before retrying."); }
    finally { setBusy(false); }
  };
  return <article className={styles.panel}>
    {!sent && <button type="button" disabled={sample || busy} onClick={() => { setOpen(!open); setApproved(false); }}>Review email: {task.description}</button>}
    {sample && <p>Connect Gmail in your workspace to send approved follow-ups.</p>}
    {open && <form className={styles.form} onSubmit={event => { event.preventDefault(); void send(); }}>
      <label>Recipient<input type="email" required maxLength={254} value={recipient} disabled={busy} onChange={e => { setRecipient(e.target.value); setApproved(false); }} /></label>
      <label>Subject<input required maxLength={240} value={subject} disabled={busy} onChange={e => { setSubject(e.target.value); setApproved(false); }} /></label>
      <label>Message<textarea required maxLength={2000} rows={7} value={body} disabled={busy} onChange={e => { setBody(e.target.value); setApproved(false); }} /></label>
      <label className={styles.consent}><input type="checkbox" checked={approved} disabled={busy} onChange={e => setApproved(e.target.checked)} />I approve sending this message to {recipient || "the recipient above"}.</label>
      <div className={styles.actions}><button disabled={busy || !approved}>{busy ? "Sending…" : "Approve and send email"}</button><button type="button" disabled={busy} onClick={() => setOpen(false)}>Cancel</button></div>
    </form>}
    {message && <p role="status">{message}</p>}
  </article>;
}
