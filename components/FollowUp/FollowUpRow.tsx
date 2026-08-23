"use client";

import { motion } from "motion/react";
import { Check, ChevronRight } from "lucide-react";
import type { Contact, FollowUp } from "@/lib/types";

interface FollowUpRowProps {
  followUp: FollowUp;
  contact?: Contact;
  dueLabel: string;
  overdue: boolean;
  onOpen: () => void;
  onComplete: () => void;
}

export function FollowUpRow({ followUp, contact, dueLabel, overdue, onOpen, onComplete }: FollowUpRowProps) {
  return (
    <motion.div className="follow-up-row" layout exit={{ height: 0, opacity: 0 }}>
      <button type="button" className="follow-up-row__check" onClick={onComplete} aria-label="Complete follow-up"><Check /></button>
      <button type="button" className="follow-up-row__main" onClick={onOpen}>
        <span className="follow-up-row__person">{contact?.name?.split(" ")[0] || "Contact"}</span>
        <span className="follow-up-row__task">{followUp.description}</span>
        <span className={overdue ? "follow-up-row__due is-overdue" : "follow-up-row__due"}>{dueLabel}</span>
        <ChevronRight />
      </button>
    </motion.div>
  );
}
