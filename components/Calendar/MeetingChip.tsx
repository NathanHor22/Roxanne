"use client";

import { motion } from "motion/react";
import { AlertCircle, Check, LoaderCircle } from "lucide-react";
import { getMeetingVisualState, type MeetingVisualState } from "@/lib/calendar";
import type { Meeting } from "@/lib/types";

interface MeetingChipProps {
  meeting: Meeting;
  time: string;
  selected: boolean;
  onClick: () => void;
}

function StateIcon({ state }: { state: MeetingVisualState }) {
  if (state === "processing") return <LoaderCircle className="spin" aria-hidden="true" />;
  if (state === "failed" || state === "overdue") return <AlertCircle aria-hidden="true" />;
  if (state === "completed" || state === "recording-available") return <Check aria-hidden="true" />;
  return <span className="meeting-chip__dot" aria-hidden="true" />;
}

export function MeetingChip({ meeting, time, selected, onClick }: MeetingChipProps) {
  const primary = meeting.contacts[0];
  const label = primary?.name?.split(" ")[0] || meeting.title;
  const visualState = getMeetingVisualState(meeting);

  return (
    <motion.button
      type="button"
      className={`meeting-chip meeting-chip--${visualState}${selected ? " is-selected" : ""}`}
      whileHover={{ scale: 1.01 }}
      whileTap={{ scale: 0.98 }}
      transition={{ duration: 0.16 }}
      onClick={(event) => {
        event.stopPropagation();
        onClick();
      }}
      aria-label={`${time} ${meeting.title}`}
    >
      <span className="meeting-chip__state"><StateIcon state={visualState} /></span>
      <span className="meeting-chip__time">{time}</span>
      <span className="meeting-chip__name">{label}</span>
    </motion.button>
  );
}
