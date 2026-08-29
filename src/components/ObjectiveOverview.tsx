"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { Project } from "@/types/database";

type Stats = Record<string, { total: number; done: number }>;
// Sentinel title marking the one project_messages row that holds a page's
// Objective banner (not a real thread). Chosen so no human topic collides.
const PAGE_OBJECTIVE_TITLE = "__page_objective__";

type FileRow = { id: number; project_id: string; filename: string; uploaded_at: string };
type SubmittedFileRow = { id: string; project_id: string; filename: string; uploaded_at: string; href?: string };
type CommentRow = { id: number; body: string; created_at: string; author: string; author_id: string | null };
type MessageRow = { id: number; project_id: string; title: string; body: string; objective: string | null; created_at: string; author_id: string | null; comment_count: number; comments: CommentRow[] };
type Assignee = { id: string; name: string; avatar_url: string | null };
type Todo = { id: number; text: string; sort_order: number; completed: boolean };
type SubtaskRow = { id: number; project_id: string; task_name: string; task_detail: string | null; status: string; recurring: boolean; due_date: string | null; start_date: string | null; account: string | null; client: string | null; review_required: boolean | null; assignees: Assignee[]; todos?: Todo[] };

// Mirrors LOCKED_TODO_STATUSES on the server (assigned-tasks/[id]/todos/[todoId]/route.ts)
// — once a subtask has been handed in, its to-dos freeze in the UI too, not
// just on the write path.
const LOCKED_TODO_STATUSES = new Set(["submitted", "reviewing", "approved", "completed", "paid"]);

function initialsOf(name: string) {
  return name.split(/\s+/).map((w) => w[0]).filter(Boolean).slice(0, 2).join("").toUpperCase();
}

/* eslint-disable-next-line @next/next/no-img-element */
function Avatar({ person }: { person: Assignee }) {
  return person.avatar_url ? (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={person.avatar_url} alt={person.name} title={person.name} className="h-5 w-5 rounded-full object-cover border border-white" />
  ) : (
    <span title={person.name} className="h-5 w-5 rounded-full bg-slate-blue-soft text-slate-blue text-[9px] font-bold flex items-center justify-center border border-white">
      {initialsOf(person.name)}
    </span>
  );
}

const DONE = new Set(["completed", "approved", "paid"]);

// Subtasks filter — a row of toggle chips over the All Subtasks list. No chip
// active = everything; multiple active = OR. Dates compare against "today" in
// Eastern (org timezone), never browser-local.
type SubFilter = "pending" | "in_progress" | "submitted" | "revision" | "approved" | "completed" | "past_due" | "delayed_start" | "unclaimed";
const SUB_FILTERS: { key: SubFilter; label: string }[] = [
  { key: "pending", label: "Pending" },
  { key: "in_progress", label: "In Progress" },
  { key: "submitted", label: "Submitted" },
  { key: "revision", label: "Revision" },
  { key: "approved", label: "Approved" },
  { key: "completed", label: "Completed" },
  { key: "past_due", label: "Past Due" },
  { key: "delayed_start", label: "Delayed Start" },
  { key: "unclaimed", label: "Unclaimed" },
];
const NOT_STARTED = new Set(["pending", "unassigned", "on_queue"]);

// Left-border accent for a subtask row: approved → green, overdue → red,
// submitted → amber, delayed start → pink. First match wins (overdue outranks
// submitted so a late unreviewed task still reads red); anything else neutral.
function subtaskAccent(st: SubtaskRow, today: string): string {
  const s = st.status;
  if (s === "approved" || s === "completed" || s === "paid") return "border-sage";
  if (st.due_date && st.due_date < today && !DONE.has(s)) return "border-terracotta";
  if (s === "submitted" || s === "reviewing") return "border-amber";
  if (st.start_date && st.start_date < today && NOT_STARTED.has(s)) return "border-clay-rose";
  return "border-transparent";
}

// A task moves its assignee's avatar only once it's been APPROVED (approved/
// completed/paid = full credit). Everything before that keeps the face where it
// is. `cancelled`/unknown are excluded from the average entirely.
const STATUS_WEIGHT: Record<string, number> = {
  pending: 0, unassigned: 0, on_queue: 0, in_progress: 0, revision_needed: 0,
  submitted: 0, reviewing: 0, approved: 1, completed: 1, paid: 1,
};
// A submitted task (awaiting approval) doesn't move the avatar yet, but makes it
// glow YELLOW so a pending review is visible at a glance. An approved task moves
// the avatar forward and glows GREEN.
const PENDING_STATUSES = new Set(["submitted", "reviewing"]);
const APPROVED_STATUSES = new Set(["approved", "completed", "paid"]);
/** Ticked. Approved is deliberately not here: it is what makes a box tickable. */
const TICKED = new Set(["completed", "paid"]);
const easternToday = () => new Date().toLocaleDateString("en-CA", { timeZone: "America/New_York" });
function matchesSubFilter(st: SubtaskRow, f: SubFilter, today: string): boolean {
  switch (f) {
    case "pending": return st.status === "pending";
    case "in_progress": return st.status === "in_progress";
    case "submitted": return st.status === "submitted";
    case "revision": return st.status === "revision_needed" || st.status === "reviewing";
    case "approved": return st.status === "approved";
    case "completed": return st.status === "completed";
    case "past_due": return Boolean(st.due_date) && st.due_date! < today && !DONE.has(st.status);
    case "delayed_start": return Boolean(st.start_date) && st.start_date! < today && NOT_STARTED.has(st.status);
    case "unclaimed": return st.assignees.length === 0;
  }
}

interface ObjectiveOverviewProps {
  projects: Project[];
  onSelect: (project: Project) => void;
  /** When set, the dashboard is scoped to this objective (its sub-objectives,
   *  messages, docs, subtasks). When null/undefined it covers every objective. */
  scopeId?: string | null;
  /** "Objective" or "Operation" — labels adapt so the same dashboard serves both tabs. */
  kindLabel?: "Objective" | "Operation";
  /** Bump to force a re-fetch (e.g. after the parent creates a subtask). */
  refreshSignal?: number;
  /** When set, render only that one card full-size (tab mode, driven by the
   *  parent's tab bar). Undefined = the 4-card grid (landing overview). */
  showOnly?: DashboardCard;
  /** Rendered at the top of the Subtasks card (the real Add-Subtask form). */
  addSubtaskSlot?: React.ReactNode;
  /** Open an overview item straight into its editable Details (Edit button). */
  onEditProject?: (project: Project) => void;
  /** The signed-in user, for the "My Messages" filter and the My Subtasks default. */
  currentUserId?: string;
  /** Admins may tick anyone's subtask; everyone else only their own. */
  isAdmin?: boolean;
}

type DashboardCard = "board" | "subtasks" | "todos" | "overview" | "docs";

function formatDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  try {
    const [y, m, d] = iso.slice(0, 10).split("-").map(Number);
    return new Date(y, m - 1, d).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
  } catch {
    return iso;
  }
}

/** Simple pager: shows one page of items plus ‹ / › controls when they overflow. */
function Paginated<T>({ items, pageSize, empty, children }: {
  items: T[];
  pageSize: number;
  empty: React.ReactNode;
  children: (slice: T[]) => React.ReactNode;
}) {
  const [page, setPage] = useState(0);
  const pages = Math.max(1, Math.ceil(items.length / pageSize));
  const safePage = Math.min(page, pages - 1);
  const slice = items.slice(safePage * pageSize, safePage * pageSize + pageSize);
  if (items.length === 0) return <div className="flex-1 flex items-start">{empty}</div>;
  return (
    <div className="flex flex-1 flex-col min-h-0">
      <div className="flex-1 overflow-y-auto min-h-0">{children(slice)}</div>
      {pages > 1 && (
        <div className="flex items-center justify-between pt-2 text-[11px] text-bark">
          <button disabled={safePage === 0} onClick={() => setPage(safePage - 1)} className="px-2 py-0.5 rounded hover:bg-parchment disabled:opacity-40">‹ Prev</button>
          <span className="text-stone">{safePage + 1} / {pages}</span>
          <button disabled={safePage >= pages - 1} onClick={() => setPage(safePage + 1)} className="px-2 py-0.5 rounded hover:bg-parchment disabled:opacity-40">Next ›</button>
        </div>
      )}
    </div>
  );
}

// Fixed-size cards: each is exactly this tall, and content pages/scrolls
// inside rather than growing the box.
const CARD = "rounded-xl border border-sand bg-white p-4 flex flex-col gap-3 h-[440px] overflow-hidden";
// Tab mode: one big shared box.
const CARD_TAB = "rounded-xl border border-sand bg-white p-4 flex flex-col gap-3 h-[560px] overflow-hidden";
const CARD_TITLE = "text-xs font-bold text-espresso uppercase tracking-wide";

type Member = { id: string; full_name: string; username: string };

function escapeRegex(s: string) { return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); }

/** Render text with @Name mentions of known team members highlighted. */
function withMentions(text: string, names: string[]): React.ReactNode {
  if (!text) return text;
  if (names.length === 0) return text;
  const pattern = names.slice().sort((a, b) => b.length - a.length).map(escapeRegex).join("|");
  const re = new RegExp(`@(${pattern})`, "g");
  const out: React.ReactNode[] = [];
  let last = 0, m: RegExpExecArray | null, i = 0;
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) out.push(text.slice(last, m.index));
    out.push(<span key={i++} className="font-semibold text-terracotta">{m[0]}</span>);
    last = m.index + m[0].length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

/** "@ Tag" button that appends @Name to a target when a member is picked. */
function MentionPicker({ members, onPick }: { members: Member[]; onPick: (name: string) => void }) {
  const [open, setOpen] = useState(false);
  if (members.length === 0) return null;
  return (
    <div className="relative">
      <button type="button" onClick={() => setOpen((o) => !o)} className="px-2 py-1 rounded-lg text-[10px] font-semibold bg-stone/10 text-stone hover:bg-stone/20 transition-colors">@ Tag</button>
      {open && (
        <div className="absolute z-20 bottom-full mb-1 left-0 max-h-40 w-48 overflow-y-auto rounded-lg border border-sand bg-white shadow-md">
          {members.map((mem) => (
            <button
              key={mem.id}
              type="button"
              onClick={() => { onPick(mem.full_name || mem.username); setOpen(false); }}
              className="block w-full text-left px-2 py-1 text-[12px] text-espresso hover:bg-cream"
            >
              {mem.full_name || mem.username}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/**
 * The Basecamp-style objective dashboard: Message Board, Objective/Sub-objective
 * Overview, Docs & Files, and a Subtasks checkbox board. Shown in the right
 * panel on the landing (all objectives) and, scoped, inside a selected one.
 */
export default function ObjectiveOverview({ projects, onSelect, scopeId = null, kindLabel = "Objective", refreshSignal = 0, showOnly, addSubtaskSlot, onEditProject, currentUserId, isAdmin = false }: ObjectiveOverviewProps) {
  const [expandedOverview, setExpandedOverview] = useState<string | null>(null);
  const [msgFilter, setMsgFilter] = useState<"general" | "mine">("general");
  const lc = kindLabel.toLowerCase();
  const tabbed = Boolean(showOnly);
  // In tab mode only the chosen card renders (full-size); others are hidden.
  // In grid mode every card renders in the 2×2 layout.
  const cardClass = (key: DashboardCard) =>
    tabbed ? (showOnly === key ? CARD_TAB : "hidden") : CARD;
  const [stats, setStats] = useState<Stats>({});
  const [files, setFiles] = useState<FileRow[]>([]);
  // Docs & Files has two tabs: "uploaded" = files added to the objective/task
  // (project_files), "submitted" = files/links that came in through a task
  // submission (from /submitted-files).
  const [docsView, setDocsView] = useState<"uploaded" | "submitted">("uploaded");
  const [submittedFiles, setSubmittedFiles] = useState<SubmittedFileRow[]>([]);
  const [messages, setMessages] = useState<MessageRow[]>([]);
  const [subtasks, setSubtasks] = useState<SubtaskRow[]>([]);
  // Optimistic status overrides for ticked/unticked subtasks.
  const [statusOverride, setStatusOverride] = useState<Record<number, string>>({});
  const [reloadKey, setReloadKey] = useState(0);
  // Message composer.
  const [composing, setComposing] = useState(false);
  const [cTitle, setCTitle] = useState("");
  // The thread's objective — a one-line statement of its purpose, shown above
  // the message body. Stored in project_messages.category (an otherwise-unused
  // text column) so no schema change is needed.
  const [cObjective, setCObjective] = useState("");
  const [cBody, setCBody] = useState("");
  const [cTarget, setCTarget] = useState("");
  const [posting, setPosting] = useState(false);
  // Page-objective composer (the "+ Objective" banner).
  const [objComposing, setObjComposing] = useState(false);
  const [objText, setObjText] = useState("");
  const [objSaving, setObjSaving] = useState(false);
  // Open message thread + reply.
  const [activeThreadId, setActiveThreadId] = useState<number | null>(null);
  const [reply, setReply] = useState("");
  const [replying, setReplying] = useState(false);
  const [members, setMembers] = useState<Member[]>([]);
  // Groups start OPEN (per Toni). The set tracks the groups that have been
  // COLLAPSED, so absence = expanded; each group still pages internally so an
  // open group with hundreds of subtasks doesn't make the card enormous.
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(new Set());
  const [subFilters, setSubFilters] = useState<Set<SubFilter>>(new Set());
  const MINE = "__mine";
  const [memberFilter, setMemberFilter] = useState<string>(MINE);
  const todayEastern = easternToday();

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/team-members?all=true", { cache: "no-store" });
        const d = await res.json();
        if (!cancelled && Array.isArray(d.members)) {
          setMembers(d.members.map((m: Member) => ({ id: m.id, full_name: m.full_name, username: m.username })));
        }
      } catch { /* ignore */ }
    })();
    return () => { cancelled = true; };
  }, []);
  const memberNames = useMemo(() => members.map((m) => m.full_name || m.username).filter(Boolean), [members]);
  const myName = useMemo(() => {
    const me = members.find((m) => m.id === currentUserId);
    return me ? (me.full_name || me.username) : "";
  }, [members, currentUserId]);

  // The page-level Objective — one short "what is this page for" statement,
  // stored as a sentinel-titled project_messages row so it needs no schema
  // change. Kept out of the thread list and shown as a banner on top instead.
  const pageObjectiveMsg = useMemo(
    () => messages.find((m) => m.title === PAGE_OBJECTIVE_TITLE) ?? null,
    [messages]
  );
  const pageObjective = pageObjectiveMsg?.body ?? "";
  const threadMessages = useMemo(
    () => messages.filter((m) => m.title !== PAGE_OBJECTIVE_TITLE),
    [messages]
  );

  // "My Messages" = I authored the post or a reply, or I'm @mentioned in either.
  const visibleMessages = useMemo(() => {
    if (msgFilter !== "mine" || !currentUserId) return threadMessages;
    const mentionsMe = (text: string) => Boolean(myName) && new RegExp(`@${escapeRegex(myName)}`).test(text || "");
    return threadMessages.filter((m) =>
      m.author_id === currentUserId ||
      mentionsMe(m.body) ||
      m.comments.some((c) => c.author_id === currentUserId || mentionsMe(c.body))
    );
  }, [threadMessages, msgFilter, currentUserId, myName]);

  const projectById = useMemo(() => new Map(projects.map((p) => [p.id, p])), [projects]);

  const childrenByParent = useMemo(() => {
    const map = new Map<string, Project[]>();
    for (const p of projects) {
      const key = p.parent_project_id ?? "__root__";
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(p);
    }
    return map;
  }, [projects]);

  // Flattened parent→child ordering with depth, for the "which objective"
  // picker so nesting is easy to spot (parents flush left, sub-objectives
  // indented under them with a ↳ marker).
  const objectiveOptions = useMemo(() => {
    const out: { id: string; label: string }[] = [];
    const walk = (list: Project[], depth: number) => {
      for (const p of list) {
        const label = depth === 0
          ? p.name
          : `${"   ".repeat(depth)}↳ ${p.name}`;
        out.push({ id: p.id, label });
        walk(childrenByParent.get(p.id) ?? [], depth + 1);
      }
    };
    walk(childrenByParent.get("__root__") ?? [], 0);
    return out;
  }, [childrenByParent]);

  const descendantsOf = useCallback((id: string): string[] => {
    const acc: string[] = [];
    const walk = (pid: string) => {
      for (const c of childrenByParent.get(pid) ?? []) { acc.push(c.id); walk(c.id); }
    };
    walk(id);
    return acc;
  }, [childrenByParent]);

  // The objectives listed in the Overview card: roots at the landing, or the
  // scoped objective's direct children when inside one.
  const overviewItems = scopeId ? (childrenByParent.get(scopeId) ?? []) : (childrenByParent.get("__root__") ?? []);

  // Which projects' data (messages/docs/subtasks/stats) this view covers.
  const dataScopeIds = useMemo(() => {
    if (!scopeId) return projects.map((p) => p.id);
    return [scopeId, ...descendantsOf(scopeId)];
  }, [scopeId, projects, descendantsOf]);

  useEffect(() => {
    if (dataScopeIds.length === 0) { setStats({}); setFiles([]); setSubmittedFiles([]); setMessages([]); setSubtasks([]); return; }
    const qs = dataScopeIds.join(",");
    let cancelled = false;
    (async () => {
      try {
        const [s, f, sf, m, t] = await Promise.all([
          fetch(`/api/projects/subtask-stats?projectIds=${qs}`, { cache: "no-store" }).then((r) => r.json()).catch(() => ({})),
          fetch(`/api/projects/files-overview?projectIds=${qs}`, { cache: "no-store" }).then((r) => r.json()).catch(() => ({})),
          fetch(`/api/projects/submitted-files?projectIds=${qs}`, { cache: "no-store" }).then((r) => r.json()).catch(() => ({})),
          fetch(`/api/projects/messages-overview?projectIds=${qs}`, { cache: "no-store" }).then((r) => r.json()).catch(() => ({})),
          fetch(`/api/projects/subtasks-list?projectIds=${qs}`, { cache: "no-store" }).then((r) => r.json()).catch(() => ({})),
        ]);
        if (cancelled) return;
        setStats(s.stats ?? {});
        setFiles((f.files ?? []) as FileRow[]);
        setSubmittedFiles((sf.files ?? []) as SubmittedFileRow[]);
        setMessages((m.messages ?? []) as MessageRow[]);
        setSubtasks((t.subtasks ?? []) as SubtaskRow[]);
        setStatusOverride({});
      } catch {
        if (!cancelled) { setStats({}); setFiles([]); setSubmittedFiles([]); setMessages([]); setSubtasks([]); }
      }
    })();
    return () => { cancelled = true; };
  }, [dataScopeIds, reloadKey, refreshSignal]);

  const submitPost = async () => {
    const projectId = scopeId ?? cTarget;
    if (!projectId || !cTitle.trim()) return;
    setPosting(true);
    try {
      await fetch("/api/project-messages", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ project_id: projectId, title: cTitle.trim(), body: cBody.trim(), category: cObjective.trim() || null }),
      });
      setCTitle(""); setCObjective(""); setCBody(""); setCTarget(""); setComposing(false);
      setReloadKey((k) => k + 1);
    } finally {
      setPosting(false);
    }
  };

  // Save (or update) this page's Objective banner. Only meaningful on a single
  // objective/operation page, where scopeId identifies the one project it
  // belongs to.
  const savePageObjective = async () => {
    if (!scopeId) return;
    const text = objText.trim();
    setObjSaving(true);
    try {
      if (pageObjectiveMsg) {
        await fetch(`/api/project-messages?id=${pageObjectiveMsg.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ body: text }),
        });
      } else if (text) {
        await fetch("/api/project-messages", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ project_id: scopeId, title: PAGE_OBJECTIVE_TITLE, body: text }),
        });
      }
      setObjComposing(false);
      setReloadKey((k) => k + 1);
    } finally {
      setObjSaving(false);
    }
  };

  const submitReply = async () => {
    if (activeThreadId == null || !reply.trim()) return;
    setReplying(true);
    try {
      await fetch(`/api/project-messages/${activeThreadId}/comments`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ body: reply.trim() }),
      });
      setReply("");
      setReloadKey((k) => k + 1);
    } finally {
      setReplying(false);
    }
  };

  // Distinct assignees across the loaded subtasks — options for the team-member
  // filter dropdown.
  const subtaskMembers = useMemo(() => {
    const m = new Map<string, string>();
    for (const st of subtasks) for (const a of st.assignees) if (!m.has(a.id)) m.set(a.id, a.name);
    return Array.from(m.entries()).sort((a, b) => a[1].localeCompare(b[1]));
  }, [subtasks]);

  // Apply the status chips (OR across chips) and the team-member filter (AND)
  // before grouping.
  const filteredSubtasks = useMemo(() => {
    const today = easternToday();
    const active = Array.from(subFilters);
    return subtasks.filter((st) => {
      const wanted = memberFilter === MINE ? currentUserId : memberFilter;
      if (wanted && !st.assignees.some((a) => a.id === wanted)) return false;
      if (active.length > 0 && !active.some((f) => matchesSubFilter(st, f, today))) return false;
      return true;
    });
  }, [subtasks, subFilters, memberFilter, currentUserId, MINE]);

  const toggleSubFilter = (f: SubFilter) =>
    setSubFilters((prev) => {
      const next = new Set(prev);
      if (next.has(f)) next.delete(f); else next.add(f);
      return next;
    });

  // Subtasks grouped under their operation/objective, for the collapsible card.
  const subtaskGroups = useMemo(() => {
    const map = new Map<string, SubtaskRow[]>();
    for (const st of filteredSubtasks) {
      if (!map.has(st.project_id)) map.set(st.project_id, []);
      map.get(st.project_id)!.push(st);
    }
    return Array.from(map.entries());
  }, [filteredSubtasks]);

  const toggleGroup = (id: string) =>
    setCollapsedGroups((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });

  const filesByProject = useMemo(() => {
    const map = new Map<string, FileRow[]>();
    for (const f of files) {
      if (!map.has(f.project_id)) map.set(f.project_id, []);
      map.get(f.project_id)!.push(f);
    }
    return map;
  }, [files]);

  // Per overview item: aggregate its own + descendants' subtasks, sub-objective
  // count, and document count.
  const rollup = useMemo(() => {
    const byItem = new Map<string, { total: number; done: number; subObjectives: number; docs: number }>();
    for (const item of overviewItems) {
      const desc = descendantsOf(item.id);
      const ids = [item.id, ...desc];
      let total = 0, done = 0, docs = 0;
      for (const id of ids) {
        total += stats[id]?.total ?? 0;
        done += stats[id]?.done ?? 0;
        docs += (filesByProject.get(id)?.length ?? 0);
      }
      byItem.set(item.id, { total, done, subObjectives: desc.length, docs });
    }
    return byItem;
  }, [overviewItems, descendantsOf, stats, filesByProject]);

  // One avatar per TASK-assignment on each overview item's bar (the item + its
  // descendants). A task's dot sits at the START until it's approved, then moves
  // to the END. Glow: yellow while it's a pending submission, green once it's
  // been reviewed AND approved (auto-approved work moves but doesn't glow). Dots
  // are fanned within each end so faces in the same spot don't fully overlap.
  const taskRiders = useMemo(() => {
    const byProject = new Map<string, SubtaskRow[]>();
    for (const st of subtasks) {
      const arr = byProject.get(st.project_id);
      if (arr) arr.push(st); else byProject.set(st.project_id, [st]);
    }
    type Rider = { key: string; personId: string; name: string; avatar_url: string | null; done: boolean; glow: "yellow" | "green" | "" };
    const byItem = new Map<string, { key: string; name: string; avatar_url: string | null; pct: number; glow: "yellow" | "green" | "" }[]>();
    for (const item of overviewItems) {
      const ids = [item.id, ...descendantsOf(item.id)];
      const raw: Rider[] = [];
      for (const id of ids) {
        for (const st of byProject.get(id) ?? []) {
          if (STATUS_WEIGHT[st.status] === undefined) continue; // cancelled / unknown → excluded
          const done = APPROVED_STATUSES.has(st.status);
          const glow: "yellow" | "green" | "" = PENDING_STATUSES.has(st.status)
            ? "yellow"
            : (done && st.review_required ? "green" : "");
          for (const a of st.assignees) {
            raw.push({ key: `${st.id}-${a.id}`, personId: a.id, name: a.name, avatar_url: a.avatar_url, done, glow });
          }
        }
      }
      // One dot per TASK (one per assignee on it), not aggregated per person —
      // so an operation with several tasks reads as a stack of several faces.
      //
      // A task sits at the START until it's approved, then at the bar's own fill
      // edge — never past the green, so the faces and the fill always agree, and
      // at 0% every task sits together at the left rather than marching across a
      // track nobody has walked.
      const roll = rollup.get(item.id);
      const fill = roll && roll.total ? Math.round((roll.done / roll.total) * 100) : 0;
      const placed = raw
        // Glowing (pending-review) faces render last so they sit on top of the stack.
        .slice()
        .sort((a, b) => (a.glow ? 1 : 0) - (b.glow ? 1 : 0))
        .map((r) => ({
          key: r.key,
          name: r.name,
          avatar_url: r.avatar_url,
          glow: r.glow,
          pct: r.done ? Math.max(2, fill) : 2,
        }));

      // People at the same point get a small nudge apart so you can see there
      // is more than one of them — deliberately smaller than an avatar, so
      // they still read as a stack rather than a queue.
      //
      // Capped after a few: without the cap, everyone waiting at the start
      // marches to the right again, which is the behaviour this replaced. Past
      // the cap they simply pile on the same spot, and the count is read from
      // the depth of the stack rather than its width.
      const NUDGE = 1.6;
      const MAX_NUDGES = 3;
      const atPoint = new Map<number, number>();
      byItem.set(
        item.id,
        placed.map((r) => {
          const slot = Math.round(r.pct);
          const seen = atPoint.get(slot) ?? 0;
          atPoint.set(slot, seen + 1);
          const offset = Math.min(seen, MAX_NUDGES) * NUDGE;
          return { ...r, pct: Math.max(2, Math.min(fill || 2, r.pct + offset)) };
        })
      );
    }
    return byItem;
  }, [subtasks, overviewItems, descendantsOf, rollup]);

  const todoTasks = useMemo(
    () => filteredSubtasks.filter((st) => (st.todos ?? []).length > 0),
    [filteredSubtasks]
  );

  const [togglingTodoIds, setTogglingTodoIds] = useState<Set<number>>(new Set());

  const toggleTodo = useCallback(async (subtaskId: number, todo: Todo) => {
    const nextCompleted = !todo.completed;
    setTogglingTodoIds((prev) => new Set(prev).add(todo.id));
    // Optimistic — the PATCH below can still reject it (e.g. the subtask got
    // submitted in another tab a moment ago), in which case this rolls back.
    setSubtasks((prev) =>
      prev.map((s) =>
        s.id === subtaskId
          ? { ...s, todos: (s.todos ?? []).map((t) => (t.id === todo.id ? { ...t, completed: nextCompleted } : t)) }
          : s
      )
    );
    try {
      const res = await fetch(`/api/assigned-tasks/${subtaskId}/todos/${todo.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ completed: nextCompleted }),
      });
      if (!res.ok) {
        setSubtasks((prev) =>
          prev.map((s) =>
            s.id === subtaskId
              ? { ...s, todos: (s.todos ?? []).map((t) => (t.id === todo.id ? { ...t, completed: todo.completed } : t)) }
              : s
          )
        );
      }
    } catch {
      setSubtasks((prev) =>
        prev.map((s) =>
          s.id === subtaskId
            ? { ...s, todos: (s.todos ?? []).map((t) => (t.id === todo.id ? { ...t, completed: todo.completed } : t)) }
            : s
        )
      );
    } finally {
      setTogglingTodoIds((prev) => {
        const next = new Set(prev);
        next.delete(todo.id);
        return next;
      });
    }
  }, []);

  const effectiveStatus = (st: SubtaskRow) => statusOverride[st.id] ?? st.status;

  /** Whose task this is. Staff can see everyone's work but only tick their own. */
  const isMine = (st: SubtaskRow) =>
    Boolean(currentUserId) && st.assignees.some((a) => a.id === currentUserId);

  /**
   * Why a box is not tickable, or null when it is.
   *
   * Completed is reachable only from approved: ticking is the acknowledgement
   * that reviewed work is finished, so it cannot be used to skip the review.
   */
  const tickBlockedReason = (st: SubtaskRow): string | null => {
    if (!isAdmin && !isMine(st)) return "Only the person assigned to this can tick it.";
    const status = effectiveStatus(st);
    if (TICKED.has(status)) return null; // already done — untick is allowed
    if (status !== "approved") return "This has to be approved before it can be completed.";
    return null;
  };

  const toggleSubtask = async (st: SubtaskRow) => {
    if (tickBlockedReason(st)) return;
    const done = TICKED.has(effectiveStatus(st));
    // Unticking returns it to approved rather than to the back of the queue:
    // the work was reviewed, and undoing the tick does not undo the review.
    const next = done ? "approved" : "completed";
    setStatusOverride((prev) => ({ ...prev, [st.id]: next }));
    try {
      await fetch(`/api/assigned-tasks/${st.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: next }),
      });
    } catch {
      setStatusOverride((prev) => { const n = { ...prev }; delete n[st.id]; return n; });
    }
  };

  const statusCls = (active: boolean) =>
    active ? "bg-sage-soft text-sage border-sage/20" : "bg-stone/10 text-stone border-stone/20";

  const overviewTitle = scopeId ? `Sub-${lc} Overview` : `${kindLabel} Overview`;
  const activeThread = activeThreadId == null ? null : (messages.find((m) => m.id === activeThreadId) ?? null);

  if (!scopeId && overviewItems.length === 0) {
    return (
      <div className="rounded-xl border border-sand bg-white p-8 shadow-sm text-center">
        <p className="text-sm font-medium text-espresso">No {lc}s yet</p>
        <p className="mt-1 text-xs text-stone">Create one with &ldquo;New {kindLabel}&rdquo; to get started.</p>
      </div>
    );
  }

  return (
    <div className={tabbed ? "" : "grid grid-cols-1 lg:grid-cols-2 gap-4"}>
      {/* Message Board */}
      <div className={cardClass("board")}>
        {activeThread ? (
          <>
            <div className="flex items-center justify-between gap-2">
              <button type="button" onClick={() => setActiveThreadId(null)} className="text-[11px] font-semibold text-espresso hover:text-terracotta">← Message Board</button>
              <button
                type="button"
                onClick={() => { const proj = projectById.get(activeThread.project_id); if (proj) onSelect(proj); }}
                className="text-[10px] font-semibold text-slate-blue hover:underline truncate"
              >
                Open {projectById.get(activeThread.project_id)?.name ?? "objective"} →
              </button>
            </div>
            <div className="flex-1 overflow-y-auto space-y-2 min-h-0">
              {activeThread.objective && (
                <div className="rounded-lg border border-amber/30 bg-amber-soft/50 px-3 py-2">
                  <p className="text-[9px] font-bold text-amber uppercase tracking-wide">Objective</p>
                  <p className="mt-0.5 text-[12px] text-espresso whitespace-pre-wrap">{activeThread.objective}</p>
                </div>
              )}
              <div className="rounded-lg border border-sand bg-cream/40 p-3">
                <p className="text-[13px] font-bold text-espresso">{activeThread.title || "Untitled"}</p>
                {activeThread.body && <p className="mt-1 text-[12px] text-espresso whitespace-pre-wrap">{withMentions(activeThread.body, memberNames)}</p>}
                <p className="mt-1 text-[10px] text-bark">{formatDate(activeThread.created_at)}</p>
              </div>
              {activeThread.comments.map((c) => (
                <div key={c.id} className="rounded-lg border border-sand bg-white px-3 py-2">
                  <p className="text-[12px] text-espresso whitespace-pre-wrap">{withMentions(c.body, memberNames)}</p>
                  <p className="mt-1 text-[10px] text-bark">{c.author} · {formatDate(c.created_at)}</p>
                </div>
              ))}
              {activeThread.comments.length === 0 && <p className="text-[11px] text-walnut px-1">No replies yet.</p>}
            </div>
            <div className="pt-1 space-y-1">
              <MentionPicker members={members} onPick={(n) => setReply((r) => `${r}${r && !r.endsWith(" ") ? " " : ""}@${n} `)} />
              <div className="flex items-end gap-2">
                <textarea
                  value={reply}
                  onChange={(e) => setReply(e.target.value)}
                  placeholder="Reply…"
                  rows={2}
                  className="flex-1 rounded-lg border border-sand px-2 py-1.5 text-[12px] text-espresso outline-none bg-white resize-none"
                />
                <button
                  type="button"
                  onClick={() => void submitReply()}
                  disabled={replying || !reply.trim()}
                  className="px-3 py-1.5 rounded-lg bg-sage text-white text-[11px] font-semibold hover:bg-sage/90 transition-colors disabled:opacity-50 shrink-0"
                >
                  {replying ? "…" : "Reply"}
                </button>
              </div>
            </div>
          </>
        ) : (
        <>
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <div className="flex items-center gap-1 rounded-lg border border-sand bg-parchment/40 p-1">
            {([["general", "General"], ["mine", "My Messages"]] as const).map(([v, label]) => (
              <button key={v} type="button" onClick={() => setMsgFilter(v)}
                className={`rounded-md px-2.5 py-1 text-[11px] font-semibold transition-colors ${msgFilter === v ? "bg-white text-espresso shadow-sm" : "text-walnut hover:text-espresso"}`}>
                {label}
              </button>
            ))}
          </div>
          <div className="flex items-center gap-1.5">
            {scopeId && (
              <button
                type="button"
                onClick={() => { setObjText(pageObjective); setObjComposing((v) => !v); }}
                className="px-3 py-1 rounded-lg text-[10px] font-semibold bg-amber text-white hover:bg-amber/90 transition-colors"
              >
                {objComposing ? "Cancel" : "+ Objective"}
              </button>
            )}
            <button
              type="button"
              onClick={() => setComposing((v) => !v)}
              className="px-3 py-1 rounded-lg text-[10px] font-semibold bg-stone/15 text-espresso hover:bg-stone/25 transition-colors"
            >
              {composing ? "Cancel" : "+ Topic"}
            </button>
          </div>
        </div>
        {/* Page-level Objective: what this whole page is for. Banner on top of
            the threads; edited via the "+ Objective" composer. Only on a single
            objective/operation page (scopeId), never the all-items landing. */}
        {scopeId && (objComposing ? (
          <div className="space-y-2 rounded-lg border border-amber/30 bg-amber-soft/40 p-3">
            <p className="text-[9px] font-bold text-amber uppercase tracking-wide">Objective of this page</p>
            <textarea
              value={objText}
              onChange={(e) => setObjText(e.target.value)}
              placeholder="A short objective — what is this page for?"
              rows={2}
              className="w-full rounded-lg border border-sand px-2 py-1.5 text-[12px] text-espresso outline-none bg-white resize-none"
            />
            <div className="flex justify-end">
              <button
                type="button"
                onClick={() => void savePageObjective()}
                disabled={objSaving}
                className="px-3 py-1 rounded-lg bg-sage text-white text-[11px] font-semibold hover:bg-sage/90 transition-colors disabled:opacity-50"
              >
                {objSaving ? "Saving…" : "Save Objective"}
              </button>
            </div>
          </div>
        ) : pageObjective ? (
          <div className="rounded-lg border border-amber/30 bg-amber-soft/40 px-3 py-2">
            <p className="text-[9px] font-bold text-amber uppercase tracking-wide">Objective</p>
            <p className="mt-0.5 text-[12px] text-espresso whitespace-pre-wrap">{pageObjective}</p>
          </div>
        ) : null)}
        {composing && (
          <div className="space-y-2 rounded-lg border border-sand bg-cream/40 p-3">
            {!scopeId && (
              <select
                value={cTarget}
                onChange={(e) => setCTarget(e.target.value)}
                className="w-full rounded-lg border border-sand px-2 py-1.5 text-[12px] text-espresso outline-none bg-white"
              >
                <option value="">Which objective…</option>
                {objectiveOptions.map((o) => (
                  <option key={o.id} value={o.id}>{o.label}</option>
                ))}
              </select>
            )}
            <input
              value={cTitle}
              onChange={(e) => setCTitle(e.target.value)}
              placeholder="Topic / title"
              className="w-full rounded-lg border border-sand px-2 py-1.5 text-[12px] text-espresso outline-none bg-white"
            />
            <input
              value={cObjective}
              onChange={(e) => setCObjective(e.target.value)}
              placeholder="Objective — what's the purpose of this thread?"
              className="w-full rounded-lg border border-sand px-2 py-1.5 text-[12px] text-espresso outline-none bg-white"
            />
            <textarea
              value={cBody}
              onChange={(e) => setCBody(e.target.value)}
              placeholder="Write a message…"
              rows={3}
              className="w-full rounded-lg border border-sand px-2 py-1.5 text-[12px] text-espresso outline-none bg-white resize-none"
            />
            <div className="flex justify-between items-center gap-2">
              <MentionPicker members={members} onPick={(n) => setCBody((b) => `${b}${b && !b.endsWith(" ") ? " " : ""}@${n} `)} />
              <button
                type="button"
                onClick={() => void submitPost()}
                disabled={posting || !cTitle.trim() || (!scopeId && !cTarget)}
                className="px-3 py-1 rounded-lg bg-sage text-white text-[11px] font-semibold hover:bg-sage/90 transition-colors disabled:opacity-50"
              >
                {posting ? "Posting…" : "Post"}
              </button>
            </div>
          </div>
        )}
        <Paginated items={visibleMessages} pageSize={5} empty={<p className="text-[12px] text-walnut">{msgFilter === "mine" ? "Nothing addressed to you here yet." : "No posts yet. Use “+ Topic” to start a thread."}</p>}>
          {(slice) => (
            <div className="space-y-2">
              {slice.map((msg) => {
                const proj = projectById.get(msg.project_id);
                return (
                  <button key={msg.id} onClick={() => setActiveThreadId(msg.id)} className="w-full text-left flex flex-col gap-0.5 py-2 px-3 rounded-lg border border-sand bg-white hover:bg-cream transition-colors">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-[12px] font-semibold text-espresso truncate">{msg.title || "Untitled"}</span>
                      {msg.comment_count > 0 && <span className="shrink-0 text-[10px] text-stone">{msg.comment_count} comment{msg.comment_count === 1 ? "" : "s"}</span>}
                    </div>
                    {msg.objective && <span className="text-[10px] font-semibold text-amber truncate">🎯 {msg.objective}</span>}
                    {msg.body && <span className="text-[11px] text-walnut truncate">{withMentions(msg.body, memberNames)}</span>}
                    <span className="text-[10px] text-bark truncate">{proj?.name ?? "Objective"} · {formatDate(msg.created_at)}</span>
                  </button>
                );
              })}
            </div>
          )}
        </Paginated>
        </>
        )}
      </div>

      {/* Objective / Sub-objective Overview */}
      <div className={cardClass("overview")}>
        <h3 className={CARD_TITLE}>{overviewTitle}</h3>
        <Paginated items={overviewItems} pageSize={5} empty={<p className="text-[12px] text-walnut">No {scopeId ? `sub-${lc}s` : `${lc}s`} yet.</p>}>
          {(slice) => (
            <div className="space-y-2">
              {slice.map((p) => {
                const r = rollup.get(p.id) ?? { total: 0, done: 0, subObjectives: 0, docs: 0 };
                const pct = r.total ? Math.round((r.done / r.total) * 100) : 0;
                const open = expandedOverview === p.id;
                return (
                  <div key={p.id} className="rounded-lg border border-sand bg-white overflow-hidden">
                    <button onClick={() => setExpandedOverview(open ? null : p.id)} className="w-full text-left flex flex-col gap-1.5 py-2.5 px-3 hover:bg-cream transition-colors">
                      <div className="flex items-start justify-between gap-2">
                        <span className="flex items-center gap-1.5 min-w-0">
                          <span className="text-bark text-[9px] w-2 shrink-0">{open ? "▼" : "▶"}</span>
                          <span className="text-[13px] font-semibold text-espresso leading-tight truncate">{p.name}</span>
                        </span>
                        <span className={`shrink-0 text-[10px] font-semibold px-2 py-[2px] rounded-full border ${statusCls(p.is_active)}`}>{p.is_active ? "Active" : "Inactive"}</span>
                      </div>
                      {(() => {
                        const riders = taskRiders.get(p.id) ?? [];
                        return (
                          <div className="relative h-6 w-full">
                            <div className="absolute inset-x-0 top-1/2 -translate-y-1/2 h-2 overflow-hidden rounded-full bg-parchment">
                              <div className="h-full rounded-full bg-sage transition-all" style={{ width: `${pct}%` }} />
                            </div>
                            {riders.map((r) => {
                              // Yellow = submission awaiting review. Green = reviewed
                              // and approved. Auto-approved work moves but doesn't glow.
                              const glow = r.glow === "yellow"
                                ? "ring-2 ring-amber shadow-[0_0_10px_2px_rgba(184,134,11,0.8)] animate-pulse"
                                : r.glow === "green"
                                ? "ring-2 ring-sage shadow-[0_0_10px_2px_rgba(107,143,113,0.8)]"
                                : "";
                              return (
                              <span
                                key={r.key}
                                className={`absolute top-1/2 -translate-y-1/2 -translate-x-1/2 transition-all duration-500 ease-out rounded-full ${glow}`}
                                style={{ left: `${r.pct}%` }}
                                title={`${r.name}${r.glow === "yellow" ? " · submission awaiting review" : r.glow === "green" ? " · reviewed & approved" : ""}`}
                              >
                                <Avatar person={{ id: r.key, name: r.name, avatar_url: r.avatar_url }} />
                              </span>
                              );
                            })}
                          </div>
                        );
                      })()}
                      <div className="flex items-center justify-between gap-2 text-[11px] font-semibold text-amber">
                        <span>{r.subObjectives} sub-{kindLabel === "Operation" ? "op" : "obj"} · {r.total} subtask{r.total === 1 ? "" : "s"} · {r.docs} doc{r.docs === 1 ? "" : "s"} · {pct}%</span>
                        {p.target_date && <span className="text-terracotta font-semibold shrink-0">Target: {formatDate(p.target_date)}</span>}
                      </div>
                    </button>
                    {open && (
                      <div className="border-t border-sand text-[12px]">
                        {([
                          ["Status", p.status],
                          ["Account", p.account],
                          ["Start Date", p.start_date ? formatDate(p.start_date) : null],
                          ["Target Date", p.target_date ? formatDate(p.target_date) : null],
                          ["Description", p.description],
                          ["Details", p.details],
                          ["Notes", p.notes],
                        ] as [string, string | null | undefined][]).map(([label, value]) => (
                          <div key={label} className="flex border-b border-sand/60">
                            <div className="w-28 shrink-0 bg-parchment/40 px-3 py-1.5 text-[10px] font-semibold uppercase tracking-wider text-walnut">{label}</div>
                            <div className={`flex-1 px-3 py-1.5 whitespace-pre-wrap ${value ? "text-espresso" : "text-stone/50"}`}>{value || "--"}</div>
                          </div>
                        ))}
                        <div className="flex justify-end gap-1 p-2">
                          <button onClick={() => onSelect(p)} className="px-3 py-1 rounded-lg text-[11px] font-semibold bg-stone/15 text-espresso hover:bg-stone/25 transition-colors">Open →</button>
                          {onEditProject && <button onClick={() => onEditProject(p)} className="px-3 py-1 rounded-lg text-[11px] font-semibold bg-sage text-white hover:bg-sage/90 transition-colors">Edit</button>}
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </Paginated>
      </div>

      {/* Docs & Files — Uploaded (project files) vs Submitted (from submissions) */}
      <div className={cardClass("docs")}>
        <div className="flex items-center justify-between gap-2 mb-2">
          <h3 className={`${CARD_TITLE} mb-0`}>Docs &amp; Files</h3>
          <div className="flex items-center gap-1 rounded-lg border border-sand bg-parchment/40 p-1">
            {([["uploaded", "Uploaded"], ["submitted", "Submitted"]] as const).map(([v, label]) => (
              <button key={v} type="button" onClick={() => setDocsView(v)}
                className={`rounded-md px-2.5 py-1 text-[11px] font-semibold transition-colors ${docsView === v ? "bg-white text-espresso shadow-sm" : "text-walnut hover:text-espresso"}`}>
                {label}
              </button>
            ))}
          </div>
        </div>
        {docsView === "uploaded" ? (
          <Paginated items={files} pageSize={8} empty={<p className="text-[12px] text-walnut">No uploaded files yet.</p>}>
            {(slice) => (
              <div className="space-y-1.5">
                {slice.map((f) => {
                  const proj = projectById.get(f.project_id);
                  return (
                    <button key={f.id} onClick={() => proj && onSelect(proj)} className="w-full text-left flex items-center justify-between gap-2 py-1.5 px-2 rounded-lg hover:bg-cream transition-colors">
                      <span className="min-w-0">
                        <span className="block text-[12px] text-espresso truncate">{f.filename}</span>
                        <span className="block text-[10px] text-bark truncate">{proj?.name ?? "Objective"}</span>
                      </span>
                      <span className="text-[10px] text-bark shrink-0">{formatDate(f.uploaded_at)}</span>
                    </button>
                  );
                })}
              </div>
            )}
          </Paginated>
        ) : (
          <Paginated items={submittedFiles} pageSize={8} empty={<p className="text-[12px] text-walnut">Nothing submitted yet.</p>}>
            {(slice) => (
              <div className="space-y-1.5">
                {slice.map((f) => {
                  const proj = projectById.get(f.project_id);
                  const inner = (
                    <>
                      <span className="min-w-0">
                        <span className="block text-[12px] text-espresso truncate">{f.href ? "🔗 " : ""}{f.filename}</span>
                        <span className="block text-[10px] text-bark truncate">{proj?.name ?? "Objective"}</span>
                      </span>
                      <span className="text-[10px] text-bark shrink-0">{formatDate(f.uploaded_at)}</span>
                    </>
                  );
                  return f.href ? (
                    <a key={f.id} href={f.href} target="_blank" rel="noreferrer" className="w-full text-left flex items-center justify-between gap-2 py-1.5 px-2 rounded-lg hover:bg-cream transition-colors">
                      {inner}
                    </a>
                  ) : (
                    <button key={f.id} onClick={() => proj && onSelect(proj)} className="w-full text-left flex items-center justify-between gap-2 py-1.5 px-2 rounded-lg hover:bg-cream transition-colors">
                      {inner}
                    </button>
                  );
                })}
              </div>
            )}
          </Paginated>
        )}
      </div>

      {/* Subtasks (checkboxes) — replaces the Progress card, always present */}
      <div className={cardClass("subtasks")}>
        {/* Title + filter chips on one line — no chip active = all; multiple = OR. */}
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
          <h3 className={`${CARD_TITLE} mb-0`}>All Subtasks</h3>
          <div className="flex flex-wrap items-center gap-1">
            {SUB_FILTERS.map(({ key, label }) => {
              const on = subFilters.has(key);
              return (
                <button
                  key={key}
                  type="button"
                  onClick={() => toggleSubFilter(key)}
                  className={`px-2 py-[3px] rounded-full text-[10px] font-semibold border transition-colors ${
                    on ? "bg-sage text-white border-sage" : "bg-white text-walnut border-sand hover:border-stone"
                  }`}
                >
                  {label}
                </button>
              );
            })}
            {subFilters.size > 0 && (
              <button
                type="button"
                onClick={() => setSubFilters(new Set())}
                className="px-2 py-[3px] rounded-full text-[10px] font-semibold text-bark hover:text-espresso"
              >
                Clear
              </button>
            )}
          </div>
          {subtaskMembers.length > 0 && (
            <select
              value={memberFilter}
              onChange={(e) => setMemberFilter(e.target.value)}
              className="rounded-lg border border-sand px-2 py-1 text-[11px] text-espresso outline-none bg-white"
            >
              <option value={MINE}>My Subtasks</option>
              <option value="">All members</option>
              {subtaskMembers.map(([id, name]) => (
                <option key={id} value={id}>{name}</option>
              ))}
            </select>
          )}
        </div>
        <div className="flex-1 overflow-y-auto min-h-0 space-y-3">
        {addSubtaskSlot}
        {subtaskGroups.length === 0 ? (
          <p className="text-[12px] text-walnut">{subFilters.size > 0 ? "No subtasks match this filter." : "No subtasks yet."}</p>
        ) : (
          <div className="space-y-2">
            {subtaskGroups.map(([pid, list]) => {
              const proj = projectById.get(pid);
              const expanded = !collapsedGroups.has(pid);
              return (
                <div key={pid} className="rounded-lg border border-sand overflow-hidden">
                  <button
                    type="button"
                    onClick={() => toggleGroup(pid)}
                    className="w-full flex items-center justify-between gap-2 px-2 py-1.5 bg-parchment/50 hover:bg-parchment transition-colors"
                  >
                    <span className="flex items-center gap-1.5 min-w-0 text-[11px] font-bold uppercase tracking-wide text-espresso">
                      <span className="text-bark text-[9px] w-2 shrink-0">{expanded ? "▼" : "▶"}</span>
                      <span className="truncate">{proj?.name ?? "—"}</span>
                    </span>
                    <span className="text-[10px] text-stone shrink-0">{list.length}</span>
                  </button>
                  {expanded && (
                    <div className="p-1.5">
                    <Paginated items={list} pageSize={10} empty={null}>
                      {(slice) => (
                    <div className="divide-y divide-sand/50">
                      {list.map((st) => {
                        const done = TICKED.has(effectiveStatus(st));
                        const blocked = tickBlockedReason(st);
                        const owners = st.assignees.map((a) => a.name).join(", ");
                        return (
                          <label key={st.id} title={blocked ?? undefined} className={`flex items-center gap-2 py-1.5 px-2 border-l-4 ${subtaskAccent(st, todayEastern)} hover:bg-cream transition-colors ${blocked ? "cursor-default" : "cursor-pointer"}`}>
                            <input
                              type="checkbox"
                              checked={done}
                              disabled={Boolean(blocked)}
                              title={blocked ?? undefined}
                              onChange={() => void toggleSubtask(st)}
                              className="shrink-0 accent-sage disabled:cursor-not-allowed disabled:opacity-40"
                            />
                            <span className="min-w-0 flex-1">
                              <span className={`flex items-center gap-1 text-[12px] ${done ? "text-stone line-through" : "text-espresso"}`}>
                                {st.recurring && (
                                  <span title="Recurring" className="shrink-0 text-slate-blue" aria-label="Recurring">
                                    <svg className="h-3 w-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                                      <path d="M17 2l4 4-4 4" /><path d="M3 11v-1a4 4 0 0 1 4-4h14" />
                                      <path d="M7 22l-4-4 4-4" /><path d="M21 13v1a4 4 0 0 1-4 4H3" />
                                    </svg>
                                  </span>
                                )}
                                <span className="truncate">{st.task_name}</span>
                              </span>
                              <span className="block text-[10px] text-bark truncate">
                                {[st.account, st.client].filter(Boolean).join(" · ") || "—"}
                                {owners ? ` · ${owners}` : " · Unassigned"}
                                {st.due_date ? ` · Due ${formatDate(st.due_date)}` : ""}
                              </span>
                            </span>
                            {st.assignees.length > 0 && (
                              <span className="flex -space-x-1.5 shrink-0">
                                {st.assignees.slice(0, 3).map((a) => <Avatar key={a.id} person={a} />)}
                                {st.assignees.length > 3 && <span className="text-[10px] text-stone self-center pl-1">+{st.assignees.length - 3}</span>}
                              </span>
                            )}
                          </label>
                        );
                      })}
                    </div>
                      )}
                    </Paginated>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
        </div>
      </div>

      {/* To-Do List — the to-do items inside subtasks, pulled up to their own
          tab. Same scope and the same My/All filter as the checklist. */}
      <div className={cardClass("todos")}>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
          <h3 className={`${CARD_TITLE} mb-0`}>To-Do List</h3>
          {subtaskMembers.length > 0 && (
            <select
              value={memberFilter}
              onChange={(e) => setMemberFilter(e.target.value)}
              className="rounded-lg border border-sand px-2 py-1 text-[11px] text-espresso outline-none bg-white"
            >
              <option value={MINE}>My To-Dos</option>
              <option value="">All members</option>
              {subtaskMembers.map(([id, name]) => (
                <option key={id} value={id}>{name}</option>
              ))}
            </select>
          )}
        </div>
        <div className="flex-1 overflow-y-auto min-h-0 mt-2">
          {todoTasks.length === 0 ? (
            <p className="text-[12px] text-walnut">No to-dos on these subtasks yet.</p>
          ) : (
            <div className="space-y-2">
              {todoTasks.map((st) => {
                // Owners check their own — a VA browsing "All members" can see
                // everyone's to-dos but only ever toggle the ones on a subtask
                // they're actually assigned to. Admin/manager keep the same
                // override the rest of this app gives them (matches the
                // server's canAccessTodos, which this mirrors).
                const isOwner = Boolean(currentUserId) && st.assignees.some((a) => a.id === currentUserId);
                const isLocked = LOCKED_TODO_STATUSES.has(effectiveStatus(st));
                const canCheck = !isLocked && (isAdmin || isOwner);
                return (
                  <div key={st.id} className="rounded-lg border border-sand bg-white p-2.5">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        {/* Client Detail leads — several subtasks under one Objective
                            often share the same task name, so the title alone doesn't
                            say which one this is. Task name + account + dates
                            underneath for the rest of the context. */}
                        <span className="text-[12px] font-semibold text-espresso leading-tight">
                          {st.task_detail || st.task_name}
                        </span>
                        <p className="text-[10px] text-stone/80 leading-snug mt-0.5">
                          {[st.task_name, st.account].filter(Boolean).join(" · ")}
                          {st.start_date ? ` · Start ${formatDate(st.start_date)}` : ""}
                          {st.due_date ? ` · Due ${formatDate(st.due_date)}` : ""}
                        </p>
                      </div>
                      <div className="flex flex-col items-end gap-0.5 shrink-0">
                        {st.assignees.length > 0 && (
                          <span className="flex -space-x-1.5">
                            {st.assignees.slice(0, 3).map((a) => <Avatar key={a.id} person={a} />)}
                            {st.assignees.length > 3 && <span className="text-[10px] text-stone self-center pl-1">+{st.assignees.length - 3}</span>}
                          </span>
                        )}
                        <span className="text-[10px] text-stone text-right">
                          {st.assignees.map((a) => a.name).join(", ") || "Unassigned"}
                        </span>
                      </div>
                    </div>
                    <ul className="mt-1 space-y-1">
                      {(st.todos ?? []).map((todo) => (
                        <li key={todo.id} className="text-[11px] text-walnut flex items-start gap-1.5">
                          <input
                            type="checkbox"
                            checked={todo.completed}
                            disabled={!canCheck || togglingTodoIds.has(todo.id)}
                            onChange={() => void toggleTodo(st.id, todo)}
                            title={isLocked ? "Locked — this subtask has already been submitted" : !canCheck ? "Only the assignee can check this off" : undefined}
                            className="mt-0.5 h-3 w-3 shrink-0 rounded border-sand text-terracotta focus:ring-terracotta disabled:cursor-not-allowed"
                          />
                          <span className={todo.completed ? "line-through text-stone/70" : undefined}>{todo.text}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
