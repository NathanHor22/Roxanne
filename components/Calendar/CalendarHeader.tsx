"use client";

import { ChevronLeft, ChevronRight, Plus, Upload } from "lucide-react";
import { LanguageSwitcher } from "@/components/i18n/LanguageSwitcher";
import { useLanguage } from "@/components/i18n/LanguageProvider";
import { LiveRecorder } from "@/components/Meeting/LiveRecorder";

interface CalendarHeaderProps {
  monthLabel: string;
  onPrevious: () => void;
  onNext: () => void;
  onToday: () => void;
  onNewMeeting: () => void;
  onUpload: () => void;
  onLiveRecording: (file: File, channel: string) => void;
  onLiveError: (message: string) => void;
}

export function CalendarHeader({ monthLabel, onPrevious, onNext, onToday, onNewMeeting, onUpload, onLiveRecording, onLiveError }: CalendarHeaderProps) {
  const { dict } = useLanguage();
  return (
    <header className="calendar-header">
      <div className="calendar-header__title">
        <p className="section-kicker">{dict.nav.calendar}</p>
        <h1>{monthLabel}</h1>
      </div>
      <div className="calendar-header__actions">
        <LanguageSwitcher compact />
        <LiveRecorder onRecorded={onLiveRecording} onError={onLiveError} />
        <div className="segmented-control" aria-label="Calendar navigation">
          <button type="button" onClick={onPrevious} aria-label={dict.calendar.previousMonth}><ChevronLeft /></button>
          <button type="button" className="segmented-control__today" onClick={onToday}>{dict.calendar.today}</button>
          <button type="button" onClick={onNext} aria-label={dict.calendar.nextMonth}><ChevronRight /></button>
        </div>
        <button type="button" className="button button--ghost desktop-action" onClick={onUpload}><Upload /> {dict.calendar.upload}</button>
        <button type="button" className="button button--primary" onClick={onNewMeeting}><Plus /> <span>{dict.calendar.newMeeting}</span></button>
      </div>
    </header>
  );
}
