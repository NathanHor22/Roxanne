"use client";

import { useRef } from "react";
import { AnimatePresence, motion } from "motion/react";
import { CalendarPlus, Clock3, MessageCircle, Upload, X } from "lucide-react";
import type { Meeting } from "@/lib/types";
import { useLanguage } from "@/components/i18n/LanguageProvider";
import { Avatar } from "@/components/Common/Avatar";
import { AudioPlayer } from "./AudioPlayer";
import { InsightBlock } from "./InsightBlock";
import { TranscriptAccordion } from "./TranscriptAccordion";

interface MeetingDrawerProps {
  meeting: Meeting | null;
  onClose: () => void;
  onUpload: (file: File, meeting: Meeting) => void;
  onOpenFollowUp: (meeting: Meeting) => void;
  onSchedule: (meeting: Meeting) => void;
}

export function MeetingDrawer({ meeting, onClose, onUpload, onOpenFollowUp, onSchedule }: MeetingDrawerProps) {
  const { dict, locale } = useLanguage();
  const inputRef = useRef<HTMLInputElement>(null);
  const contact = meeting?.contacts[0];
  const insight = meeting?.insight;

  return (
    <AnimatePresence>
      {meeting ? (
        <>
          <motion.button type="button" className="drawer-backdrop" aria-label={dict.common.close} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={onClose} />
          <motion.aside className="meeting-drawer" initial={{ x: "100%", opacity: 0 }} animate={{ x: 0, opacity: 1 }} exit={{ x: "100%", opacity: 0 }} transition={{ type: "spring", stiffness: 300, damping: 30 }} aria-label={meeting.title}>
            <div className="meeting-drawer__handle" aria-hidden="true" />
            <header className="meeting-drawer__header">
              <div className="meeting-drawer__identity"><Avatar name={contact?.name || meeting.title} /><div><h2>{contact?.name || meeting.title}</h2><p>{contact?.company || meeting.title}</p></div></div>
              <button type="button" className="icon-button" onClick={onClose} aria-label={dict.common.close}><X /></button>
            </header>
            <div className="meeting-drawer__meta">
              <span><Clock3 />{new Intl.DateTimeFormat(locale, { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }).format(new Date(meeting.startAt))}</span>
              <span className={`status-pill status-pill--${meeting.status}`}>{dict.status[meeting.status]}</span>
            </div>
            <AudioPlayer src={meeting.recordingUrl} />
            {meeting.status === "processing" ? <div className="processing-card"><span className="processing-card__pulse" /><div><strong>{dict.meeting.processing}</strong><p>{dict.meeting.processingHint}</p></div></div> : null}
            {insight ? <div className="insight-grid"><InsightBlock label={dict.meeting.wants} value={insight.wants} tone="accent" /><InsightBlock label={dict.meeting.concern} value={insight.concern} /><InsightBlock label={dict.meeting.promised} value={insight.promised} /><InsightBlock label={dict.meeting.next} value={insight.next} /></div> : null}
            <TranscriptAccordion label={dict.meeting.transcript} segments={meeting.transcript} />
            <input ref={inputRef} className="visually-hidden" type="file" accept="audio/*,.m4a" onChange={(event) => { const file = event.target.files?.[0]; if (file) onUpload(file, meeting); event.target.value = ""; }} />
            <div className="meeting-drawer__actions">
              <button type="button" className="button button--ghost" onClick={() => inputRef.current?.click()}><Upload />{dict.meeting.uploadRecording}</button>
              <button type="button" className="button button--ghost" onClick={() => onSchedule(meeting)}><CalendarPlus />{dict.meeting.schedule}</button>
              <button type="button" className="button button--primary" onClick={() => onOpenFollowUp(meeting)}><MessageCircle />{dict.meeting.followUp}</button>
            </div>
          </motion.aside>
        </>
      ) : null}
    </AnimatePresence>
  );
}
