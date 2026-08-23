"use client";

import { ChevronRight } from "lucide-react";
import type { Contact, Meeting } from "@/lib/types";
import { Avatar } from "@/components/Common/Avatar";
import { useLanguage } from "@/components/i18n/LanguageProvider";

interface PeopleViewProps {
  contacts: Contact[];
  meetings: Meeting[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  onOpenMeeting: (meeting: Meeting) => void;
}

export function PeopleView({ contacts, meetings, selectedId, onSelect, onOpenMeeting }: PeopleViewProps) {
  const { dict, locale } = useLanguage();
  const selected = contacts.find((item) => item.id === selectedId) || contacts[0];
  const history = meetings.filter((meeting) => meeting.contacts.some((contact) => contact.id === selected?.id));
  const latest = history.slice().sort((a, b) => b.startAt.localeCompare(a.startAt))[0];
  return (
    <section className="people-view">
      <header className="view-header"><p className="section-kicker">{dict.nav.people}</p><h1>{dict.people.title}</h1></header>
      <div className="people-layout">
        <div className="people-list">
          {contacts.map((contact) => <button type="button" key={contact.id} className={selected?.id === contact.id ? "person-row is-selected" : "person-row"} onClick={() => onSelect(contact.id)}><Avatar name={contact.name} /><span><strong>{contact.name}</strong><small>{contact.company}</small></span><ChevronRight /></button>)}
        </div>
        {selected ? (
          <article className="person-profile">
            <header><Avatar name={selected.name} /><div><h2>{selected.name}</h2><p>{selected.company}</p></div></header>
            <div className="person-facts">
              <div><span>{dict.people.lastSpoke}</span><strong>{latest ? new Intl.DateTimeFormat(locale, { day: "numeric", month: "short" }).format(new Date(latest.startAt)) : "—"}</strong></div>
              <div><span>{dict.meeting.wants}</span><strong>{latest?.insight?.wants || "—"}</strong></div>
              <div><span>{dict.people.waitingOnYou}</span><strong>{latest?.insight?.promised || "—"}</strong></div>
              <div><span>{dict.meeting.next}</span><strong>{latest?.insight?.next || "—"}</strong></div>
            </div>
            <h3>{dict.people.conversationHistory}</h3>
            <div className="history-list">
              {history.map((meeting) => <button type="button" key={meeting.id} onClick={() => onOpenMeeting(meeting)}><time>{new Intl.DateTimeFormat(locale, { day: "numeric", month: "short" }).format(new Date(meeting.startAt))}</time><span><strong>{meeting.title}</strong><small>{meeting.insight?.meetingType || meeting.status}</small></span><ChevronRight /></button>)}
            </div>
          </article>
        ) : null}
      </div>
    </section>
  );
}
