"use client";

import type { Meeting } from "@/lib/types";
import { CalendarDay } from "./CalendarDay";

interface MonthCalendarProps {
  days: Array<{ date: Date; inMonth: boolean; isToday: boolean }>;
  weekdayLabels: string[];
  meetings: Meeting[];
  selectedDate: Date | null;
  selectedMeetingId: string | null;
  formatTime: (iso: string) => string;
  meetingsForDate: (date: Date) => Meeting[];
  onSelectDate: (date: Date) => void;
  onSelectMeeting: (meeting: Meeting) => void;
}

export function MonthCalendar(props: MonthCalendarProps) {
  return (
    <section className="month-calendar" aria-label="Month calendar">
      <div className="weekday-row" aria-hidden="true">
        {props.weekdayLabels.map((day) => <span key={day}>{day}</span>)}
      </div>
      <div className="calendar-grid">
        {props.days.map(({ date, inMonth, isToday }) => (
          <CalendarDay
            key={date.toISOString()}
            date={date}
            inMonth={inMonth}
            isToday={isToday}
            selectedDate={props.selectedDate}
            meetings={props.meetingsForDate(date)}
            selectedMeetingId={props.selectedMeetingId}
            formatTime={props.formatTime}
            onSelectDate={props.onSelectDate}
            onSelectMeeting={props.onSelectMeeting}
          />
        ))}
      </div>
    </section>
  );
}
