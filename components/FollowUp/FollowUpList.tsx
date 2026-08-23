"use client";

import { AnimatePresence } from "motion/react";
import type { Contact, FollowUp } from "@/lib/types";
import { useLanguage } from "@/components/i18n/LanguageProvider";
import { FollowUpRow } from "./FollowUpRow";

interface FollowUpListProps {
  followUps: FollowUp[];
  contacts: Contact[];
  formatDue: (iso: string | null) => string;
  isOverdue: (followUp: FollowUp) => boolean;
  onOpen: (followUp: FollowUp) => void;
  onComplete: (followUp: FollowUp) => void;
}

export function FollowUpList({ followUps, contacts, formatDue, isOverdue, onOpen, onComplete }: FollowUpListProps) {
  const { dict } = useLanguage();
  const pending = followUps.filter((item) => item.status !== "completed");
  return (
    <section className="follow-up-list">
      <header className="follow-up-list__header"><p className="section-kicker">{dict.followUp.title}</p><span>{pending.length}</span></header>
      <div className="follow-up-list__rows">
        <AnimatePresence initial={false}>
          {pending.map((followUp) => <FollowUpRow key={followUp.id} followUp={followUp} contact={contacts.find((contact) => contact.id === followUp.contactId)} dueLabel={formatDue(followUp.dueAt)} overdue={isOverdue(followUp)} onOpen={() => onOpen(followUp)} onComplete={() => onComplete(followUp)} />)}
        </AnimatePresence>
      </div>
    </section>
  );
}
