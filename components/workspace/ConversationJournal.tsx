"use client";

import { ArrowUpRight, AudioLines, Search, Users } from "lucide-react";
import { useMemo, useState } from "react";
import type { Meeting } from "@/lib/types";
import { initials } from "./ConversationPanel";
import { useWorkspaceTime } from "./WorkspaceTime";
import styles from "./quipus.module.css";

export function ConversationJournal({ meetings, compact = false, onOpen, onAll, onPeople }: {
  meetings: Meeting[]; compact?: boolean; onOpen: (id: string) => void;
  onAll?: () => void; onPeople?: () => void;
}) {
  const { timezone, dateKey: formatDateKey, dateLabel, timeLabel } = useWorkspaceTime();
  const [query, setQuery] = useState("");
  const [date, setDate] = useState("");
  const groups = useMemo(() => {
    const matching = meetings.filter(m => (!date || formatDateKey(m.startAt) === date) &&
      `${m.title} ${m.contacts.map(c => `${c.name} ${c.company || ""}`).join(" ")} ${m.insight?.intent || ""}`
        .toLowerCase().includes(query.toLowerCase().trim()));
    const grouped = new Map<string, Meeting[]>();
    for (const meeting of compact ? matching.slice(0, 4) : matching) {
      const key = formatDateKey(meeting.startAt);
      grouped.set(key, [...(grouped.get(key) || []), meeting]);
    }
    return grouped;
  }, [meetings, compact, date, query, timezone, formatDateKey]);
  return <section className={styles.journal} aria-label="Conversation journal">
    <header className={styles.sectionHeading}>
      <div><span className={styles.kicker}>YOUR CONVERSATION JOURNAL</span><h2>{compact ? "Worth remembering." : "Every conversation has a next chapter."}</h2></div>
      {compact && onAll ? <button className={styles.textLink} onClick={onAll}>View all <ArrowUpRight /></button> :
        onPeople && <button className={styles.textLink} onClick={onPeople}><Users /> People & companies</button>}
    </header>
    {!compact && <div className={styles.journalFilters}>
      <label className={styles.search}><Search /><input aria-label="Search conversations" placeholder="Find a person, company or conversation…" value={query} onChange={e => setQuery(e.target.value)} /></label>
      <label className={styles.dateFilter}><span>Date</span><input aria-label="Filter conversation date" type="date" value={date} onChange={e => setDate(e.target.value)} /></label>
      {(query || date) && <button className={styles.textLink} onClick={() => { setQuery(""); setDate(""); }}>Clear filters</button>}
    </div>}
    {[...groups].map(([day, entries]) => <div key={day} className={styles.dayGroup}>
      <h3>{dateLabel(entries[0].startAt, { weekday: "long", year: "numeric" })}</h3>
      {entries.map((meeting, index) => {
        const contact = meeting.contacts[0];
        const duration = Math.max(1, Math.round((Date.parse(meeting.endAt) - Date.parse(meeting.startAt)) / 60000));
        return <button key={meeting.id} className={styles.journalRow} onClick={() => onOpen(meeting.id)}>
          <span className={styles.journalAvatar} data-tone={index % 3}>{initials(contact?.name || meeting.title)}</span>
          <span className={styles.journalCopy}><strong>{contact?.name || meeting.title}<span>{contact?.company}</span></strong>
            <span>{meeting.insight?.intent || meeting.title}</span></span>
          <span className={styles.journalMeta}><span>{timeLabel(meeting.startAt)}</span><span><AudioLines /> {duration} min · {meeting.status === "ready" ? "Ready to revisit" : meeting.status === "processing" ? "Processing" : meeting.status === "failed" ? "Needs attention" : "Recorded"}</span></span>
          <ArrowUpRight className={styles.rowArrow} />
        </button>;
      })}
    </div>)}
    {!groups.size && <div className={styles.journalEmpty}><AudioLines /><h3>{query || date ? "No matching conversations." : "Your story starts with a conversation."}</h3><p>{query || date ? "Try another date, person or company." : "Record with your Quipus and your meetings will appear here."}</p></div>}
  </section>;
}
