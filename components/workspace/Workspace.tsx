"use client";
import { WhatsAppDelivery } from "./WhatsAppDelivery";

import Link from "next/link";
import { useRouter, usePathname, useSearchParams } from "next/navigation";
import { motion, useReducedMotion } from "motion/react";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowRight,
  ArrowUpRight,
  CalendarDays,
  Check,
  CheckCheck,
  ChevronLeft,
  ChevronRight,
  Clock3,
  Headphones,
  Home,
  LayoutGrid,
  List,
  LoaderCircle,
  LogIn,
  LogOut,
  MessageSquare,
  MoreHorizontal,
  Radio,
  RotateCcw,
  Search,
  Settings2,
  ShieldCheck,
  Sparkles,
  Users,
  X,
} from "lucide-react";
import { getMonthGrid } from "@/lib/calendar";
import { workspaceTime } from "@/lib/workspace-time";
import type { Meeting } from "@/lib/types";
import {
  getApprovals,
  isConversation,
  missingApprovalDetails,
  type MeetingApproval,
  type WorkspaceMode,
} from "@/lib/workspace/model";
import { LanguageSwitcher } from "@/components/i18n/LanguageSwitcher";
import { QuipusMark } from "@/components/brand/QuipusMark";
import { personalGreeting, validTimezone } from "@/lib/quipus-profile";
import { QuipusHeader, viewPaths } from "./QuipusHeader";
import { ConversationJournal } from "./ConversationJournal";
import { ConversationDetail } from "./ConversationDetail";
import { ProfileSettings } from "./ProfileSettings";
import { CalendarConnection } from "./CalendarConnection";
import { WorkspaceTimezone } from "./WorkspaceTime";
import q from "./quipus.module.css";
import { useWorkspace } from "./useWorkspace";
import {
  ConversationPanel,
  initials,
} from "./ConversationPanel";
import { ApprovalDialog } from "./ApprovalDialog";
import { RecordingDialog } from "./RecordingDialog";
import { LanternDevicePanel } from "./LanternDevicePanel";
import styles from "./workspace.module.css";

export type WorkspaceView =
  | "overview"
  | "conversations"
  | "calendar"
  | "people"
  | "device"
  | "settings";

export type WorkspaceAccount = {
  email: string;
  displayName: string | null;
  timezone?: string;
};

type WorkspaceProps = {
  account: WorkspaceAccount | null;
  initialMode: WorkspaceMode;
  initialView?: WorkspaceView;
  initialConversationId?: string;
};

const viewLabel: Record<WorkspaceView, string> = {
  overview: "Home", conversations: "Conversations", calendar: "Calendar", people: "People", device: "Devices", settings: "Settings",
};
const validViews = Object.keys(viewLabel) as WorkspaceView[];

export function Workspace({
  account: initialAccount,
  initialMode,
  initialView = "overview",
  initialConversationId,
}: WorkspaceProps) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const reducedMotion = useReducedMotion();
  const [account, setAccount] = useState(initialAccount);
  const [theme, setTheme] = useState<"dark" | "light">("dark");
  const timezone = validTimezone(account?.timezone);
  const { dateKey: formatDateKey, dateLabel, timeLabel } = workspaceTime(timezone);
  useEffect(() => { setAccount(initialAccount); }, [initialAccount]);
  useEffect(() => {
    try { if (localStorage.getItem("quipus:theme") === "light") setTheme("light"); } catch {}
  }, []);
  useEffect(() => { document.documentElement.dataset.theme = theme; }, [theme]);
  const toggleTheme = () => {
    const next = theme === "dark" ? "light" : "dark";
    setTheme(next);
    try { localStorage.setItem("quipus:theme", next); } catch {}
  };
  const workspace = useWorkspace(initialMode);
  const {
    meetings,
    mode,
    loading,
    error,
    notice,
    working,
    integrations,
    device,
  } =
    workspace;
  const requestedView = params.get("view") as WorkspaceView;
  const view: WorkspaceView = mode === "sample"
    ? validViews.includes(requestedView) ? requestedView : initialView
    : pathname.includes("/conversations") ? "conversations"
    : (Object.entries(viewPaths).find(([key, path]) => key !== "overview" && path === pathname)?.[0] as WorkspaceView) || initialView;
  const detailId = pathname.startsWith("/dashboard/conversations/")
    ? decodeURIComponent(pathname.split("/").at(-1) || "")
    : mode === "sample" ? params.get("conversation") : initialConversationId;
  const detailMeeting = detailId ? meetings.find(m => m.id === detailId) : null;
  const previousPage = useRef(`${view}:${detailId || ""}`);
  useEffect(() => {
    const nextPage = `${view}:${detailId || ""}`;
    if (previousPage.current !== nextPage) document.getElementById("main-content")?.focus({ preventScroll: true });
    previousPage.current = nextPage;
  }, [view, detailId]);
  const [visibleMonth, setVisibleMonth] = useState(() =>
    formatDateKey(new Date()).slice(0, 7),
  );
  const [selectedDate, setSelectedDate] = useState(() =>
    formatDateKey(new Date()),
  );
  const [layout, setLayout] = useState<"month" | "agenda">("month");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [editing, setEditing] = useState<MeetingApproval | null>(null);
  const [search, setSearch] = useState("");
  const [approvalFilter, setApprovalFilter] = useState<"pending" | "dismissed">(
    "pending",
  );
  const [recordingOpen, setRecordingOpen] = useState(false);
  const now = new Date();
  const today = formatDateKey(now);
  const approvals = useMemo(() => getApprovals(meetings), [meetings]);
  const pending = approvals.filter((approval) => approval.status === "pending");
  const conversations = useMemo(
    () =>
      meetings
        .filter(isConversation)
        .sort((a, b) => Date.parse(b.startAt) - Date.parse(a.startAt)),
    [meetings],
  );
  const contacts = useMemo(
    () => [
      ...new Map(
        conversations
          .flatMap((conversation) => conversation.contacts)
          .map((contact) => [contact.id, contact]),
      ).values(),
    ],
    [conversations],
  );
  const scheduled = meetings.filter(
    (meeting) => meeting.source === "calendar" || meeting.status === "upcoming",
  );
  const upcoming = scheduled
    .filter((meeting) => Date.parse(meeting.endAt) > now.getTime())
    .sort((a, b) => Date.parse(a.startAt) - Date.parse(b.startAt));
  const nextMeeting = upcoming[0] || null;
  const tasks = conversations
    .flatMap((meeting) => meeting.followUps || [])
    .filter(
      (item) =>
        item.type !== "schedule" &&
        item.status !== "completed" &&
      item.status !== "dismissed",
    );
  const todayConversations = conversations.filter(
    (meeting) => formatDateKey(meeting.startAt) === today,
  );
  const selectedMeeting =
    meetings.find((meeting) => meeting.id === selectedId) || null;
  const grid = getMonthGrid(visibleMonth, { today });
  const monthLabel = new Intl.DateTimeFormat("en-MY", {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(`${visibleMonth}-15T12:00:00Z`));
  const normalizedSearch = search.trim().toLowerCase();
  const accountName =
    account?.displayName || account?.email.split("@")[0] || "Google account";
  const accountInitials = account
    ? initials(accountName).toUpperCase() ||
      account.email[0]?.toUpperCase() ||
      "ME"
    : "?";

  const navigate = (next: WorkspaceView) => {
    setSearch(""); setSelectedId(null);
    if (mode === "live") router.push(viewPaths[next]);
    else {
      const url = new URL(window.location.href);
      url.searchParams.set("view", next); url.searchParams.delete("conversation");
      window.history.pushState({}, "", url);
    }
  };
  const openDetail = (id: string) => {
    if (mode === "live") router.push(`/dashboard/conversations/${encodeURIComponent(id)}`);
    else {
      const url = new URL(window.location.href);
      url.searchParams.set("view", "conversations"); url.searchParams.set("conversation", id);
      window.history.pushState({}, "", url);
    }
  };
  const changeMonth = (amount: number) => {
    const date = new Date(`${visibleMonth}-15T12:00:00Z`);
    date.setUTCMonth(date.getUTCMonth() + amount);
    setVisibleMonth(date.toISOString().slice(0, 7));
  };
  const approve = async (approval: MeetingApproval) => {
    const created = await workspace.approve(approval);
    if (created) {
      setVisibleMonth(formatDateKey(created.startAt).slice(0, 7));
      setSelectedDate(formatDateKey(created.startAt));
      navigate("calendar");
      setSelectedId(created.id);
    }
    return created;
  };
  const openConversation = (id: string) => {
    if (meetings.some((meeting) => meeting.id === id)) setSelectedId(id);
  };
  return (
    <WorkspaceTimezone.Provider value={timezone}>
    <div className={styles.shell} data-theme={theme}>
      <a className={styles.skipLink} href="#main-content">Skip to content</a>
      <QuipusHeader view={view} sample={mode === "sample"} account={account} navigate={navigate} theme={theme} onTheme={toggleTheme} />
      <main className={styles.main} id="main-content" tabIndex={-1}>
        <motion.div className={styles.content} key={`${view}:${detailId || ""}`}
          initial={reducedMotion ? false : { opacity: 0, y: 9 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: .22 }}>

          {mode === "sample" && <div className={q.sampleNote}>
            <span><Sparkles /> You’re exploring a sample workspace. Your approvals here won’t send anything.</span>
            <button disabled={Boolean(working)} onClick={() => { setSelectedId(null); setEditing(null); workspace.loadSample(true); }}><RotateCcw /> Reset sample</button>
          </div>}
          {!detailId && (view === "overview" ? <header className={q.welcome}>
            <div className={q.welcomeCopy}>
              <div className={q.dateLine}><i /><span>YOUR DAY, CONNECTED</span> · {new Intl.DateTimeFormat("en-MY", { weekday: "long", month: "long", day: "numeric", timeZone: timezone }).format(now)}</div>
              <h1>{mode === "sample" ? <>A little more present.<br /><em>A lot more prepared.</em></> : personalGreeting(account?.displayName, now, timezone)}</h1>
              <p>{mode === "sample" ? "Meet Quipus. Your conversations, commitments and next steps, thoughtfully connected." : pending.length ? `You have ${pending.length} follow-up${pending.length === 1 ? "" : "s"} ready to review. Let’s pick up where you left off.` : "A clear head for your next conversation. Everything you need to remember is right here."}</p>
            </div>
            <div className={q.welcomeArt} aria-hidden="true"><QuipusMark /></div>
          </header> : <header className={styles.pageHeader}>
            <div><p className={styles.eyebrow}>{view === "settings" ? "MAKE QUIPUS YOURS" : "EVERY THREAD, CONNECTED"}</p>
              <h1>{view === "conversations" ? "Your conversations." : view === "calendar" ? "A little context for what’s next." : view === "people" ? "The people behind the conversations." : view === "device" ? "Your Quipus, connected." : "A workspace that knows you."}</h1>
              <p>{view === "conversations" ? "Revisit the words. Remember what mattered. Follow through." : view === "calendar" ? "Select a meeting to revisit the conversation behind it." : view === "device" ? "Your recorder’s connection, storage and health, in one place." : view === "people" ? "People, companies and the conversations you share." : "Your profile, connections and preferences."}</p>
            </div>
          </header>)}
          {error && (
            <div className={styles.errorBanner} role="alert">
              <span>{error}</span>
              <button
                className={styles.iconButton}
                aria-label="Dismiss error"
                onClick={() => workspace.setError(null)}
              >
                <X />
              </button>
            </div>
          )}
          {loading ? (
            <div className={styles.loading}>
              <LoaderCircle />
              <p>Opening your workspace…</p>
            </div>
          ) : (
            <>
              {mode === "live" && account && (view === "overview" || view === "calendar") && <CalendarConnection email={account.email} connected={integrations.google} />}
              {detailId ? (detailMeeting ? <ConversationDetail
                conversation={detailMeeting} mode={mode} working={working} error={error}
                onBack={() => navigate("conversations")}
                onTask={(id, completed) => void workspace.patchFollowUp(id, { status: completed ? "completed" : "pending" })}
                onEditApproval={setEditing} onApprove={approval => void approve(approval)} onUpdateContact={workspace.patchContact}
              /> : <div className={styles.emptyInline}><Headphones /><h3>Conversation unavailable.</h3><p>It may still be processing, or it isn’t in this workspace.</p><button className={q.textLink} onClick={() => navigate("conversations")}>Back to conversations</button></div>) : null}
              {view === "overview" && <>
                <div className={q.dailyBrief}>
                  <section className={q.nextAction} aria-label="Next approval">
                    <div className={q.briefHeading}><span className={q.kicker}>A LITTLE FOLLOW-THROUGH</span><span className={q.approvalCount}>{pending.length} awaiting approval</span></div>
                    <h2>{pending[0]?.title || "Room for your next conversation."}</h2>
                    <p>{pending[0] ? `${pending[0].contact?.name || "Your client"}${pending[0].contact?.company ? ` · ${pending[0].contact.company}` : ""}${pending[0].details.startAt ? ` · ${dateLabel(pending[0].details.startAt)} at ${timeLabel(pending[0].details.startAt)}` : " · A few details to confirm"}` : "Your meeting briefs and follow-ups will be ready here when you are."}</p>
                    <div className={q.briefBottom}>
                      <span className={q.smallPeople}><span>{pending[0] ? initials(pending[0].contact?.name || "Client") : <CheckCheck />}</span>{pending[0] ? "You’re in control of what happens next." : "All caught up."}</span>
                      <button className={q.actionButton} onClick={() => pending[0] ? setEditing(pending[0]) : navigate("conversations")}>{pending[0] ? "Review follow-up" : "Conversations"}<ArrowRight /></button>
                    </div>
                  </section>
                  <section className={q.nextMeeting} aria-label="Next meeting">
                    <div className={q.briefHeading}><span className={q.kicker}>ON YOUR HORIZON</span><CalendarDays /></div>
                    <h2>{nextMeeting?.title || "A little breathing room."}</h2>
                    <p>{nextMeeting ? `${dateLabel(nextMeeting.startAt, { weekday: "short" })} · ${timeLabel(nextMeeting.startAt)}${nextMeeting.contacts[0]?.company ? ` · ${nextMeeting.contacts[0].company}` : ""}` : "Your upcoming meetings will appear here once your calendar is connected."}</p>
                    <div className={q.briefBottom}><span className={q.smallPeople}>{nextMeeting ? "Bring the context with you." : "Make space for what matters."}</span><button className={q.textLink} onClick={() => navigate("calendar")}>Open calendar <ArrowUpRight /></button></div>
                  </section>
                </div>
                <ConversationJournal meetings={conversations} compact onOpen={openDetail} onAll={() => navigate("conversations")} />
                <div className={q.workspaceNote}><span>Every conversation, carried forward.</span><button className={q.deviceStatus} onClick={() => navigate("device")}><i data-offline={!device || device.status !== "online"} />{mode === "sample" ? "Explore your Quipus" : device ? `${device.name.replace(/Quipus/gi, "Quipus")} · ${device.status}` : "Connect your Quipus"}<ArrowUpRight /></button></div>
              </>}
              {view === "conversations" && !detailId && <ConversationJournal meetings={conversations} onOpen={openDetail} onPeople={() => navigate("people")} />}
              {view === "calendar" && (
                <>
                  <div className={styles.calendarLayout}>
                    <section
                      className={styles.calendarSurface}
                      aria-label="Meeting calendar"
                    >
                      <header className={styles.calendarToolbar}>
                        <div className={styles.monthControls}>
                          <h2>{monthLabel}</h2>
                          <button
                            className={styles.iconButton}
                            onClick={() => changeMonth(-1)}
                            aria-label="Previous month"
                          >
                            <ChevronLeft />
                          </button>
                          <button
                            className={styles.iconButton}
                            onClick={() => changeMonth(1)}
                            aria-label="Next month"
                          >
                            <ChevronRight />
                          </button>
                          <button
                            className={styles.todayButton}
                            onClick={() => {
                              setVisibleMonth(today.slice(0, 7));
                              setSelectedDate(today);
                            }}
                          >
                            Today
                          </button>
                        </div>
                        <div
                          className={styles.viewToggle}
                          aria-label="Calendar layout"
                        >
                          <button
                            aria-pressed={layout === "month"}
                            className={
                              layout === "month" ? styles.toggleActive : ""
                            }
                            onClick={() => setLayout("month")}
                          >
                            <LayoutGrid />
                            Month
                          </button>
                          <button
                            aria-pressed={layout === "agenda"}
                            className={
                              layout === "agenda" ? styles.toggleActive : ""
                            }
                            onClick={() => setLayout("agenda")}
                          >
                            <List />
                            Agenda
                          </button>
                        </div>
                      </header>
                      {layout === "month" ? (
                        <>
                          <div className={styles.weekdays}>
                            {[
                              "MON",
                              "TUE",
                              "WED",
                              "THU",
                              "FRI",
                              "SAT",
                              "SUN",
                            ].map((day) => (
                              <span key={day}>{day}</span>
                            ))}
                          </div>
                          <div className={styles.monthGrid}>
                            {grid.map((day) => {
                              const entries = meetings.filter(
                                (meeting) =>
                                  formatDateKey(meeting.startAt) ===
                                  day.isoDate,
                              );
                              return (
                                <div
                                  key={day.isoDate}
                                  className={`${styles.day} ${!day.inCurrentMonth ? styles.otherMonth : ""} ${day.isoDate === selectedDate ? styles.selectedDay : ""}`}
                                >
                                  <button
                                    className={`${styles.dayNumber} ${day.isToday ? styles.todayNumber : ""}`}
                                    aria-label={dateLabel(
                                      `${day.isoDate}T12:00:00Z`,
                                      { weekday: "long", year: "numeric", timeZone: "UTC" },
                                    )}
                                    aria-pressed={day.isoDate === selectedDate}
                                    onClick={() => setSelectedDate(day.isoDate)}
                                  >
                                    {day.dayNumber}
                                  </button>
                                  <div className={styles.dayEvents}>
                                    {entries.slice(0, 3).map((meeting) => (
                                      <button
                                        key={meeting.id}
                                        className={`${styles.eventChip} ${meeting.source === "calendar" || meeting.status === "upcoming" ? styles.scheduledChip : styles.conversationChip}`}
                                        onClick={() =>
                                          openConversation(meeting.id)
                                        }
                                        title={meeting.title}
                                      >
                                        <span className={styles.eventTime}>
                                          {timeLabel(meeting.startAt)}
                                        </span>
                                        <strong>
                                          {meeting.contacts[0]?.name ||
                                            meeting.title}
                                        </strong>
                                        <small>
                                          {meeting.source === "calendar"
                                            ? "Follow-up"
                                            : isConversation(meeting)
                                              ? "Conversation"
                                              : meeting.title}
                                        </small>
                                      </button>
                                    ))}
                                    {entries.length > 3 && (
                                      <button
                                        className={styles.moreEvents}
                                        onClick={() => {
                                          setSelectedDate(day.isoDate);
                                          setLayout("agenda");
                                        }}
                                      >
                                        +{entries.length - 3} more
                                      </button>
                                    )}
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                        </>
                      ) : (
                        <div className={styles.agenda}>
                          {meetings
                            .filter((meeting) =>
                              formatDateKey(meeting.startAt).startsWith(
                                visibleMonth,
                              ),
                            )
                            .sort(
                              (a, b) =>
                                Date.parse(a.startAt) - Date.parse(b.startAt),
                            )
                            .map((meeting) => (
                              <button
                                className={styles.agendaRow}
                                key={meeting.id}
                                onClick={() => openConversation(meeting.id)}
                              >
                                <span className={styles.agendaDate}>
                                  {dateLabel(meeting.startAt, {
                                    day: "2-digit",
                                  })}
                                </span>
                                <span>
                                  <strong>{meeting.title}</strong>
                                  <small>
                                    {meeting.contacts[0]?.company} ·{" "}
                                    {timeLabel(meeting.startAt)}
                                  </small>
                                </span>
                                <span className={styles.typePill}>
                                  {meeting.source === "calendar"
                                    ? "Meeting"
                                    : "Conversation"}
                                </span>
                                <ArrowUpRight />
                              </button>
                            ))}
                          {!meetings.some((meeting) =>
                            formatDateKey(meeting.startAt).startsWith(
                              visibleMonth,
                            ),
                          ) && (
                            <div className={styles.emptyInline}>
                              <CalendarDays />
                              <h3>A little breathing room</h3>
                              <p>No meetings or conversations this month.</p>
                            </div>
                          )}
                        </div>
                      )}
                    </section>
                    <aside
                      className={styles.approvalRail}
                      aria-label="Meeting approvals"
                    >
                      <header>
                        <div>
                          <span className={styles.eyebrow}>
                            READY FOR YOUR GO-AHEAD
                          </span>
                          <h2>
                            Approvals{" "}
                            <span className={styles.count}>
                              {pending.length}
                            </span>
                          </h2>
                        </div>
                        <CheckCheck />
                      </header>
                      <p className={styles.railIntro}>
                        You agreed on the next step.
                        <br />
                        One approval makes it official.
                      </p>
                      {(approvalFilter === "dismissed" ||
                        approvals.some(
                          (approval) => approval.status === "dismissed",
                        )) && (
                        <div className={styles.railFilters}>
                          <button
                            className={
                              approvalFilter === "pending"
                                ? styles.activeFilter
                                : ""
                            }
                            onClick={() => setApprovalFilter("pending")}
                          >
                            Pending
                          </button>
                          <button
                            className={
                              approvalFilter === "dismissed"
                                ? styles.activeFilter
                                : ""
                            }
                            onClick={() => setApprovalFilter("dismissed")}
                          >
                            Dismissed
                          </button>
                        </div>
                      )}
                      {approvals
                        .filter(
                          (approval) => approval.status === approvalFilter,
                        )
                        .map((approval) => {
                          const missing = missingApprovalDetails(
                            approval.details,
                          );
                          return (
                            <article
                              key={approval.id}
                              className={styles.approvalCard}
                            >
                              <div className={styles.approvalIdentity}>
                                <span className={styles.smallAvatar}>
                                  {initials(approval.contact?.name || "Client")}
                                </span>
                                <span>
                                  <strong>
                                    {approval.contact?.name || "Client meeting"}
                                  </strong>
                                  <small>
                                    {approval.contact?.company ||
                                      "From your conversation"}
                                  </small>
                                </span>
                                <button
                                  className={styles.iconButton}
                                  onClick={() => setEditing(approval)}
                                  aria-label={`Edit meeting with ${approval.contact?.name || "client"}`}
                                  disabled={
                                    Boolean(working) ||
                                    approval.status === "dismissed"
                                  }
                                >
                                  <MoreHorizontal />
                                </button>
                              </div>
                              <h3>{approval.title}</h3>
                              <div className={styles.approvalTime}>
                                <CalendarDays />
                                <span>
                                  {approval.details.startAt
                                    ? dateLabel(approval.details.startAt, {
                                        weekday: "short",
                                      })
                                    : "Date to confirm"}
                                </span>
                              </div>
                              <div className={styles.approvalTime}>
                                <Clock3 />
                                <span>
                                  {approval.details.startAt
                                    ? timeLabel(approval.details.startAt)
                                    : "Time to confirm"}
                                  {approval.details.durationMinutes
                                    ? ` · ${approval.details.durationMinutes} min`
                                    : ""}
                                </span>
                              </div>
                              {approval.details.attendees.length > 0 && (
                                <p className={styles.attendee}>
                                  {approval.details.attendees.join(", ")}
                                </p>
                              )}
                              {approval.details.evidence && (
                                <blockquote>
                                  “{approval.details.evidence}”
                                </blockquote>
                              )}
                              {missing.length > 0 && (
                                <p className={styles.missing}>
                                  Confirm {missing.join(", ")}.
                                </p>
                              )}
                              <button
                                className={styles.sourceLink}
                                onClick={() =>
                                  openConversation(approval.conversationId)
                                }
                              >
                                View conversation <ArrowUpRight />
                              </button>
                              {approval.status === "dismissed" ? (
                                <button
                                  className={styles.secondaryButton}
                                  disabled={Boolean(working)}
                                  onClick={() =>
                                    void workspace.patchFollowUp(approval.id, {
                                      status: "pending",
                                    })
                                  }
                                >
                                  Restore approval
                                </button>
                              ) : (
                                <div className={styles.approvalActions}>
                                  <button
                                    className={styles.primaryButton}
                                    disabled={Boolean(working)}
                                    onClick={() =>
                                      missing.length
                                        ? setEditing(approval)
                                        : void approve(approval)
                                    }
                                  >
                                    {working === approval.id ? (
                                      <LoaderCircle className={styles.spin} />
                                    ) : (
                                      <Check />
                                    )}
                                    {working === approval.id
                                      ? "Adding…"
                                      : missing.length
                                        ? "Complete details"
                                        : "Approve"}
                                  </button>
                                  <button
                                    className={styles.dismissButton}
                                    onClick={() =>
                                      void workspace.patchFollowUp(
                                        approval.id,
                                        { status: "dismissed" },
                                      )
                                    }
                                    disabled={Boolean(working)}
                                  >
                                    Dismiss
                                  </button>
                                </div>
                              )}
                            </article>
                          );
                        })}
                      {approvals.filter(
                        (approval) => approval.status === approvalFilter,
                      ).length === 0 && (
                        <div className={styles.approvalsEmpty}>
                          <CheckCheck />
                          <h3>
                            {approvalFilter === "pending"
                              ? "You’re all caught up."
                              : "Nothing dismissed."}
                          </h3>
                          <p>
                            Agreed meetings from your conversations will appear
                            here.
                          </p>
                        </div>
                      )}
                      <p className={styles.railFootnote}>
                        <ShieldCheck />
                        {mode === "sample"
                          ? "Sample approvals stay in this browser."
                          : "Invitations are sent only after approval."}
                      </p>
                    </aside>
                  </div>
                </>
              )}

              {view === "people" && (
                <section>
                  <label className={`${styles.search} ${styles.peopleSearch}`}>
                    <Search />
                    <input
                      aria-label="Search people"
                      placeholder="Find a person or company"
                      value={search}
                      onChange={(event) => setSearch(event.target.value)}
                    />
                  </label>
                  <div className={styles.peopleGrid}>
                    {contacts
                      .filter((contact) =>
                        `${contact.name} ${contact.company}`
                          .toLowerCase()
                          .includes(normalizedSearch),
                      )
                      .map((contact) => {
                        const history = conversations.filter((conversation) =>
                          conversation.contacts.some(
                            (item) => item.id === contact.id,
                          ),
                        );
                        return (
                          <button
                            key={contact.id}
                            className={styles.personCard}
                            onClick={() => {
                              setSearch("");
                              if (history[0]) openConversation(history[0].id);
                            }}
                          >
                            <span className={styles.avatar}>
                              {initials(contact.name)}
                            </span>
                            <h2>{contact.name}</h2>
                            <p>
                              {contact.role || "Client"}
                              {contact.company ? ` · ${contact.company}` : ""}
                            </p>
                            <span className={styles.personEmail}>
                              {contact.email || "No email added"}
                            </span>
                            <footer>
                              <span>
                                {history.length} conversation
                                {history.length === 1 ? "" : "s"}
                              </span>
                              <ArrowUpRight />
                            </footer>
                          </button>
                        );
                      })}
                  </div>
                  {!contacts.length && (
                    <div className={styles.emptyInline}>
                      <Users />
                      <h3>Build a memory around your clients.</h3>
                      <p>People from your conversations will appear here.</p>
                    </div>
                  )}
                </section>
              )}
              {view === "device" && (
                <LanternDevicePanel
                  mode={mode}
                  integrations={integrations}
                  conversationCount={conversations.length}
                />
              )}
              {view === "settings" && (
                <div className={styles.settingsGrid}>
                  <ProfileSettings account={account} sample={mode === "sample"} onSaved={setAccount} />
                  <WhatsAppDelivery sample={mode === "sample"} />
                  <section className={styles.settingsCard}>
                    <h2>Gmail follow-ups</h2>
                    <p>Review a draft, then approve the exact recipient and message before sending.</p>
                    {mode === "live" ? <a className={styles.secondaryButton} href="/api/google/connect?gmail=1&returnTo=%2Fdashboard%2Fsettings">Connect or refresh Gmail</a> : <p>Available in your connected workspace.</p>}
                  </section>
                  <section className={styles.settingsCard}>
                    <span className={styles.settingsIcon}>
                      <CalendarDays />
                    </span>
                      <h2>Google Calendar</h2>
                    <p>
                      Approve a meeting in Quipus and keep it on your calendar.
                    </p>
                    <span className={styles.connectionState}>
                      <i
                        className={
                          mode === "live" && integrations.google
                            ? styles.greenDot
                            : styles.neutralDot
                        }
                      />
                      {mode === "sample"
                        ? "Sample calendar"
                        : integrations.google === undefined
                          ? "Status unavailable"
                          : integrations.google
                          ? "Connection saved"
                          : "Not connected"}
                    </span>
                    {mode === "live" ? (
                      <a
                        className={styles.secondaryButton}
                        href="/api/google/connect?returnTo=%2Fdashboard%2Fsettings"
                      >
                        {integrations.google
                          ? "Reconnect Google Calendar"
                          : "Connect Google Calendar"}
                        <ArrowUpRight />
                      </a>
                    ) : (
                      <Link
                        className={styles.secondaryButton}
                        href={account ? "/dashboard" : "/login?next=/dashboard"}
                      >
                        Open your live workspace <ArrowRight />
                      </Link>
                    )}
                  </section>
                  <section className={styles.settingsCard}>
                    <h2>Language & region</h2>
                    <p>
                      Choose your language preference for supported controls and processing requests. Quipus’s new navigation currently uses English.
                    </p>
                    <LanguageSwitcher />
                    <div className={styles.region}>
                      <span>Timezone</span>
                      <strong>{timezone}</strong>
                    </div>
                  </section>
                  <section className={styles.settingsCard}>
                    <span className={styles.settingsIcon}>
                      <ShieldCheck />
                    </span>
                    <h2>Access & privacy</h2>
                    <p>
                      Your source recordings, transcripts, and meeting briefs
                      stay private unless you approve sharing or enable delivery to your WhatsApp.
                    </p>
                    <span className={styles.connectionState}>
                      <i
                        className={
                          account ? styles.greenDot : styles.neutralDot
                        }
                      />
                      {account
                        ? `Signed in as ${account.email}`
                        : "You are signed out"}
                    </span>
                    {account ? (
                      <form action="/api/auth/logout" method="post">
                        <button className={styles.signOutButton} type="submit">
                          <LogOut /> Sign out
                        </button>
                      </form>
                    ) : (
                      <Link
                        aria-label="Sign in with Google"
                        className={styles.signInButton}
                        href="/login?next=/dashboard"
                      >
                        <LogIn />
                        <span className={styles.signInFull}>Sign in with Google</span>
                        <span className={styles.signInShort}>Sign in</span>
                      </Link>
                    )}
                  </section>
                </div>
              )}
            </>
          )}
          <footer className={styles.pageFooter}>
            <span className={styles.footerBrand}>
              Quipus<span> by Fovea</span>
            </span>
            <span className={styles.footerLinks}>
              <Link href="/privacy">Privacy</Link>
              <Link href="/terms">Terms</Link>
              <span>Listen. Understand. Follow through.</span>
            </span>
          </footer>
        </motion.div>
      </main>
      <ConversationPanel
        meeting={selectedMeeting}
        meetings={meetings}
        onClose={() => setSelectedId(null)}
        onTask={(id, completed) =>
          void workspace.patchFollowUp(id, {
            status: completed ? "completed" : "pending",
          })
        }
        working={working}
        error={error}
      />
      <ApprovalDialog
        approval={editing}
        mode={mode}
        working={Boolean(working)}
        executionError={error}
        onClose={() => setEditing(null)}
        onApprove={approve}
      />
      {mode === "live" && (
        <RecordingDialog
          open={recordingOpen}
          onClose={() => setRecordingOpen(false)}
          onProcessed={() => {
            setRecordingOpen(false);
            void workspace.loadLive();
          }}
        />
      )}
      {notice && (
        <div className={styles.toast} role="status">
          <Check />
          <span>{notice}</span>
          <button
            onClick={() => workspace.setNotice(null)}
            aria-label="Dismiss notification"
          >
            <X />
          </button>
        </div>
      )}
    </div>
    </WorkspaceTimezone.Provider>
  );
}
