"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { CalendarDays, Check, CircleUserRound, Cloud, Plus, Settings, Upload, X } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { CalendarHeader } from "@/components/Calendar/CalendarHeader";
import { MonthCalendar } from "@/components/Calendar/MonthCalendar";
import { FollowUpComposer } from "@/components/FollowUp/FollowUpComposer";
import { FollowUpList } from "@/components/FollowUp/FollowUpList";
import { MeetingDrawer } from "@/components/Meeting/MeetingDrawer";
import { PeopleView } from "@/components/People/PeopleView";
import { SettingsView } from "@/components/Settings/SettingsView";
import { useLanguage } from "@/components/i18n/LanguageProvider";
import { MAX_AUDIO_BYTES, normalizeAudioContentType } from "@/lib/audio-upload";
import {
  formatCompactDate,
  formatCompactTime,
  formatMonthTitle,
  formatWeekdayLabels,
  getMeetingsForDay,
  getMonthGrid,
  isFollowUpOverdue,
} from "@/lib/calendar";
import { DEMO_MONTH, DEMO_NOW, demoContacts, demoFollowUps, demoMeetings } from "@/lib/demo-data";
import { getBrowserSupabase } from "@/lib/supabase/browser";
import type { FollowUp, Meeting } from "@/lib/types";

type View = "calendar" | "people" | "settings";

const emptyIntegrationStatus = {
  supabase: false, elevenlabs: false, qwen: false, devin: false,
  whatsapp: false, google: false, agora: false, redis: false,
  whatsappRelay: false,
};

function monthKey(date: Date) {
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
}

function moveMonth(date: Date, amount: number) {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + amount, 15, 12));
}

function nextThursdayInMalaysia(...timestamps: string[]) {
  const latest = Math.max(Date.now(), ...timestamps.map(Date.parse).filter(Number.isFinite));
  const malaysiaWallClock = new Date(latest + 8 * 60 * 60_000);
  const daysAhead = (4 - malaysiaWallClock.getUTCDay() + 7) % 7 || 7;
  malaysiaWallClock.setUTCDate(malaysiaWallClock.getUTCDate() + daysAhead);
  return malaysiaWallClock.toISOString().slice(0, 10);
}

export function RoxanneApp() {
  const { dict, locale } = useLanguage();
  const [view, setView] = useState<View>("calendar");
  const [visibleMonth, setVisibleMonth] = useState(() => new Date("2026-08-15T12:00:00Z"));
  const [meetings, setMeetings] = useState<Meeting[]>(demoMeetings);
  const [meetingSource, setMeetingSource] = useState<"seed" | "supabase">("seed");
  const [followUps, setFollowUps] = useState<FollowUp[]>(demoFollowUps);
  const [selectedDate, setSelectedDate] = useState<Date | null>(new Date("2026-08-23T00:00:00Z"));
  const [selectedMeetingId, setSelectedMeetingId] = useState<string | null>(null);
  const [selectedPersonId, setSelectedPersonId] = useState<string | null>(demoContacts[0]?.id || null);
  const [composerId, setComposerId] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [integrationStatus, setIntegrationStatus] = useState<Record<string, boolean>>(emptyIntegrationStatus);
  const [newMeetingOpen, setNewMeetingOpen] = useState(false);
  const [scheduleMeeting, setScheduleMeeting] = useState<Meeting | null>(null);
  const globalUploadRef = useRef<HTMLInputElement>(null);

  const selectedMeeting = meetings.find((meeting) => meeting.id === selectedMeetingId) || null;
  const composer = followUps.find((item) => item.id === composerId) || null;
  const contacts = useMemo(() => {
    const available = meetingSource === "supabase"
      ? meetings.flatMap((meeting) => meeting.contacts)
      : [...demoContacts, ...meetings.flatMap((meeting) => meeting.contacts)];
    return [...new Map(available.map((contact) => [contact.id, contact])).values()];
  }, [meetingSource, meetings]);
  const composerMeeting = meetings.find((meeting) => meeting.id === composer?.meetingId) || null;
  const composerContact = contacts.find((contact) => contact.id === composer?.contactId) || composerMeeting?.contacts[0];
  const scheduleFollowUp = followUps.find((item) =>
    item.meetingId === scheduleMeeting?.id &&
    item.type === "schedule" &&
    item.status !== "completed"
  ) || null;
  const calendarDays = useMemo(() => getMonthGrid(monthKey(visibleMonth), { today: DEMO_NOW }), [visibleMonth]);

  useEffect(() => {
    const query = new URLSearchParams(window.location.search);
    const requestedView = query.get("view");
    if (requestedView === "calendar" || requestedView === "people" || requestedView === "settings") {
      setView(requestedView);
    }
    const googleResult = query.get("google");
    if (googleResult === "connected") setToast(dict.settings.connected);
    if (googleResult === "denied" || googleResult === "error") {
      setToast(dict.errors.integrationUnavailable);
    }
  }, [dict.errors.integrationUnavailable, dict.settings.connected]);

  useEffect(() => {
    fetch("/api/integrations")
      .then((response) => response.ok ? response.json() : Promise.reject())
      .then((payload) => setIntegrationStatus(payload.integrations || emptyIntegrationStatus))
      .catch(() => setIntegrationStatus(emptyIntegrationStatus));
  }, []);

  useEffect(() => {
    fetch("/api/meetings")
      .then((response) => response.ok ? response.json() : Promise.reject())
      .then((payload: { meetings?: Meeting[]; source?: string }) => {
        if (payload.source !== "supabase" || !Array.isArray(payload.meetings)) return;
        setMeetings(payload.meetings);
        setMeetingSource("supabase");
        setFollowUps(payload.meetings.flatMap((meeting) => meeting.followUps || []));
      })
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(null), 3500);
    return () => window.clearTimeout(timer);
  }, [toast]);

  const selectMeeting = (meeting: Meeting) => {
    setSelectedMeetingId(meeting.id);
    setSelectedDate(new Date(meeting.startAt));
  };

  const uploadRecording = async (file: File, target?: Meeting | null, source: "upload" | "agora" = "upload") => {
    if (file.size === 0) {
      setToast(dict.errors.unsupportedFile);
      return;
    }
    if (file.size > MAX_AUDIO_BYTES) {
      setToast(`${dict.errors.fileTooLarge} (25 MB max)`);
      return;
    }
    const normalizedContentType = normalizeAudioContentType(file.name, file.type);
    if (!normalizedContentType) {
      setToast(dict.errors.unsupportedFile);
      return;
    }

    const objectUrl = URL.createObjectURL(file);
    const meetingId = target?.id || `meeting-upload-${Date.now()}`;
    let meetingContext = target || meetings.find((item) => item.id === meetingId) || null;
    if (!target) {
      const start = selectedDate || new Date();
      const created: Meeting = {
        id: meetingId,
        title: file.name.replace(/\.[^.]+$/, "") || "New conversation",
        startAt: start.toISOString(),
        endAt: new Date(start.getTime() + 30 * 60_000).toISOString(),
        status: "processing",
        source,
        contacts: [],
        recordingUrl: objectUrl,
      };
      meetingContext = created;
      setMeetings((current) => [...current, created]);
      setSelectedMeetingId(meetingId);
    } else {
      setMeetings((current) => current.map((item) => item.id === meetingId ? { ...item, status: "processing", recordingUrl: objectUrl } : item));
    }

    try {
      const uploadAuthorizationResponse = await fetch("/api/recordings/upload-url", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          fileName: file.name,
          contentType: normalizedContentType,
          size: file.size,
          ...(meetingContext ? { startAt: meetingContext.startAt } : {}),
        }),
      });
      const uploadAuthorization = await uploadAuthorizationResponse.json().catch(() => ({})) as {
        error?: string;
        recordingId?: string;
        storagePath?: string;
        token?: string;
        contentType?: string;
      };

      let response: Response;
      if (uploadAuthorizationResponse.ok && uploadAuthorization.recordingId && uploadAuthorization.storagePath && uploadAuthorization.token && uploadAuthorization.contentType) {
        const supabase = getBrowserSupabase();
        if (!supabase) {
          throw new Error("Private upload is not configured. Add the public Supabase URL and anon key.");
        }
        const { error: uploadError } = await supabase.storage
          .from("recordings")
          .uploadToSignedUrl(uploadAuthorization.storagePath, uploadAuthorization.token, file, {
            contentType: uploadAuthorization.contentType,
          });
        if (uploadError) throw new Error(`Private audio upload failed: ${uploadError.message}`);

        response = await fetch("/api/process-meeting", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            recordingId: uploadAuthorization.recordingId,
            storagePath: uploadAuthorization.storagePath,
            fileName: file.name,
            contentType: uploadAuthorization.contentType,
            size: file.size,
            meetingId,
            locale,
            source,
            ...(meetingContext ? {
              title: meetingContext.title,
              startAt: meetingContext.startAt,
              endAt: meetingContext.endAt,
              ...(meetingContext.contacts[0] ? { contact: meetingContext.contacts[0] } : {}),
            } : {}),
          }),
        });
      } else if (process.env.NODE_ENV !== "production" && uploadAuthorizationResponse.status === 503) {
        // Deterministic local smoke tests can run without Supabase credentials.
        // This branch is removed from the production bundle and production's
        // processing route independently rejects multipart audio.
        const form = new FormData();
        form.set("audio", file);
        form.set("meetingId", meetingId);
        form.set("locale", locale);
        form.set("source", source);
        if (meetingContext) {
          form.set("title", meetingContext.title);
          form.set("startAt", meetingContext.startAt);
          form.set("endAt", meetingContext.endAt);
          if (meetingContext.contacts[0]) form.set("contact", JSON.stringify(meetingContext.contacts[0]));
        }
        response = await fetch("/api/process-meeting", { method: "POST", body: form });
      } else {
        throw new Error(uploadAuthorization.error || "Private audio upload could not be authorized.");
      }

      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "Processing failed");
      const processed = payload.meeting as Meeting;
      setMeetings((current) => current.map((item) => item.id === meetingId ? { ...item, ...processed, recordingUrl: objectUrl } : item));
      if (Array.isArray(processed.followUps)) {
        setFollowUps((current) => [...current.filter((item) => item.meetingId !== meetingId), ...processed.followUps!]);
      }
      setToast(dict.processing.ready);
    } catch (error) {
      setMeetings((current) => current.map((item) => item.id === meetingId ? { ...item, status: "failed" } : item));
      setToast(error instanceof Error ? error.message : dict.meeting.failed);
    }
  };

  const createMeeting = async (name: string, company: string, email: string, time: string) => {
    const day = selectedDate || new Date();
    const [hours, minutes] = time.split(":").map(Number);
    const start = new Date(Date.UTC(day.getUTCFullYear(), day.getUTCMonth(), day.getUTCDate(), hours - 8, minutes));
    const id = `meeting-manual-${Date.now()}`;
    const contact = { id: `contact-manual-${Date.now()}`, name, company: company || null, email: email || null };
    const meeting: Meeting = { id, title: company ? `${name} · ${company}` : name, startAt: start.toISOString(), endAt: new Date(start.getTime() + 30 * 60_000).toISOString(), status: "upcoming", source: "manual", contacts: [contact] };
    try {
      const response = await fetch("/api/meetings", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ clientReference: id, title: meeting.title, startAt: meeting.startAt, endAt: meeting.endAt, contact: { name, company: company || null, email: email || null } }),
      });
      const payload = await response.json().catch(() => ({})) as { error?: string; meeting?: Meeting };
      if (!response.ok || !payload.meeting) throw new Error(payload.error || "Meeting could not be saved.");
      setMeetings((current) => [...current, payload.meeting!]);
      setSelectedMeetingId(payload.meeting.id);
      setNewMeetingOpen(false);
      setToast(dict.common.done);
    } catch (cause) {
      setToast(cause instanceof Error ? cause.message : dict.errors.generic);
    }
  };

  const sendWhatsApp = async (followUp: FollowUp, body: string) => {
    const response = await fetch("/api/actions/whatsapp/send", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ followUpId: followUp.id, meetingId: followUp.meetingId, body, recipient: "601154444038", approved: true }),
    });
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.error || "WhatsApp send failed");
    setFollowUps((current) => current.map((item) => item.id === followUp.id ? { ...item, status: "completed", draft: body } : item));
  };

  const completeFollowUp = async (followUp: FollowUp) => {
    try {
      const response = await fetch(`/api/follow-ups/${encodeURIComponent(followUp.id)}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ status: "completed" }),
      });
      const payload = await response.json().catch(() => ({})) as { error?: string };
      if (!response.ok) throw new Error(payload.error || "Follow-up could not be completed.");
      setFollowUps((current) => current.map((item) => item.id === followUp.id ? { ...item, status: "completed" } : item));
    } catch (cause) {
      setToast(cause instanceof Error ? cause.message : dict.errors.generic);
    }
  };

  const prepareFollowUp = useCallback(async (followUp: FollowUp, contact?: (typeof contacts)[number]) => {
    const meeting = meetings.find((entry) => entry.id === followUp.meetingId);
    const response = await fetch("/api/actions/prepare-follow-up", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        contact: contact || meeting?.contacts[0] || "Client",
        company: contact?.company || meeting?.contacts[0]?.company || null,
        meetingInsight: meeting?.insight || `${meeting?.title || "Conversation"}: ${followUp.description}`,
        commitments: meeting?.insight?.commitments || [],
        locale,
      }),
    });
    const payload = await response.json().catch(() => ({})) as {
      error?: string;
      proposal?: { whatsappMessage: string; provider: "devin" | "fallback"; warning?: string };
    };
    if (!response.ok || !payload.proposal) {
      throw new Error(payload.error || "Follow-up preparation failed.");
    }
    return {
      body: payload.proposal.whatsappMessage,
      provider: payload.proposal.provider,
      warning: payload.proposal.warning,
    };
  }, [locale, meetings]);

  const navItems: Array<{ id: View; label: string; icon: typeof CalendarDays }> = [
    { id: "calendar", label: dict.nav.calendar, icon: CalendarDays },
    { id: "people", label: dict.nav.people, icon: CircleUserRound },
    { id: "settings", label: dict.nav.settings, icon: Settings },
  ];

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand"><span>R</span><strong>Roxanne</strong></div>
        <nav aria-label="Primary navigation">
          {navItems.map(({ id, label, icon: Icon }) => <button type="button" key={id} className={view === id ? "is-active" : ""} onClick={() => setView(id)}><Icon /><span>{label}</span></button>)}
        </nav>
        <div className="sidebar__sync"><Cloud /><span><strong>{dict.integrations.available}</strong><small>{dict.integrations.redis}</small></span><i /></div>
        <button type="button" className="sidebar__account"><span>NH</span><span><strong>Nathan Hor</strong><small>nathanhor2001@gmail.com</small></span></button>
      </aside>

      <main className="workspace">
        {view === "calendar" ? (
          <>
            <CalendarHeader monthLabel={formatMonthTitle(monthKey(visibleMonth), locale)} onPrevious={() => setVisibleMonth((date) => moveMonth(date, -1))} onNext={() => setVisibleMonth((date) => moveMonth(date, 1))} onToday={() => { setVisibleMonth(new Date("2026-08-15T12:00:00Z")); setSelectedDate(new Date("2026-08-23T00:00:00Z")); }} onNewMeeting={() => setNewMeetingOpen(true)} onUpload={() => globalUploadRef.current?.click()} onLiveRecording={(file) => void uploadRecording(file, null, "agora")} onLiveError={setToast} />
            <div className="calendar-surface">
              <MonthCalendar
                days={calendarDays.map((day) => ({ date: day.date, inMonth: day.inCurrentMonth, isToday: day.isToday }))}
                weekdayLabels={formatWeekdayLabels(locale)}
                meetings={meetings}
                selectedDate={selectedDate}
                selectedMeetingId={selectedMeetingId}
                formatTime={(iso) => formatCompactTime(iso, locale)}
                meetingsForDate={(date) => getMeetingsForDay(meetings, date)}
                onSelectDate={setSelectedDate}
                onSelectMeeting={selectMeeting}
              />
              <FollowUpList
                followUps={followUps}
                contacts={contacts}
                formatDue={(due) => due ? formatCompactDate(due, locale) : "—"}
                isOverdue={(item) => isFollowUpOverdue(item, DEMO_NOW)}
                onOpen={(item) => { setComposerId(item.id); const meeting = meetings.find((entry) => entry.id === item.meetingId); if (meeting) setSelectedMeetingId(meeting.id); }}
                onComplete={(item) => void completeFollowUp(item)}
              />
            </div>
          </>
        ) : null}
        {view === "people" ? <PeopleView contacts={contacts} meetings={meetings} selectedId={selectedPersonId} onSelect={setSelectedPersonId} onOpenMeeting={(meeting) => { setView("calendar"); selectMeeting(meeting); }} /> : null}
        {view === "settings" ? <SettingsView status={integrationStatus} /> : null}
      </main>

      <nav className="mobile-nav" aria-label="Primary navigation">
        {navItems.map(({ id, label, icon: Icon }) => <button type="button" key={id} className={view === id ? "is-active" : ""} onClick={() => setView(id)}><Icon /><span>{label}</span></button>)}
      </nav>

      <input ref={globalUploadRef} className="visually-hidden" type="file" accept="audio/*,.m4a" onChange={(event) => { const file = event.target.files?.[0]; if (file) void uploadRecording(file, selectedMeeting); event.target.value = ""; }} />
      <MeetingDrawer meeting={selectedMeeting} onClose={() => setSelectedMeetingId(null)} onUpload={(file, meeting) => void uploadRecording(file, meeting)} onOpenFollowUp={(meeting) => { const item = followUps.find((entry) => entry.meetingId === meeting.id && entry.status !== "completed"); if (item) setComposerId(item.id); else setToast(dict.followUp.noFollowUps); }} onSchedule={setScheduleMeeting} />
      <FollowUpComposer followUp={composer} contact={composerContact} onClose={() => setComposerId(null)} onPrepare={prepareFollowUp} onSend={sendWhatsApp} />
      <NewMeetingModal open={newMeetingOpen} onClose={() => setNewMeetingOpen(false)} onCreate={createMeeting} />
      <ScheduleModal meeting={scheduleMeeting} followUp={scheduleFollowUp} onClose={() => setScheduleMeeting(null)} onError={setToast} onScheduled={(created) => { setMeetings((current) => [...current, created]); if (scheduleFollowUp) setFollowUps((current) => current.map((item) => item.id === scheduleFollowUp.id ? { ...item, status: "completed" } : item)); setScheduleMeeting(null); setToast(dict.followUp.sent); }} />
      <AnimatePresence>{toast ? <motion.div className="toast" initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 8 }}><Check />{toast}</motion.div> : null}</AnimatePresence>
    </div>
  );
}

function NewMeetingModal({ open, onClose, onCreate }: { open: boolean; onClose: () => void; onCreate: (name: string, company: string, email: string, time: string) => Promise<void> }) {
  const { dict } = useLanguage();
  const [name, setName] = useState("");
  const [company, setCompany] = useState("");
  const [email, setEmail] = useState("");
  const [time, setTime] = useState("10:00");
  if (!open) return null;
  return (
    <div className="modal-backdrop"><motion.form className="small-modal" initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} onSubmit={(event) => { event.preventDefault(); if (name.trim()) void onCreate(name.trim(), company.trim(), email.trim(), time); }}>
      <header><div><p className="section-kicker">{dict.calendar.newMeeting}</p><h2>{dict.calendar.newMeeting}</h2></div><button type="button" className="icon-button" onClick={onClose}><X /></button></header>
      <label><span>{dict.meeting.attendees}</span><input autoFocus value={name} onChange={(event) => setName(event.target.value)} placeholder="James Tan" required /></label>
      <label><span>{dict.meeting.company}</span><input value={company} onChange={(event) => setCompany(event.target.value)} placeholder="Acme Manufacturing" /></label>
      <label><span>{dict.meeting.email}</span><input type="email" value={email} onChange={(event) => setEmail(event.target.value)} placeholder="client@company.com" /></label>
      <label><span>{dict.meeting.time}</span><input type="time" value={time} onChange={(event) => setTime(event.target.value)} required /></label>
      <footer><button type="button" className="button button--ghost" onClick={onClose}>{dict.common.cancel}</button><button type="submit" className="button button--primary"><Plus />{dict.common.save}</button></footer>
    </motion.form></div>
  );
}

function ScheduleModal({ meeting, followUp, onClose, onError, onScheduled }: { meeting: Meeting | null; followUp: FollowUp | null; onClose: () => void; onError: (message: string) => void; onScheduled: (meeting: Meeting) => void }) {
  const { dict, locale } = useLanguage();
  const [slots, setSlots] = useState<Array<{ startAt: string; endAt: string }>>([]);
  const [date, setDate] = useState("");
  const [selected, setSelected] = useState("");
  const [availabilityError, setAvailabilityError] = useState<string | null>(null);
  const [loadingSlots, setLoadingSlots] = useState(false);
  const [sending, setSending] = useState(false);
  useEffect(() => {
    setDate(meeting ? nextThursdayInMalaysia(meeting.startAt, meeting.endAt) : "");
  }, [meeting]);
  useEffect(() => {
    if (!meeting || !date) return;
    const controller = new AbortController();
    setLoadingSlots(true);
    setAvailabilityError(null);
    setSlots([]);
    setSelected("");
    void fetch(`/api/calendar/availability?date=${encodeURIComponent(date)}&period=afternoon`, {
      signal: controller.signal,
      cache: "no-store",
    })
      .then(async (response) => {
        const payload = await response.json().catch(() => ({})) as {
          error?: string;
          availability?: { slots?: Array<{ startAt: string; endAt: string }> };
        };
        if (!response.ok) throw new Error(payload.error || "Calendar availability could not be checked.");
        const available = payload.availability?.slots || [];
        setSlots(available);
        setSelected(available[0]?.startAt || "");
        if (!available.length) setAvailabilityError("No 30-minute afternoon slots are available.");
      })
      .catch((cause: unknown) => {
        if (!controller.signal.aborted) {
          setAvailabilityError(cause instanceof Error ? cause.message : "Calendar availability could not be checked.");
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoadingSlots(false);
      });
    return () => controller.abort();
  }, [date, meeting]);
  if (!meeting) return null;
  const selectedDate = new Date(`${date}T12:00:00+08:00`);
  return (
    <div className="modal-backdrop"><motion.section className="small-modal" initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }}>
      <header><div><p className="section-kicker">{dict.meeting.schedule}</p><h2>{Number.isNaN(selectedDate.getTime()) ? dict.meeting.date : new Intl.DateTimeFormat(locale, { weekday: "long", day: "numeric", month: "long", timeZone: "Asia/Kuala_Lumpur" }).format(selectedDate)}</h2></div><button type="button" className="icon-button" onClick={onClose}><X /></button></header>
      <label><span>{dict.meeting.date}</span><input type="date" min={nextThursdayInMalaysia()} value={date} onChange={(event) => setDate(event.target.value)} required /></label>
      <div className="slot-grid">{slots.map((slot) => <button type="button" key={slot.startAt} className={selected === slot.startAt ? "is-selected" : ""} onClick={() => setSelected(slot.startAt)}>{new Intl.DateTimeFormat(locale, { hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "Asia/Kuala_Lumpur" }).format(new Date(slot.startAt))}</button>)}</div>
      {loadingSlots ? <p className="modal-note">{dict.common.loading}</p> : null}
      {availabilityError ? <p className="composer__error" role="alert">{availabilityError}</p> : null}
      <p className="modal-note">{dict.actions.approvalRequired}</p>
      <footer><button type="button" className="button button--ghost" onClick={onClose}>{dict.common.cancel}</button><button type="button" className="button button--primary" disabled={loadingSlots || sending || !selected} onClick={async () => {
        const contact = meeting.contacts[0];
        if (!contact?.email) {
          onError("Add the client email before sending a calendar invitation.");
          return;
        }
        const selectedSlot = slots.find((slot) => slot.startAt === selected);
        if (!selectedSlot) return;
        const start = new Date(selectedSlot.startAt);
        setSending(true);
        try {
          const response = await fetch("/api/actions/calendar", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              approved: true,
              summary: `Follow-up · ${contact.name}`,
              startAt: start.toISOString(),
              attendees: [contact.email],
              description: `Follow-up from ${meeting.title}`,
              meetingId: meeting.id,
              ...(followUp ? { followUpId: followUp.id } : {}),
              idempotencyKey: `${meeting.id}:${selectedSlot.startAt}`,
            }),
          });
          const payload = await response.json().catch(() => ({})) as { error?: string; roxanneMeetingId?: string; event?: { id: string; startAt: string; endAt: string } };
          if (!response.ok || !payload.event) throw new Error(payload.error || "Calendar invite failed");
          onScheduled({ id: payload.roxanneMeetingId || `calendar:${payload.event.id}`, title: `${contact.name} · ${contact.company || "Follow-up"}`, startAt: payload.event.startAt, endAt: payload.event.endAt, status: "upcoming", source: "calendar", contacts: meeting.contacts });
        } catch (cause) {
          onError(cause instanceof Error ? cause.message : "Calendar invite failed");
        } finally {
          setSending(false);
        }
      }}>{sending ? dict.followUp.sending : dict.followUp.sendInvite}</button></footer>
    </motion.section></div>
  );
}
