"use client";

import { useEffect, useRef, useState } from "react";
import { FileText, Headphones, MessageSquare, X } from "lucide-react";
import type { Meeting } from "@/lib/types";
import { sourceConversation } from "@/lib/workspace/model";
import styles from "./workspace.module.css";

export const dateLabel = (
  value: string,
  options: Intl.DateTimeFormatOptions = {},
) =>
  new Intl.DateTimeFormat("en-MY", {
    timeZone: "Asia/Kuala_Lumpur",
    day: "numeric",
    month: "short",
    ...options,
  }).format(new Date(value));
export const timeLabel = (value: string) =>
  new Intl.DateTimeFormat("en-MY", {
    timeZone: "Asia/Kuala_Lumpur",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  }).format(new Date(value));
export const initials = (name: string) =>
  name
    .split(" ")
    .filter((word) => !["Mr", "Ms", "Mrs"].includes(word))
    .map((word) => word[0])
    .slice(0, 2)
    .join("");

export function ConversationPanel({
  meeting,
  meetings,
  onClose,
  onTask,
  working,
  error,
}: {
  meeting: Meeting | null;
  meetings: Meeting[];
  onClose: () => void;
  onTask: (id: string, completed: boolean) => void;
  working: string | null;
  error: string | null;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [tab, setTab] = useState<"recap" | "transcript">("recap");
  const conversation = meeting
    ? sourceConversation(meetings, meeting)
    : undefined;
  useEffect(() => {
    if (meeting) {
      setTab("recap");
      dialog.current?.showModal();
    } else dialog.current?.close();
  }, [meeting]);
  if (!meeting) return null;
  const contact = conversation?.contacts[0] || meeting.contacts[0];
  const insight = conversation?.insight;
  const tasks = (conversation?.followUps || []).filter(
    (task) => task.type !== "schedule" && task.status !== "dismissed",
  );
  const duration = conversation
    ? Math.round(
        (Date.parse(conversation.endAt) - Date.parse(conversation.startAt)) /
          60_000,
      )
    : 0;
  return (
    <dialog
      ref={dialog}
      className={styles.drawer}
      aria-labelledby="conversation-title"
      onCancel={onClose}
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div className={styles.drawerBody}>
        <header className={styles.drawerHeader}>
          <span className={styles.eyebrow}>
            {meeting.sourceConversationId ? "MEETING BRIEF" : "CONVERSATION"}
          </span>
          <button
            className={styles.iconButton}
            onClick={onClose}
            aria-label="Close conversation"
          >
            <X />
          </button>
        </header>
        <div className={styles.identity}>
          <span className={styles.avatar}>
            {initials(contact?.name || meeting.title)}
          </span>
          <div>
            <h2 id="conversation-title">{contact?.name || meeting.title}</h2>
            <p>{contact?.company || "Conversation details"}</p>
          </div>
        </div>
        {meeting.source === "calendar" && (
          <div className={styles.eventSummary}>
            <div>
              <span className={styles.smallLabel}>ON YOUR CALENDAR</span>
              <strong>{meeting.title}</strong>
            </div>
            <p>
              {dateLabel(meeting.startAt, { weekday: "short" })} ·{" "}
              {timeLabel(meeting.startAt)} – {timeLabel(meeting.endAt)}
            </p>
            {meeting.id.startsWith("sample:") && (
              <span className={styles.subtle}>Sample event</span>
            )}
          </div>
        )}
        {conversation && (
          <div className={styles.sourceStrip}>
            <Headphones />
            <span>From {dateLabel(conversation.startAt)} conversation</span>
            <span>{duration} min</span>
          </div>
        )}
        <div
          className={styles.tabs}
          role="group"
          aria-label="Conversation details"
        >
          <button
            aria-pressed={tab === "recap"}
            className={tab === "recap" ? styles.activeTab : ""}
            onClick={() => setTab("recap")}
          >
            Summary & follow-ups
          </button>
          <button
            aria-pressed={tab === "transcript"}
            className={tab === "transcript" ? styles.activeTab : ""}
            onClick={() => setTab("transcript")}
          >
            Transcript
          </button>
        </div>
        {error && (
          <p role="alert" className={styles.inlineError}>
            {error}
          </p>
        )}
        {tab === "recap" ? (
          <div
            role="region"
            aria-label="Summary and follow-ups"
            className={styles.recap}
          >
            {insight ? (
              <>
                <section>
                  <h3>
                    <FileText /> What you discussed
                  </h3>
                  <ul className={styles.recapPoints}>
                    {(insight.keyPoints.length
                      ? insight.keyPoints
                      : [insight.wants]
                    ).map((point, index) => (
                      <li key={index}>{point}</li>
                    ))}
                  </ul>
                </section>
                <section className={styles.takeNote}>
                  <h3>Keep in mind</h3>
                  <p>{insight.concern}</p>
                </section>
                <section>
                  <h3>
                    <MessageSquare /> What you promised
                  </h3>
                  <p>{insight.promised}</p>
                </section>
              </>
            ) : (
              <div className={styles.emptyInline}>
                <FileText />
                <h3>
                  {conversation?.status === "processing"
                    ? "Your recap is being prepared"
                    : "No conversation recap yet"}
                </h3>
                <p>
                  {conversation?.status === "failed"
                    ? "This conversation could not be processed. Its details are still available."
                    : "A linked conversation will bring the context for this meeting here."}
                </p>
              </div>
            )}
            {tasks.length > 0 && (
              <section>
                <h3>
                  Before the next meeting{" "}
                  <span className={styles.count}>
                    {tasks.filter((task) => task.status === "completed").length}
                    /{tasks.length}
                  </span>
                </h3>
                <div className={styles.checklist}>
                  {tasks.map((task) => (
                    <label
                      key={task.id}
                      className={
                        task.status === "completed" ? styles.completedTask : ""
                      }
                    >
                      <input
                        type="checkbox"
                        checked={task.status === "completed"}
                        disabled={Boolean(working)}
                        onChange={(event) =>
                          onTask(task.id, event.target.checked)
                        }
                      />
                      <span>
                        <strong>{task.description}</strong>
                        {task.dueAt && (
                          <small>Due {dateLabel(task.dueAt)}</small>
                        )}
                      </span>
                    </label>
                  ))}
                </div>
              </section>
            )}
            {conversation && (
              <section>
                <h3>Conversation details</h3>
                <dl className={styles.detailList}>
                  <div>
                    <dt>Captured</dt>
                    <dd>
                      {dateLabel(conversation.startAt, { year: "numeric" })},{" "}
                      {timeLabel(conversation.startAt)}
                    </dd>
                  </div>
                  <div>
                    <dt>Duration</dt>
                    <dd>{duration} minutes</dd>
                  </div>
                  <div>
                    <dt>Source</dt>
                    <dd>
                      {conversation.id.startsWith("sample:")
                        ? "Sample wearable conversation"
                        : conversation.source === "hardware"
                          ? "Wearable"
                          : "Recording"}
                    </dd>
                  </div>
                  {insight?.detectedLanguage && (
                    <div>
                      <dt>Languages</dt>
                      <dd>{insight.detectedLanguage}</dd>
                    </div>
                  )}
                </dl>
              </section>
            )}
            {meeting.sourceConversationId && (
              <p className={styles.privateNote}>
                This brief is private to your Roxanne workspace.
              </p>
            )}
          </div>
        ) : (
          <div
            role="region"
            aria-label="Transcript"
            className={styles.transcript}
          >
            {conversation?.recordingUrl && (
              <audio
                controls
                src={conversation.recordingUrl}
                className={styles.audio}
              />
            )}
            {conversation?.transcript?.length ? (
              conversation.transcript.map((segment, index) => (
                <article key={segment.id || index}>
                  <div>
                    <strong>{segment.speaker}</strong>
                    {segment.startSeconds !== undefined && (
                      <span>
                        {String(Math.floor(segment.startSeconds / 60)).padStart(
                          2,
                          "0",
                        )}
                        :
                        {String(Math.floor(segment.startSeconds % 60)).padStart(
                          2,
                          "0",
                        )}
                      </span>
                    )}
                  </div>
                  <p>{segment.text}</p>
                </article>
              ))
            ) : (
              <p className={styles.subtle}>
                No transcript is available for this meeting.
              </p>
            )}
          </div>
        )}
      </div>
    </dialog>
  );
}
