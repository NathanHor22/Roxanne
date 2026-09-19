"use client";

import { useEffect, useRef, useState } from "react";
import {
  ArrowLeft,
  Building2,
  CalendarDays,
  Check,
  CheckCircle2,
  Clock3,
  FileText,
  Headphones,
  Mail,
  Pencil,
  Save,
  ShieldCheck,
  Sparkles,
  UserRound,
  X,
} from "lucide-react";

import type { Contact, Meeting } from "@/lib/types";
import {
  getApprovals,
  missingApprovalDetails,
  type MeetingApproval,
  type WorkspaceMode,
} from "@/lib/workspace/model";
import { ConversationReplay, type PlaybackProgress } from "./ConversationReplay";
import { dateLabel, initials, timeLabel } from "./ConversationPanel";
import styles from "./conversation-detail.module.css";

type EditableContact = Pick<Contact, "name" | "company" | "role" | "email">;

export function ConversationDetail({
  conversation,
  mode,
  working,
  error,
  onBack,
  onTask,
  onEditApproval,
  onApprove,
  onUpdateContact,
}: {
  conversation: Meeting;
  mode: WorkspaceMode;
  working: string | null;
  error: string | null;
  onBack: () => void;
  onTask: (id: string, completed: boolean) => void;
  onEditApproval: (approval: MeetingApproval) => void;
  onApprove: (approval: MeetingApproval) => void;
  onUpdateContact: (id: string, changes: EditableContact) => Promise<boolean>;
}) {
  const playback = useRef<PlaybackProgress | undefined>(undefined);
  const contact = conversation.contacts[0] || null;
  const insight = conversation.insight;
  const approvals = getApprovals([conversation]).filter(
    (approval) => approval.status === "pending",
  );
  const tasks = (conversation.followUps || []).filter(
    (task) => task.type !== "schedule" && task.status !== "dismissed",
  );
  const commitments = insight?.commitments || [];
  const durationMinutes = Math.max(
    1,
    Math.round(
      (Date.parse(conversation.endAt) - Date.parse(conversation.startAt)) /
        60_000,
    ),
  );
  const [editingContact, setEditingContact] = useState(false);
  const [contactDraft, setContactDraft] = useState<EditableContact>({
    name: contact?.name || "",
    company: contact?.company || null,
    role: contact?.role || null,
    email: contact?.email || null,
  });

  useEffect(() => {
    setContactDraft({
      name: contact?.name || "",
      company: contact?.company || null,
      role: contact?.role || null,
      email: contact?.email || null,
    });
  }, [contact?.name, contact?.company, contact?.role, contact?.email]);

  const saveContact = async () => {
    if (!contact || !contactDraft.name.trim()) return;
    const saved = await onUpdateContact(contact.id, {
      name: contactDraft.name.trim(),
      company: contactDraft.company?.trim() || null,
      role: contactDraft.role?.trim() || null,
      email: contactDraft.email?.trim().toLowerCase() || null,
    });
    if (saved) setEditingContact(false);
  };

  return (
    <div className={styles.detail}>
      <button className={styles.back} onClick={onBack}>
        <ArrowLeft /> All conversations
      </button>

      <header className={styles.hero}>
        <div className={styles.heroIdentity}>
          <span className={styles.heroAvatar}>
            {initials(contact?.name || conversation.title)}
          </span>
          <div>
            <div className={styles.heroMeta}>
              <span className={styles.status}>{conversation.status}</span>
              <span>{dateLabel(conversation.startAt, { year: "numeric" })}</span>
              <span>{timeLabel(conversation.startAt)}</span>
            </div>
            <h2>{contact?.name || conversation.title}</h2>
            <p>
              {contact?.company || conversation.title}
              {contact?.role ? ` · ${contact.role}` : ""}
            </p>
          </div>
        </div>
        <dl className={styles.heroFacts}>
          <div><dt><Clock3 /> Duration</dt><dd>{durationMinutes} min</dd></div>
          <div><dt><Headphones /> Source</dt><dd>{conversation.source === "hardware" ? "Lantern" : conversation.source}</dd></div>
          <div><dt><FileText /> Transcript</dt><dd>{conversation.transcript?.length || 0} segments</dd></div>
        </dl>
      </header>

      {error && <p className={styles.pageError} role="alert">{error}</p>}

      <div className={styles.detailGrid}>
        <main className={styles.replayColumn}>
          <ConversationReplay
            key={conversation.id}
            conversation={conversation}
            initialProgress={playback.current}
            onProgress={(progress) => {
              playback.current = progress;
            }}
          />
        </main>

        <aside className={styles.contextColumn}>
          <section className={styles.contextCard}>
            <header className={styles.cardHeader}>
              <div>
                <span className={styles.kicker}>CONTACT</span>
                <h3>Who you spoke with</h3>
              </div>
              {contact && !editingContact && (
                <button onClick={() => setEditingContact(true)}>
                  <Pencil /> Correct
                </button>
              )}
            </header>
            {contact ? editingContact ? (
              <form
                className={styles.contactForm}
                onSubmit={(event) => {
                  event.preventDefault();
                  void saveContact();
                }}
              >
                <label>Name<input required maxLength={120} value={contactDraft.name} onChange={(event) => setContactDraft((current) => ({ ...current, name: event.target.value }))} /></label>
                <label>Company<input maxLength={160} value={contactDraft.company || ""} onChange={(event) => setContactDraft((current) => ({ ...current, company: event.target.value }))} /></label>
                <label>Role<input maxLength={120} value={contactDraft.role || ""} onChange={(event) => setContactDraft((current) => ({ ...current, role: event.target.value }))} /></label>
                <label>Email<input type="email" maxLength={320} value={contactDraft.email || ""} onChange={(event) => setContactDraft((current) => ({ ...current, email: event.target.value }))} /></label>
                <div className={styles.formActions}>
                  <button type="button" onClick={() => setEditingContact(false)}><X /> Cancel</button>
                  <button type="submit" disabled={Boolean(working) || !contactDraft.name.trim()}><Save /> Save</button>
                </div>
              </form>
            ) : (
              <div className={styles.contactDetails}>
                <span className={styles.contactAvatar}>{initials(contact.name)}</span>
                <div><strong>{contact.name}</strong><p>{contact.role || "Role not confirmed"}</p></div>
                <dl>
                  <div><dt><Building2 /> Company</dt><dd>{contact.company || "Not confirmed"}</dd></div>
                  <div><dt><Mail /> Email</dt><dd>{contact.email || "Not confirmed"}</dd></div>
                </dl>
                <p className={styles.verifyNote}><ShieldCheck /> Review these details before sending a follow-up.</p>
              </div>
            ) : (
              <div className={styles.emptyCard}><UserRound /><strong>No person identified yet</strong><p>{conversation.transcript?.length ? "The transcript remains available for manual review." : conversation.recordingId ? "The original recording remains available for manual review." : "No recording or transcript is available."}</p></div>
            )}
          </section>

          <section className={styles.contextCard}>
            <header className={styles.cardHeader}>
              <div><span className={styles.kicker}>MEETING BRIEF</span><h3>What mattered</h3></div>
              <Sparkles />
            </header>
            {insight ? (
              <div className={styles.brief}>
                <ul>{(insight.keyPoints.length ? insight.keyPoints : [insight.wants]).map((point, index) => <li key={index}>{point}</li>)}</ul>
                {insight.concern && <div className={styles.concern}><strong>Keep in mind</strong><p>{insight.concern}</p></div>}
                {insight.promised && <div><strong>You promised</strong><p>{insight.promised}</p></div>}
                {insight.next && <div><strong>Recommended next step</strong><p>{insight.next}</p></div>}
              </div>
            ) : (
              <div className={styles.emptyCard}><FileText /><strong>{conversation.status === "processing" ? "Preparing the brief" : "No brief available"}</strong><p>{conversation.transcript?.length ? "The original transcript is still available." : conversation.recordingId ? "The original recording is still available." : "No recording or transcript is available."}</p></div>
            )}
          </section>

          {(approvals.length > 0 || tasks.length > 0 || commitments.length > 0) && (
            <section className={styles.contextCard}>
              <header className={styles.cardHeader}>
                <div><span className={styles.kicker}>FOLLOW-THROUGH</span><h3>Commitments and approvals</h3></div>
                <CheckCircle2 />
              </header>
              {approvals.map((approval) => {
                const missing = missingApprovalDetails(approval.details);
                return (
                  <article className={styles.approval} key={approval.id}>
                    <span><CalendarDays /> Calendar approval</span>
                    <strong>{approval.title}</strong>
                    <p>{approval.details.startAt ? `${dateLabel(approval.details.startAt, { weekday: "short" })} at ${timeLabel(approval.details.startAt)}` : "Date and time need review"}</p>
                    <button disabled={Boolean(working)} onClick={() => missing.length ? onEditApproval(approval) : onApprove(approval)}>
                      <Check /> {missing.length ? "Review details" : mode === "sample" ? "Add to sample" : "Approve meeting"}
                    </button>
                  </article>
                );
              })}
              <div className={styles.taskList}>
                {tasks.map((task) => (
                  <label key={task.id} className={task.status === "completed" ? styles.taskComplete : ""}>
                    <input type="checkbox" checked={task.status === "completed"} disabled={Boolean(working)} onChange={(event) => onTask(task.id, event.target.checked)} />
                    <span><strong>{task.description}</strong>{task.dueAt && <small>Due {dateLabel(task.dueAt)}</small>}</span>
                  </label>
                ))}
                {commitments.map((commitment, index) => (
                  <div className={styles.commitment} key={commitment.id || index}>
                    <CheckCircle2 />
                    <span><strong>{commitment.description}</strong><small>{commitment.ownerType === "user" ? "Your commitment" : "Client commitment"}{commitment.dueAt ? ` · ${dateLabel(commitment.dueAt)}` : ""}</small></span>
                  </div>
                ))}
              </div>
            </section>
          )}
        </aside>
      </div>
    </div>
  );
}
