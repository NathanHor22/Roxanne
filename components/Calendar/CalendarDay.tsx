"use client";

import type { Meeting } from "@/lib/types";
import { MeetingChip } from "./MeetingChip";

interface CalendarDayProps {
  date: Date;
  inMonth: boolean;
  isToday: boolean;
  selectedDate: Date | null;
  meetings: Meeting[];
  selectedMeetingId: string | null;
  formatTime: (iso: string) => string;
  onSelectDate: (date: Date) => void;
  onSelectMeeting: (meeting: Meeting) => void;
}

function sameDate(a: Date | null, b: Date) {
  return Boolean(a && a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate());
}

export function CalendarDay({ date, inMonth, isToday, selectedDate, meetings, selectedMeetingId, formatTime, onSelectDate, onSelectMeeting }: CalendarDayProps) {
  return (
    <div
      className={`calendar-day${inMonth ? "" : " is-outside"}${isToday ? " is-today" : ""}${sameDate(selectedDate, date) ? " is-selected" : ""}`}
      onClick={() => onSelectDate(date)}
    >
      <button
        type="button"
        className="calendar-day__number"
        aria-pressed={sameDate(selectedDate, date)}
        aria-label={date.toLocaleDateString(undefined, { dateStyle: "full" })}
        onClick={(event) => {
          event.stopPropagation();
          onSelectDate(date);
        }}
      >
        {date.getDate()}
      </button>
      <span className="calendar-day__meetings">
        {meetings.slice(0, 3).map((meeting) => (
          <MeetingChip key={meeting.id} meeting={meeting} time={formatTime(meeting.startAt)} selected={meeting.id === selectedMeetingId} onClick={() => onSelectMeeting(meeting)} />
        ))}
        {meetings.length > 3 ? <span className="calendar-day__more">+{meetings.length - 3}</span> : null}
      </span>
    </div>
  );
}
