"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
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
import { formatDateKey, getMonthGrid } from "@/lib/calendar";
import type { Meeting } from "@/lib/types";
import {
  getApprovals,
  isConversation,
  missingApprovalDetails,
  type MeetingApproval,
  type WorkspaceMode,
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
import { ConversationDetail } from "./ConversationDetail";
import styles from "./workspace.module.css";

export type WorkspaceView =
  | "overview"
  | "calendar"
  | "conversations"
  | "people"
  | "device"
  | "settings";

export type WorkspaceAccount = {
  email: string;
  displayName: string | null;
};

type WorkspaceProps = {
  account: WorkspaceAccount | null;
  initialMode: WorkspaceMode;
  initialView?: WorkspaceView;
  initialConversationId?: string;
};

const viewPath: Record<WorkspaceView, string> = {
  overview: "/dashboard",
  conversations: "/dashboard/conversations",
  calendar: "/dashboard/calendar",
  people: "/dashboard/people",
  device: "/dashboard/lantern",
  settings: "/dashboard/settings",
};

const viewLabel: Record<WorkspaceView, string> = {
  overview: "Overview",
  conversations: "Conversations",
  calendar: "Calendar",
  people: "People",
  device: "Lantern",
  settings: "Settings",
};

export function Workspace({
  account,
  initialMode,
  initialView = "overview",
  initialConversationId,
}: WorkspaceProps) {
  const router = useRouter();
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
  const [view, setView] = useState<WorkspaceView>(initialView);
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
  const [conversationFilter, setConversationFilter] = useState<
    "all" | "follow-up" | "ready" | "processing"
  >("all");
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
  const detailConversation = initialConversationId
    ? conversations.find((meeting) => meeting.id === initialConversationId) || null
    : null;
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
      (conversationFilter === "all" ||
        (conversationFilter === "follow-up" &&
          (conversation.followUps || []).some(
            (followUp) =>
              followUp.status !== "completed" &&
              followUp.status !== "dismissed",
          )) ||
        conversation.status === conversationFilter) &&
      `${conversation.title} ${conversation.contacts.map((contact) => `${contact.name} ${contact.company}`).join(" ")} ${conversation.insight?.keyPoints.join(" ")}`
        .toLowerCase()
        .includes(normalizedSearch),
  );
  const accountName =
    account?.displayName || account?.email.split("@")[0] || "Google account";
  const accountInitials = account
    ? initials(accountName).toUpperCase() ||
      account.email[0]?.toUpperCase() ||
      "ME"
    : "?";

  useEffect(() => {
    const searchParams = new URLSearchParams(window.location.search);
    const requested = searchParams.get("view");
    const requestedPerson = searchParams.get("person");
    if (
      ["overview", "calendar", "conversations", "people", "device", "settings"].includes(
        requested || "",
      )
    )
      setView(requested as WorkspaceView);
    if (initialView === "conversations" && requestedPerson)
      setPersonId(requestedPerson);
  }, [initialView]);

  const navigate = (next: WorkspaceView) => {
    setView(next);
    setSearch("");
    setConversationFilter("all");
    setPersonId(null);
    if (mode === "live") {
      router.push(viewPath[next]);
      return;
    }
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
      navigate("calendar");
      setSelectedId(created.id);
    }
    return created;
  };
  const openConversation = (id: string) => {
    const meeting = meetings.find((entry) => entry.id === id);
    if (mode === "live" && meeting && isConversation(meeting)) {
      router.push(`/dashboard/conversations/${encodeURIComponent(id)}`);
      return;
    }
    setSelectedId(id);
  };
  return (
    <div className={styles.shell}>
      <aside className={styles.sidebar}>
        <a href="/" className={styles.brand} aria-label="Lantern home">
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
              { id: "overview", label: "Overview", icon: Home },
              { id: "conversations", label: "Conversations", icon: Headphones },
              { id: "calendar", label: "Calendar", icon: CalendarDays },
              { id: "people", label: "People", icon: Users },
              { id: "device", label: "Lantern", icon: Radio },
            ] as const
          ).map(({ id, label, icon: Icon }) => (
            <Link
              key={id}
              className={`${styles.navItem} ${view === id ? styles.navActive : ""}`}
              href={mode === "live" ? viewPath[id] : `/?mode=sample&view=${id}`}
              onClick={(event) => {
                if (mode === "sample") {
                  event.preventDefault();
                  navigate(id);
                }
              }}
              aria-label={label}
              aria-current={view === id ? "page" : undefined}
            >
              <Icon />
              <span>{label}</span>
              {id === "conversations" && conversations.length > 0 && (
                <small>{conversations.length}</small>
              )}
            </Link>
          ))}
        </nav>
        <div className={styles.sidebarBottom}>
          <div className={styles.deviceCard}>
            <span className={styles.deviceIcon}>
              <Radio />
            </span>
            <strong>{device?.name || "Your Lantern"}</strong>
            <p>
              {mode === "sample"
                ? "Explore the device experience."
                : device
                  ? `${device.status}${device.battery_level != null ? ` · ${device.battery_level}% battery` : ""}`
                  : "Pair a device to see its health"}
            </p>
            <button aria-label="Open Lantern" onClick={() => navigate("device")}>
              Open Lantern <ArrowUpRight />
            </button>
          </div>
          <Link
            className={`${styles.navItem} ${view === "settings" ? styles.navActive : ""}`}
            aria-label="Settings"
            href={mode === "live" ? viewPath.settings : "/?mode=sample&view=settings"}
            onClick={(event) => {
              if (mode === "sample") {
                event.preventDefault();
                navigate("settings");
              }
            }}
          >
            <Settings2 />
            <span>Settings</span>
          </Link>
          <div
            className={`${styles.account} ${account ? "" : styles.accountSignedOut}`}
          >
            <span className={styles.accountAvatar}>
              {accountInitials}
            </span>
            <div>
              <span className={styles.accountState}>
                <i /> {account ? "Signed in" : "Signed out"}
              </span>
              <strong>{accountName}</strong>
              <small title={account?.email}>
                {account?.email || "Google account required"}
              </small>
            </div>
            {account ? <ShieldCheck /> : <LogIn />}
          </div>
        </div>
      </aside>

      <main className={styles.main}>
        <div className={styles.topbar}>
          <div>
            <span className={styles.breadcrumb}>Workspace</span>
            <ChevronRight />
            <strong>{viewLabel[view]}</strong>
          </div>
          <div className={styles.topbarRight}>
            <span className={styles.timezone}>Kuala Lumpur · MYT</span>
            {mode === "sample" ? (
              <Link
                className={styles.modeButton}
                href={account ? "/dashboard" : "/login?next=/dashboard"}
              >
                Open live workspace
                <ChevronRight />
              </Link>
            ) : (
              <span className={styles.modeButton}>
                Live workspace
                <ShieldCheck />
              </span>
            )}
            <div className={styles.authControls} aria-label="Account access">
              {account ? (
                <>
                  <span className={styles.topbarIdentity} title={account.email}>
                    <i />
                    <span>Signed in</span>
                    <small>{account.email}</small>
                  </span>
                  <form action="/api/auth/logout" method="post">
                    <button className={styles.signOutButton} type="submit">
                      <LogOut />
                      <span>Sign out</span>
                    </button>
                  </form>
                </>
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
            </div>
          </div>
        </div>
        <div className={styles.content}>
          <header className={styles.pageHeader}>
            <div>
              <p className={styles.eyebrow}>
                {view === "overview"
                  ? "TODAY IN LANTERN"
                  : view === "conversations" && initialConversationId
                    ? "CONVERSATION REVIEW"
                  : view === "calendar"
                  ? "A LITTLE CONTEXT. A BETTER FOLLOW-UP."
                  : view === "device"
                    ? "YOUR CONVERSATIONS, WITH YOU"
                  : "YOUR BUSINESS MEMORY"}
              </p>
              <h1>
                {view === "overview"
                  ? mode === "sample"
                    ? "A clear view of every follow-up."
                    : `Welcome back, ${accountName.split(" ")[0]}.`
                  : view === "conversations" && initialConversationId
                    ? "Replay, verify, follow through."
                  : view === "calendar"
                  ? "Your conversations, connected."
                  : view === "conversations"
                    ? "Every conversation matters."
                    : view === "people"
                      ? "Pick up where you left off."
                      : view === "device"
                        ? "Meet Lantern."
                      : "Keep Lantern connected."}
              </h1>
              <p>
                {view === "overview"
                  ? "Review what needs you, then get back to your clients."
                  : view === "conversations" && initialConversationId
                    ? "Use the original recording as your reference and correct anything that needs your judgment."
                  : view === "calendar"
                  ? "What’s coming up, what you agreed, and everything worth remembering."
                  : view === "conversations"
                    ? "The important details, ready when you need them."
                    : view === "people"
                      ? "Conversations and commitments, organised around your clients."
                      : view === "device"
                        ? "Pair your recorder, check its health, and manage its connection."
                      : "Manage your account, calendar connection, language, and privacy."}
              </p>
            </div>
            {view !== "settings" && view !== "device" && !initialConversationId && (
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
                You&apos;re exploring Lantern&apos;s public sample. Approvals stay in
                this browser and nothing is sent.
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
          {error && !initialConversationId && (
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
              {view === "overview" && (
                <div className={styles.overview}>
                  <section
                    className={styles.overviewStats}
                    aria-label="Workspace summary"
                  >
                    <button onClick={() => navigate("calendar")}>
                      <span className={`${styles.statIcon} ${styles.amber}`}>
                        <CheckCheck />
                      </span>
                      <span>
                        <strong>{pending.length}</strong>
                        <small>Pending approvals</small>
                      </span>
                      <ArrowUpRight />
                    </button>
                    <button onClick={() => navigate("conversations")}>
                      <span className={`${styles.statIcon} ${styles.blue}`}>
                        <Headphones />
                      </span>
                      <span>
                        <strong>{todayConversations.length}</strong>
                        <small>Conversations today</small>
                      </span>
                      <ArrowUpRight />
                    </button>
                    <button onClick={() => navigate("calendar")}>
                      <span className={`${styles.statIcon} ${styles.green}`}>
                        <CalendarDays />
                      </span>
                      <span>
                        <strong>
                          {nextMeeting ? timeLabel(nextMeeting.startAt) : "Clear"}
                        </strong>
                        <small>Next meeting</small>
                      </span>
                      <ArrowUpRight />
                    </button>
                    <button onClick={() => navigate("device")}>
                      <span className={`${styles.statIcon} ${styles.green}`}>
                        <Radio />
                      </span>
                      <span>
                        <strong>
                          {mode === "sample"
                            ? "Sample"
                            : device?.battery_level != null
                              ? `${device.battery_level}%`
                              : device
                                ? "Paired"
                                : "Set up"}
                        </strong>
                        <small>
                          {device?.name || "Lantern device"}
                        </small>
                      </span>
                      <ArrowUpRight />
                    </button>
                  </section>

                  <div className={styles.overviewGrid}>
                    <section className={styles.attentionPanel}>
                      <header className={styles.sectionHeader}>
                        <div>
                          <span className={styles.eyebrow}>NEEDS YOUR ATTENTION</span>
                          <h2>Ready for your decision</h2>
                        </div>
                        <span className={styles.count}>{pending.length + tasks.length}</span>
                      </header>
                      <div className={styles.attentionList}>
                        {pending.slice(0, 3).map((approval) => {
                          const missing = missingApprovalDetails(approval.details);
                          return (
                            <article key={approval.id} className={styles.attentionRow}>
                              <span className={styles.smallAvatar}>
                                {initials(approval.contact?.name || "Client")}
                              </span>
                              <button
                                className={styles.attentionCopy}
                                onClick={() => openConversation(approval.conversationId)}
                              >
                                <strong>{approval.title}</strong>
                                <small>
                                  {approval.contact?.name || "Client"}
                                  {approval.details.startAt
                                    ? ` · ${dateLabel(approval.details.startAt, { weekday: "short" })} at ${timeLabel(approval.details.startAt)}`
                                    : " · Time needs confirmation"}
                                </small>
                              </button>
                              <button
                                className={styles.compactAction}
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
                                {missing.length ? "Review" : "Approve"}
                              </button>
                            </article>
                          );
                        })}
                        {tasks.slice(0, Math.max(0, 4 - pending.length)).map((task) => {
                          const conversation = conversations.find(
                            (entry) => entry.id === task.meetingId,
                          );
                          return (
                            <article key={task.id} className={styles.attentionRow}>
                              <span className={`${styles.smallAvatar} ${styles.taskAvatar}`}>
                                <MessageSquare />
                              </span>
                              <button
                                className={styles.attentionCopy}
                                onClick={() => conversation && openConversation(conversation.id)}
                              >
                                <strong>{task.description}</strong>
                                <small>
                                  {conversation?.contacts[0]?.name || "Follow-up"}
                                  {task.dueAt ? ` · Due ${dateLabel(task.dueAt)}` : ""}
                                </small>
                              </button>
                              <button
                                className={styles.iconButton}
                                aria-label={`Mark ${task.description} complete`}
                                disabled={Boolean(working)}
                                onClick={() => void workspace.patchFollowUp(task.id, { status: "completed" })}
                              >
                                <Check />
                              </button>
                            </article>
                          );
                        })}
                        {!pending.length && !tasks.length && (
                          <div className={styles.caughtUp}>
                            <CheckCheck />
                            <div>
                              <strong>You are all caught up.</strong>
                              <p>New approvals and follow-ups will appear here.</p>
                            </div>
                          </div>
                        )}
                      </div>
                    </section>

                    <aside className={styles.dayPanel}>
                      <header className={styles.sectionHeader}>
                        <div>
                          <span className={styles.eyebrow}>UP NEXT</span>
                          <h2>Your calendar</h2>
                        </div>
                        <button
                          className={styles.iconButton}
                          aria-label="Open calendar"
                          onClick={() => navigate("calendar")}
                        >
                          <ArrowUpRight />
                        </button>
                      </header>
                      <div className={styles.dayList}>
                        {upcoming.slice(0, 3).map((meeting) => (
                          <button
                            key={meeting.id}
                            className={styles.dayRow}
                            onClick={() => openConversation(meeting.id)}
                          >
                            <time dateTime={meeting.startAt}>
                              <strong>{timeLabel(meeting.startAt)}</strong>
                              <span>{dateLabel(meeting.startAt, { weekday: "short" })}</span>
                            </time>
                            <span>
                              <strong>{meeting.title}</strong>
                              <small>
                                {meeting.contacts[0]?.name || "Calendar meeting"}
                              </small>
                            </span>
                          </button>
                        ))}
                        {!upcoming.length && (
                          <div className={styles.caughtUp}>
                            <CalendarDays />
                            <div>
                              <strong>Your calendar is clear.</strong>
                              <p>Approved meetings will appear here.</p>
                            </div>
                          </div>
                        )}
                      </div>
                    </aside>
                  </div>

                  <section className={styles.latestPanel}>
                    <header className={styles.sectionHeader}>
                      <div>
                        <span className={styles.eyebrow}>RECENT CONVERSATIONS</span>
                        <h2>Pick up where you left off</h2>
                      </div>
                      <button
                        className={styles.textButton}
                        onClick={() => navigate("conversations")}
                      >
                        View all <ArrowRight />
                      </button>
                    </header>
                    <div className={styles.latestList}>
                      {conversations.slice(0, 5).map((conversation) => (
                        <button
                          key={conversation.id}
                          className={styles.latestRow}
                          onClick={() => openConversation(conversation.id)}
                        >
                          <span className={styles.avatar}>
                            {initials(conversation.contacts[0]?.name || conversation.title)}
                          </span>
                          <span className={styles.latestIdentity}>
                            <strong>{conversation.contacts[0]?.name || conversation.title}</strong>
                            <small>{conversation.contacts[0]?.company || "Conversation"}</small>
                          </span>
                          <span className={styles.latestSummary}>
                            {conversation.insight?.wants || conversation.title}
                          </span>
                          <time dateTime={conversation.startAt}>
                            {dateLabel(conversation.startAt)}
                          </time>
                          <span className={styles.statusPill}>
                            {conversation.status === "ready" ? "Ready" : conversation.status}
                          </span>
                          <ArrowUpRight />
                        </button>
                      ))}
                      {!conversations.length && (
                        <div className={styles.emptyInline}>
                          <Headphones />
                          <h3>Your first conversation will appear here.</h3>
                          <p>Record with Lantern or add an audio file to begin.</p>
                        </div>
                      )}
                    </div>
                  </section>
                </div>
              )}
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
                </>
              )}

              {view === "conversations" && initialConversationId && (
                detailConversation ? (
                  <ConversationDetail
                    conversation={detailConversation}
                    mode={mode}
                    working={working}
                    error={error}
                    onBack={() => router.push(viewPath.conversations)}
                    onTask={(id, completed) =>
                      void workspace.patchFollowUp(id, {
                        status: completed ? "completed" : "pending",
                      })
                    }
                    onEditApproval={setEditing}
                    onApprove={(approval) => void approve(approval)}
                    onUpdateContact={workspace.patchContact}
                  />
                ) : (
                  <section className={styles.collection}>
                    <div className={styles.emptyInline}>
                      <Headphones />
                      <h3>Conversation not found</h3>
                      <p>It may have been removed or may belong to another workspace.</p>
                      <button
                        className={styles.secondaryButton}
                        onClick={() => router.push(viewPath.conversations)}
                      >
                        Back to conversations
                      </button>
                    </div>
                  </section>
                )
              )}

              {view === "conversations" && !initialConversationId && (
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
                    <div className={styles.collectionControls}>
                      <label className={styles.search}>
                        <Search />
                        <input
                          aria-label="Search conversations"
                          placeholder="Search people, companies, or details"
                          value={search}
                          onChange={(event) => setSearch(event.target.value)}
                        />
                      </label>
                      <label className={styles.filterSelect}>
                        <span className="visually-hidden">Filter conversations</span>
                        <select
                          aria-label="Filter conversations"
                          value={conversationFilter}
                          onChange={(event) =>
                            setConversationFilter(
                              event.target.value as typeof conversationFilter,
                            )
                          }
                        >
                          <option value="all">All conversations</option>
                          <option value="follow-up">Needs follow-up</option>
                          <option value="ready">Recap ready</option>
                          <option value="processing">Processing</option>
                        </select>
                      </label>
                    </div>
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
                        {(conversation.followUps || []).some(
                          (followUp) =>
                            followUp.status !== "completed" &&
                            followUp.status !== "dismissed",
                        )
                          ? "Follow-up"
                          : conversation.status === "ready"
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
                              if (mode === "live")
                                router.push(
                                  `${viewPath.conversations}?person=${encodeURIComponent(contact.id)}`,
                                );
                              else setView("conversations");
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
                      Choose the language used for processing your recordings.
                    </p>
                    <LanguageSwitcher />
                    <div className={styles.region}>
                      <span>Timezone</span>
                      <strong>Asia/Kuala_Lumpur</strong>
                    </div>
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
              Lantern<span> · Conversation intelligence</span>
            </span>
            <span className={styles.footerLinks}>
              <Link href="/privacy">Privacy</Link>
              <Link href="/terms">Terms</Link>
              <span>Listen. Understand. Follow through.</span>
            </span>
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
