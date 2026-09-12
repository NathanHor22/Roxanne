"use client";

import { useEffect, useMemo, useState } from "react";
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
  LayoutGrid,
  List,
  LoaderCircle,
  LogOut,
  MessageSquare,
  MoreHorizontal,
  Plus,
  Radio,
  RotateCcw,
  Search,
  Settings2,
  ShieldCheck,
  Sparkles,
  Users,
  X,
} from "lucide-react";
import { formatDateKey, getMonthGrid } from "@/lib/calendar";
import type { Meeting } from "@/lib/types";
import {
  getApprovals,
  isConversation,
  missingApprovalDetails,
  type MeetingApproval,
} from "@/lib/workspace/model";
import { LanguageSwitcher } from "@/components/i18n/LanguageSwitcher";
import { LanternMark } from "@/components/brand/LanternMark";
import { useWorkspace } from "./useWorkspace";
import {
  ConversationPanel,
  dateLabel,
  initials,
  timeLabel,
} from "./ConversationPanel";
import { ApprovalDialog } from "./ApprovalDialog";
import { RecordingDialog } from "./RecordingDialog";
import { LanternDevicePanel } from "./LanternDevicePanel";
import styles from "./workspace.module.css";

type View = "calendar" | "conversations" | "people" | "device" | "settings";

export function Workspace() {
  const workspace = useWorkspace();
  const { meetings, mode, loading, error, notice, working, integrations } =
    workspace;
  const [view, setView] = useState<View>("calendar");
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
  const [personId, setPersonId] = useState<string | null>(null);
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
  const tasks = conversations
    .flatMap((meeting) => meeting.followUps || [])
    .filter(
      (item) =>
        item.type !== "schedule" &&
        item.status !== "completed" &&
        item.status !== "dismissed",
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
  const visibleConversations = conversations.filter(
    (conversation) =>
      (!personId ||
        conversation.contacts.some((contact) => contact.id === personId)) &&
      `${conversation.title} ${conversation.contacts.map((contact) => `${contact.name} ${contact.company}`).join(" ")} ${conversation.insight?.keyPoints.join(" ")}`
        .toLowerCase()
        .includes(normalizedSearch),
  );

  useEffect(() => {
    const requested = new URLSearchParams(window.location.search).get("view");
    if (
      ["calendar", "conversations", "people", "device", "settings"].includes(
        requested || "",
      )
    )
      setView(requested as View);
  }, []);

  const navigate = (next: View) => {
    setView(next);
    setSearch("");
    setPersonId(null);
    const url = new URL(window.location.href);
    url.searchParams.set("view", next);
    window.history.replaceState({}, "", url);
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
      setView("calendar");
      setSelectedId(created.id);
    }
    return created;
  };
  const openConversation = (id: string) => setSelectedId(id);
  const switchMode = () => {
    setSelectedId(null);
    setEditing(null);
    setPersonId(null);
    mode === "sample" ? void workspace.loadLive() : workspace.loadSample();
  };

  return (
    <div className={styles.shell}>
      <aside className={styles.sidebar}>
        <a href="/dashboard" className={styles.brand} aria-label="Lantern home">
          <span className={styles.brandMark}>
            <LanternMark />
          </span>
          <strong>Lantern</strong>
        </a>
        <div className={styles.workspaceLabel}>
          <span className={styles.workspaceMark}><i /></span>
          <div>
            <strong>Your workspace</strong>
            <small>Listening securely</small>
          </div>
        </div>
        <span className={styles.navLabel}>WORKSPACE</span>
        <nav aria-label="Main navigation">
          {(
            [
              { id: "calendar", label: "Calendar", icon: CalendarDays },
              { id: "conversations", label: "Conversations", icon: Headphones },
              { id: "people", label: "People", icon: Users },
              { id: "device", label: "Lantern", icon: Radio },
            ] as const
          ).map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              className={`${styles.navItem} ${view === id ? styles.navActive : ""}`}
              onClick={() => navigate(id)}
              aria-label={label}
              aria-current={view === id ? "page" : undefined}
            >
              <Icon />
              <span>{label}</span>
              {id === "conversations" && conversations.length > 0 && (
                <small>{conversations.length}</small>
              )}
            </button>
          ))}
        </nav>
        <div className={styles.sidebarBottom}>
          <div className={styles.deviceCard}>
            <span className={styles.deviceIcon}>
              <Radio />
            </span>
            <strong>Your wearable</strong>
            <p>
              {mode === "sample"
                ? "Explore a captured conversation."
                : "No device connected"}
            </p>
            <button aria-label="Open Lantern" onClick={() => navigate("device")}>
              Open Lantern <ArrowUpRight />
            </button>
          </div>
          <button
            className={`${styles.navItem} ${view === "settings" ? styles.navActive : ""}`}
            aria-label="Settings"
            onClick={() => navigate("settings")}
          >
            <Settings2 />
            <span>Settings</span>
          </button>
          <div className={styles.account}>
            <span className={styles.accountAvatar}>
              {mode === "sample" ? "S" : "ME"}
            </span>
            <div>
              <strong>
                {mode === "sample" ? "Sample workspace" : "Personal workspace"}
              </strong>
              <small>
                {mode === "sample"
                  ? "Saved in this browser"
                  : "Your private business memory"}
              </small>
            </div>
            <ShieldCheck />
          </div>
        </div>
      </aside>

      <main className={styles.main}>
        <div className={styles.topbar}>
          <div>
            <span className={styles.breadcrumb}>Workspace</span>
            <ChevronRight />
            <strong>{view.charAt(0).toUpperCase() + view.slice(1)}</strong>
          </div>
          <div className={styles.topbarRight}>
            <span className={styles.timezone}>Kuala Lumpur · MYT</span>
            <button
              className={styles.modeButton}
              disabled={Boolean(working)}
              onClick={switchMode}
            >
              {mode === "sample" ? "Sample workspace" : "Live workspace"}
              <ChevronRight />
            </button>
          </div>
        </div>
        <div className={styles.content}>
          <header className={styles.pageHeader}>
            <div>
              <p className={styles.eyebrow}>
                {view === "calendar"
                  ? "A LITTLE CONTEXT. A BETTER FOLLOW-UP."
                  : view === "device"
                    ? "YOUR CONVERSATIONS, WITH YOU"
                  : "YOUR BUSINESS MEMORY"}
              </p>
              <h1>
                {view === "calendar"
                  ? "Your conversations, connected."
                  : view === "conversations"
                    ? "Every conversation matters."
                    : view === "people"
                      ? "Pick up where you left off."
                      : view === "device"
                        ? "Meet Lantern."
                      : "Make yourself at home."}
              </h1>
              <p>
                {view === "calendar"
                  ? "What’s coming up, what you agreed, and everything worth remembering."
                  : view === "conversations"
                    ? "The important details, ready when you need them."
                    : view === "people"
                      ? "Conversations and commitments, organised around your clients."
                      : view === "device"
                        ? "Test the consent, capture, status report, and approval flow before connecting providers."
                      : "Manage your connections and workspace preferences."}
              </p>
            </div>
            {view !== "settings" && view !== "device" && (
              <button
                className={styles.secondaryButton}
                onClick={() =>
                  mode === "sample"
                    ? openConversation(conversations[0]?.id || "")
                    : setRecordingOpen(true)
                }
              >
                <Headphones />
                {mode === "sample" ? "Explore a conversation" : "Add recording"}
              </button>
            )}
          </header>
          {mode === "sample" && (
            <div className={styles.sampleBanner}>
              <Sparkles />
              <span>
                You’re exploring sample conversations. Approvals stay in this
                browser.
              </span>
              <button
                disabled={Boolean(working)}
                onClick={() => {
                  setSelectedId(null);
                  setEditing(null);
                  workspace.loadSample(true);
                }}
              >
                <RotateCcw />
                Reset sample
              </button>
            </div>
          )}
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
              {view === "calendar" && (
                <>
                  <div className={styles.summaryBar}>
                    <div>
                      <span className={`${styles.statIcon} ${styles.green}`}>
                        <CalendarDays />
                      </span>
                      <span>
                        <strong>{upcoming.length}</strong>
                        <small>Upcoming meetings</small>
                      </span>
                    </div>
                    <div>
                      <span className={`${styles.statIcon} ${styles.amber}`}>
                        <CheckCheck />
                      </span>
                      <span>
                        <strong>{pending.length}</strong>
                        <small>Awaiting approval</small>
                      </span>
                    </div>
                    <div>
                      <span className={`${styles.statIcon} ${styles.blue}`}>
                        <MessageSquare />
                      </span>
                      <span>
                        <strong>{tasks.length}</strong>
                        <small>Open follow-ups</small>
                      </span>
                    </div>
                    <span className={styles.summaryCaption}>
                      <span />
                      {mode === "sample"
                        ? "A preview of your day, connected"
                        : "Your conversations in one place"}
                    </span>
                  </div>
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
                                      `${day.isoDate}T12:00:00+08:00`,
                                      { weekday: "long", year: "numeric" },
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
                      <footer className={styles.calendarLegend}>
                        <span>
                          <i className={styles.greenDot} />
                          Scheduled meeting
                        </span>
                        <span>
                          <i className={styles.blueDot} />
                          Captured conversation
                        </span>
                        <span className={styles.legendHint}>
                          Select an entry to see the context
                        </span>
                      </footer>
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
                  <section className={styles.recent}>
                    <header>
                      <div>
                        <span className={styles.eyebrow}>
                          FRESH IN YOUR MEMORY
                        </span>
                        <h2>Recent conversations</h2>
                      </div>
                      <button
                        className={styles.textButton}
                        onClick={() => navigate("conversations")}
                      >
                        View all <ArrowRight />
                      </button>
                    </header>
                    <div className={styles.recentGrid}>
                      {conversations.slice(0, 3).map((conversation, index) => (
                        <button
                          className={styles.recentCard}
                          key={conversation.id}
                          onClick={() => openConversation(conversation.id)}
                        >
                          <div className={styles.recentCardTop}>
                            <span
                              className={`${styles.smallAvatar} ${index === 1 ? styles.peachAvatar : index === 2 ? styles.blueAvatar : ""}`}
                            >
                              {initials(
                                conversation.contacts[0]?.name ||
                                  conversation.title,
                              )}
                            </span>
                            <span>
                              <strong>
                                {conversation.contacts[0]?.name ||
                                  conversation.title}
                              </strong>
                              <small>
                                {conversation.contacts[0]?.company ||
                                  "Conversation"}
                              </small>
                            </span>
                            <ArrowUpRight />
                          </div>
                          <p>
                            {conversation.insight?.wants || conversation.title}
                          </p>
                          <footer>
                            <span>{dateLabel(conversation.startAt)}</span>
                            <span>
                              <Headphones />
                              {Math.round(
                                (Date.parse(conversation.endAt) -
                                  Date.parse(conversation.startAt)) /
                                  60_000,
                              )}{" "}
                              min
                            </span>
                            <span className={styles.memoryPill}>
                              {conversation.status === "ready"
                                ? "Recap ready"
                                : conversation.status}
                            </span>
                          </footer>
                        </button>
                      ))}
                    </div>
                    {!conversations.length && (
                      <div className={styles.emptyInline}>
                        <Headphones />
                        <h3>Your next conversation starts here.</h3>
                        <p>
                          Captured conversations and their recaps will appear
                          here.
                        </p>
                        <button
                          className={styles.secondaryButton}
                          onClick={() => setRecordingOpen(true)}
                        >
                          Add a recording
                        </button>
                      </div>
                    )}
                  </section>
                </>
              )}

              {view === "conversations" && (
                <section className={styles.collection}>
                  <div className={styles.collectionToolbar}>
                    <h2>
                      {personId
                        ? contacts.find((contact) => contact.id === personId)
                            ?.name
                        : "All conversations"}{" "}
                      <span className={styles.count}>
                        {visibleConversations.length}
                      </span>
                    </h2>
                    <label className={styles.search}>
                      <Search />
                      <input
                        aria-label="Search conversations"
                        placeholder="Search people, companies, or details"
                        value={search}
                        onChange={(event) => setSearch(event.target.value)}
                      />
                    </label>
                  </div>
                  {visibleConversations.map((conversation) => (
                    <button
                      className={styles.conversationRow}
                      key={conversation.id}
                      onClick={() => openConversation(conversation.id)}
                    >
                      <span className={styles.avatar}>
                        {initials(
                          conversation.contacts[0]?.name || conversation.title,
                        )}
                      </span>
                      <span className={styles.conversationRowMain}>
                        <strong>
                          {conversation.contacts[0]?.name || conversation.title}
                          <span>{conversation.contacts[0]?.company}</span>
                        </strong>
                        <p>
                          {conversation.insight?.wants || conversation.title}
                        </p>
                        <small>
                          {dateLabel(conversation.startAt)} ·{" "}
                          {Math.round(
                            (Date.parse(conversation.endAt) -
                              Date.parse(conversation.startAt)) /
                              60000,
                          )}{" "}
                          min ·{" "}
                          {conversation.id.startsWith("sample:")
                            ? "Sample wearable"
                            : conversation.source}
                        </small>
                      </span>
                      <span className={styles.typePill}>
                        {conversation.status === "ready"
                          ? "Recap ready"
                          : conversation.status}
                      </span>
                      <ArrowUpRight />
                    </button>
                  ))}
                  {!visibleConversations.length && (
                    <div className={styles.emptyInline}>
                      <Search />
                      <h3>
                        {search
                          ? "No matching conversations"
                          : "Your conversations will live here"}
                      </h3>
                      <p>
                        {search
                          ? "Try a client name, company, or another detail."
                          : "Add a recording to get started, or explore the sample workspace."}
                      </p>
                    </div>
                  )}
                </section>
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
                              setPersonId(contact.id);
                              setSearch("");
                              setView("conversations");
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
                <LanternDevicePanel mode={mode} integrations={integrations} />
              )}
              {view === "settings" && (
                <div className={styles.settingsGrid}>
                  <section className={styles.settingsCard}>
                    <span className={styles.settingsIcon}>
                      <CalendarDays />
                    </span>
                    <h2>Google Calendar</h2>
                    <p>
                      Approve a meeting in Lantern and keep it on your calendar.
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
                        : integrations.google
                          ? "Connection saved"
                          : "Not connected"}
                    </span>
                    {mode === "live" ? (
                      <a
                        className={styles.secondaryButton}
                        href="/api/google/connect?returnTo=%2Fdashboard%3Fview%3Dsettings"
                      >
                        {integrations.google
                          ? "Reconnect Google Calendar"
                          : "Connect Google Calendar"}
                        <ArrowUpRight />
                      </a>
                    ) : (
                      <button
                        className={styles.secondaryButton}
                        disabled={Boolean(working)}
                        onClick={() => void workspace.loadLive()}
                      >
                        Open your live workspace <ArrowRight />
                      </button>
                    )}
                  </section>
                  <section className={styles.settingsCard}>
                    <span className={styles.settingsIcon}>
                      <Radio />
                    </span>
                    <h2>Your wearable</h2>
                    <p>
                      Carry your conversations with you. Connected recordings
                      will flow into your workspace.
                    </p>
                    <span className={styles.connectionState}>
                      <i className={styles.neutralDot} />
                      No device connected
                    </span>
                    <p className={styles.subtle}>
                      Recording and transcript imports are available while your
                      wearable is being set up.
                    </p>
                    {mode === "live" && (
                      <button
                        className={styles.secondaryButton}
                        onClick={() => setRecordingOpen(true)}
                      >
                        Add a recording <Plus />
                      </button>
                    )}
                  </section>
                  <section className={styles.settingsCard}>
                    <h2>Language & region</h2>
                    <p>
                      Choose the language used for processing your recordings.
                    </p>
                    <LanguageSwitcher />
                    <div className={styles.region}>
                      <span>Timezone</span>
                      <strong>Asia/Kuala_Lumpur</strong>
                    </div>
                  </section>
                  <section className={styles.settingsCard}>
                    <h2>Workspace</h2>
                    <p>
                      {mode === "sample"
                        ? "Explore the full approval and recap flow with sample client conversations."
                        : "Your recordings, recaps, and approvals belong to your personal workspace."}
                    </p>
                    <button
                      className={styles.secondaryButton}
                      onClick={switchMode}
                      disabled={Boolean(working)}
                    >
                      {mode === "sample"
                        ? "Open live workspace"
                        : "Explore sample workspace"}
                      <ArrowRight />
                    </button>
                    {mode === "sample" && (
                      <button
                        className={styles.textButton}
                        disabled={Boolean(working)}
                        onClick={() => workspace.loadSample(true)}
                      >
                        <RotateCcw />
                        Reset sample conversations
                      </button>
                    )}
                  </section>
                  <section className={styles.settingsCard}>
                    <span className={styles.settingsIcon}>
                      <ShieldCheck />
                    </span>
                    <h2>Access & privacy</h2>
                    <p>
                      Your source recordings, transcripts, and meeting briefs
                      stay inside your private Lantern workspace.
                    </p>
                    <span className={styles.connectionState}>
                      <i className={styles.greenDot} />
                      Owner access only
                    </span>
                    <form action="/api/auth/logout" method="post">
                      <button className={styles.secondaryButton} type="submit">
                        Sign out <LogOut />
                      </button>
                    </form>
                  </section>
                </div>
              )}
            </>
          )}
          <footer className={styles.pageFooter}>
            <span className={styles.footerBrand}>
              Lantern<span> · Conversation intelligence</span>
            </span>
            <span>Listen. Understand. Follow through.</span>
          </footer>
        </div>
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
  );
}
