"use client";

// Board View for the Subtasks section (Part B, docs/objective-foundation-feature.md).
// Kanban columns + a persistent left-side reference list, both reading the same
// `subtasks` array passed in from VAProjectsTab — no separate data set.
//
// Column/status grouping lives entirely in src/lib/subtaskStatusColumns.ts — see
// that file for the still-open questions on revision_needed / on_queue / paid /
// cancelled placement.

import { useEffect, useMemo, useRef, useState } from "react";
import { BOARD_COLUMNS, boardStatus, columnForStatus, COLUMN_ACCENT_TEXT } from "@/lib/subtaskStatusColumns";
import { assigneeNames } from "@/lib/subtaskDisplay";
import { ORG_TIMEZONE } from "@/lib/taskSchedule";
import type { Profile } from "@/types/database";
import type { SubtaskRow } from "@/components/VAProjectsTab";

// The status a card is shown under. Drag-and-drop below deliberately keeps
// reading the raw sub.status, so what can be dragged is unchanged.
const shownStatus = (sub: SubtaskRow) => boardStatus(sub.status, sub.assigned_task_assignees);

// A card counts as overdue once its due date has passed and it hasn't
// actually been accepted yet — matches ObjectiveOverview's own
// subtaskTitleColor: once something is approved/completed/paid, a due date
// in the past isn't a problem anymore, so it stops being flagged.
const RESOLVED_STATUSES = new Set(["completed", "paid", "approved"]);
function isOverdue(sub: SubtaskRow, today: string): boolean {
  if (!sub.due_date || RESOLVED_STATUSES.has(shownStatus(sub))) return false;
  return sub.due_date < today;
}

/**
 * What a card can lead with. Task names repeat across a whole board ("Promo
 * Processing" ×20), so the Client Detail memo is often the line that actually
 * says what the task is. Mirrors the Title choice on the Submissions page.
 */
const TITLE_FIELDS: { value: string; label: string; get: (sub: SubtaskRow) => string | null | undefined }[] = [
  { value: "task", label: "Task name", get: (sub) => sub.task_name },
  { value: "client_detail", label: "Client detail", get: (sub) => sub.task_detail },
  { value: "notes", label: "Notes", get: (sub) => sub.task_notes },
  { value: "instructions", label: "Instructions", get: (sub) => sub.instructions },
  { value: "account", label: "Account", get: (sub) => sub.account },
  { value: "project", label: "Objective / Operation", get: (sub) => sub.project ?? sub.category },
];
/**
 * The lines a card can show besides its title, each switchable. Client detail
 * and notes start hidden so the default card looks the way it always has.
 */
const CARD_FIELDS = [
  { key: "status", label: "Status badge" },
  { key: "task", label: "Task name" },
  { key: "assignees", label: "Assigned VA" },
  { key: "account", label: "Account" },
  { key: "project", label: "Objective / Operation" },
  { key: "client_detail", label: "Client detail" },
  { key: "notes", label: "Notes" },
  { key: "due_date", label: "Due date" },
  { key: "due_countdown", label: "Days overdue / until due" },
] as const;
const DEFAULT_HIDDEN = ["client_detail", "notes"];
const CARD_PREFS_ID = "subtask-board-card";

type CardPrefs = { title: string; hidden: string[] };
const DEFAULT_CARD_PREFS: CardPrefs = { title: "task", hidden: DEFAULT_HIDDEN };

/** A stored payload with no title means "no choice made" — see resetMine. */
function readCardPrefs(raw: unknown): CardPrefs | null {
  const p = raw as { title?: unknown; hidden?: unknown } | null;
  if (!p || typeof p.title !== "string") return null;
  return {
    title: TITLE_FIELDS.some((f) => f.value === p.title) ? p.title : "task",
    hidden: Array.isArray(p.hidden) ? p.hidden.filter((h): h is string => typeof h === "string") : DEFAULT_HIDDEN,
  };
}

/**
 * The board's card layout: the person's own choice if they made one,
 * otherwise the sitewide default an admin set, otherwise DEFAULT_CARD_PREFS.
 * Both live in /api/table-prefs so they follow the person across devices.
 */
function useBoardCardPrefs(userId: string | null) {
  const [personal, setPersonal] = useState<CardPrefs | null>(null);
  const [sitewide, setSitewide] = useState<CardPrefs | null>(null);

  useEffect(() => {
    if (!userId) return;
    let cancelled = false;
    const read = (scope: string) =>
      fetch(`/api/table-prefs?tableId=${CARD_PREFS_ID}${scope}`, { cache: "no-store" })
        .then((r) => (r.ok ? r.json() : null))
        .then((d) => readCardPrefs(d?.prefs))
        .catch(() => null);
    Promise.all([read(""), read("&scope=sitewide")]).then(([mine, everyone]) => {
      if (cancelled) return;
      setPersonal(mine);
      setSitewide(everyone);
    });
    return () => {
      cancelled = true;
    };
  }, [userId]);

  const save = (prefs: CardPrefs | { title: null }, scope?: "sitewide") =>
    fetch("/api/table-prefs", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ tableId: CARD_PREFS_ID, prefs, ...(scope ? { scope } : {}) }),
    }).catch(() => {
      // Best-effort — the choice still applies for this visit.
    });

  const sitewidePrefs = sitewide ?? DEFAULT_CARD_PREFS;
  const effective = personal ?? sitewidePrefs;
  return {
    prefs: effective,
    sitewidePrefs,
    hasPersonal: personal != null,
    update: (patch: Partial<CardPrefs>, scope: "mine" | "sitewide") => {
      if (scope === "sitewide") {
        // Setting the default for everyone also drops the admin's own
        // override, so what they just chose is what they see.
        const next = { ...sitewidePrefs, ...patch };
        setSitewide(next);
        setPersonal(null);
        save(next, "sitewide");
        save({ title: null });
      } else {
        const next = { ...effective, ...patch };
        setPersonal(next);
        save(next);
      }
    },
    resetMine: () => {
      setPersonal(null);
      save({ title: null });
    },
  };
}

/** Whole days from today to the due date (negative once it's passed). */
function daysUntil(dueDate: string, today: string): number {
  const toUtc = (d: string) => {
    const [y, m, day] = d.slice(0, 10).split("-").map(Number);
    return Date.UTC(y, m - 1, day);
  };
  return Math.round((toUtc(dueDate) - toUtc(today)) / 86_400_000);
}

interface SubtaskBoardViewProps {
  subtasks: SubtaskRow[];
  editingSubId: number | null;
  onOpenEdit: (sub: SubtaskRow) => void;
  formatDate: (iso: string | null | undefined) => string;
  StatusBadge: React.ComponentType<{ status: string; paidManually?: boolean }>;
  activeProfiles: Pick<Profile, "id" | "full_name" | "username">[];
  /** Persist a card moved by drag. The board only ever allows the one lifecycle-
   *  safe move (Approved → Completed), so this is the single transition it fires. */
  onMoveStatus?: (subtaskId: number, toStatus: string) => void;
  /** Whose card choices to load and save. */
  currentUserId: string;
  /** Admins can also set the card layout for everyone. */
  canSetSitewide?: boolean;
  /** Full-screen state lives with the parent so the edit form can sit beside the board. */
  expanded?: boolean;
  onToggleExpanded?: () => void;
}

// The one drag the board permits. Every other status still moves through the
// normal dashboard flow — dragging can't skip review or reopen finished work.
const DRAG_FROM_STATUS = "approved";
const DRAG_TO_COLUMN = "completed";

// Cards per column before pagination kicks in. Columns like Pending can hold
// 100+ tasks, so each column pages independently rather than scrolling forever.
const PAGE_SIZE = 8;

export default function SubtaskBoardView({
  subtasks,
  editingSubId,
  onOpenEdit,
  formatDate,
  StatusBadge,
  activeProfiles,
  onMoveStatus,
  currentUserId,
  canSetSitewide = false,
  expanded = false,
  onToggleExpanded,
}: SubtaskBoardViewProps) {
  const cardPrefs = useBoardCardPrefs(currentUserId || null);
  const titleDef = TITLE_FIELDS.find((f) => f.value === cardPrefs.prefs.title) ?? TITLE_FIELDS[0];
  const shows = (key: string) => !cardPrefs.prefs.hidden.includes(key);
  // Falls back to the task name when the chosen field is empty on this card,
  // so no card ends up titled with nothing.
  const cardTitle = (sub: SubtaskRow) => titleDef.get(sub)?.trim() || sub.task_name;
  // Per-column page index. The ONLY drag allowed is Approved → Completed (a card
  // approved by a reviewer is dragged to Completed, which persists everywhere);
  // every other status still moves through the dashboard flow, never by drag.
  const [pageByCol, setPageByCol] = useState<Record<string, number>>({});
  const [dragging, setDragging] = useState<{ id: number; status: string } | null>(null);
  const [overCol, setOverCol] = useState<string | null>(null);
  // Collapsed by default — Toni's read on the always-open 560px reference
  // list was that it ate too much space for what it's worth next to the
  // columns, which already show every card. Same ▼/▶ toggle already used for
  // the project groups in ObjectiveOverview's own Subtasks list.
  const [referenceListOpen, setReferenceListOpen] = useState(false);
  const canComplete = Boolean(onMoveStatus) && dragging?.status === DRAG_FROM_STATUS;
  const today = useMemo(
    () => new Date().toLocaleDateString("en-CA", { timeZone: ORG_TIMEZONE }),
    []
  );

  // One pass over `subtasks` builds both the column grouping and the
  // reference list.
  //
  // Reference list mirrors the columns exactly — "same subtasks in one place
  // regardless of column," per the Figma spec, not a superset. Anything
  // excluded from the columns (currently paid/cancelled, see
  // subtaskStatusColumns.ts) is excluded here too — surfaced below via
  // `hiddenCount` instead of just vanishing with no trace.
  const { subtasksByColumn, boardSubtasks, hiddenCount } = useMemo(() => {
    const byColumn = new Map<string, SubtaskRow[]>();
    for (const col of BOARD_COLUMNS) byColumn.set(col.key, []);
    const inBoard: SubtaskRow[] = [];
    let hidden = 0;
    for (const sub of subtasks) {
      const col = columnForStatus(shownStatus(sub));
      if (col) {
        byColumn.get(col.key)!.push(sub);
        inBoard.push(sub);
      } else {
        hidden += 1;
      }
    }
    return { subtasksByColumn: byColumn, boardSubtasks: inBoard, hiddenCount: hidden };
  }, [subtasks]);

  return (
    <div className="space-y-2">
    <div className="flex items-center justify-end gap-2">
      <BoardCardPicker
        prefs={cardPrefs.prefs}
        sitewidePrefs={cardPrefs.sitewidePrefs}
        hasPersonal={cardPrefs.hasPersonal}
        canSetSitewide={canSetSitewide}
        onUpdate={cardPrefs.update}
        onResetMine={cardPrefs.resetMine}
      />
      {onToggleExpanded && (
        <button
          type="button"
          onClick={onToggleExpanded}
          title={expanded ? "Exit full screen (Esc)" : "Full screen"}
          className="flex items-center gap-1.5 rounded-lg border border-sand bg-white px-2 py-1 text-[11px] text-espresso outline-none transition-colors hover:border-walnut"
        >
          <svg className="h-3 w-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            {expanded ? (
              <path d="M9 3v6H3M15 3v6h6M9 21v-6H3M15 21v-6h6" />
            ) : (
              <path d="M3 9V3h6M21 9V3h-6M3 15v6h6M21 15v6h-6" />
            )}
          </svg>
          {expanded ? "Exit full screen" : "Full screen"}
        </button>
      )}
    </div>
    <div className="flex gap-4 items-start">
      {/* ── Subtasks reference list — collapsed by default, see referenceListOpen ── */}
      <div className={`shrink-0 space-y-2 ${referenceListOpen ? "w-56" : ""}`}>
        <button
          type="button"
          onClick={() => setReferenceListOpen((v) => !v)}
          className="flex items-center gap-1.5 cursor-pointer"
        >
          <span className="text-bark text-[9px] w-2 shrink-0">{referenceListOpen ? "▼" : "▶"}</span>
          <p className="text-[10px] font-semibold text-walnut tracking-wide uppercase">
            Subtasks{!referenceListOpen && boardSubtasks.length > 0 ? ` (${boardSubtasks.length})` : ""}
          </p>
        </button>
        {referenceListOpen && (
          <div className="space-y-1.5 max-h-64 overflow-y-auto pr-1">
            {boardSubtasks.length === 0 && hiddenCount === 0 && (
              <p className="text-[11px] text-stone/70">No subtasks yet.</p>
            )}
            {hiddenCount > 0 && (
              <p className="text-[11px] text-stone/70">
                {hiddenCount} hidden (paid/cancelled) — see List View
              </p>
            )}
            {boardSubtasks.map((sub) => (
              <button
                key={sub.id}
                onClick={() => onOpenEdit(sub)}
                className={`flex flex-col gap-1 w-full text-left py-2 px-2.5 rounded-lg border border-sand bg-white hover:bg-cream transition-colors cursor-pointer ${
                  editingSubId === sub.id ? "bg-parchment" : ""
                }`}
              >
                <span className="text-[12px] font-semibold text-espresso leading-tight truncate">
                  {cardTitle(sub)}
                </span>
                <StatusBadge status={shownStatus(sub)} paidManually={sub.paid_manually ?? false} />
              </button>
            ))}
          </div>
        )}
      </div>

      {/* ── Kanban columns ───────────────────────────────────────────────────── */}
      <div className="flex-1 min-w-0 overflow-x-auto">
        <div className="flex gap-3 min-w-max">
          {BOARD_COLUMNS.map((col) => {
            const colSubtasks = subtasksByColumn.get(col.key) ?? [];
            const total = colSubtasks.length;
            const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE));
            const page = Math.min(pageByCol[col.key] ?? 0, pageCount - 1);
            const start = page * PAGE_SIZE;
            const pageSubtasks = colSubtasks.slice(start, start + PAGE_SIZE);
            const setPage = (next: number) =>
              setPageByCol((prev) => ({ ...prev, [col.key]: Math.max(0, Math.min(next, pageCount - 1)) }));
            const isDropTarget = canComplete && col.key === DRAG_TO_COLUMN;
            return (
              <div
                key={col.key}
                onDragOver={isDropTarget ? (e) => { e.preventDefault(); setOverCol(col.key); } : undefined}
                onDragLeave={isDropTarget ? () => setOverCol((c) => (c === col.key ? null : c)) : undefined}
                onDrop={isDropTarget ? (e) => {
                  e.preventDefault();
                  if (dragging) onMoveStatus?.(dragging.id, col.dropStatus);
                  setDragging(null);
                  setOverCol(null);
                } : undefined}
                className={`w-64 shrink-0 rounded-xl border p-2.5 space-y-2 transition-colors ${
                  isDropTarget && overCol === col.key
                    ? "border-sage bg-sage-soft ring-2 ring-sage"
                    : isDropTarget
                      ? "border-sage/50 bg-parchment"
                      : "border-sand bg-parchment"
                }`}
              >
                <div className="flex items-center justify-between px-0.5">
                  <p className={`text-[11px] font-semibold tracking-wide uppercase ${COLUMN_ACCENT_TEXT[col.key] ?? "text-walnut"}`}>
                    {col.label}
                  </p>
                  <span className="text-[10px] font-semibold px-2 py-[2px] rounded-full bg-stone/10 text-stone border border-stone/20">
                    {total}
                  </span>
                </div>

                <div className="space-y-1.5 min-h-[40px]">
                  {total === 0 && (
                    <p className="text-[11px] text-stone/60 italic px-1 py-2">Nothing here</p>
                  )}
                  {pageSubtasks.map((sub) => {
                    // The status the card is shown under, not the raw task row:
                    // a reviewer's approval often lands on the assignee row only,
                    // so a card sitting in Approved used to refuse to drag.
                    const isDraggable = Boolean(onMoveStatus) && shownStatus(sub) === DRAG_FROM_STATUS;
                    return (
                    <div
                      key={sub.id}
                      draggable={isDraggable}
                      onDragStart={isDraggable ? (e) => { e.dataTransfer.effectAllowed = "move"; setDragging({ id: sub.id, status: shownStatus(sub) }); } : undefined}
                      onDragEnd={isDraggable ? () => { setDragging(null); setOverCol(null); } : undefined}
                      onClick={() => onOpenEdit(sub)}
                      title={isDraggable ? "Drag to Completed to finish this task" : undefined}
                      className={`flex flex-col gap-1.5 py-2.5 px-3 rounded-lg border border-sand bg-white hover:bg-cream transition-colors ${isDraggable ? "cursor-grab active:cursor-grabbing" : "cursor-pointer"}`}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <span className="text-[13px] font-semibold text-espresso leading-tight line-clamp-3 whitespace-pre-wrap">
                          {cardTitle(sub)}
                        </span>
                        {shows("status") && (
                          <StatusBadge status={shownStatus(sub)} paidManually={sub.paid_manually ?? false} />
                        )}
                      </div>
                      {/* The task name is its own line only when something else
                          is leading the card — never printed twice. */}
                      {shows("task") && cardTitle(sub) !== sub.task_name && (
                        <div className="text-[11px] font-semibold text-walnut">{sub.task_name}</div>
                      )}
                      {shows("assignees") && (() => {
                        const names = assigneeNames(sub.assigned_task_assignees, activeProfiles);
                        return names && <div className="text-[11px] text-stone/80">{names}</div>;
                      })()}
                      {shows("client_detail") && titleDef.value !== "client_detail" && sub.task_detail?.trim() && (
                        <div className="text-[11px] text-walnut line-clamp-2 whitespace-pre-wrap">{sub.task_detail}</div>
                      )}
                      {shows("notes") && titleDef.value !== "notes" && sub.task_notes?.trim() && (
                        <div className="text-[11px] text-stone/80 italic line-clamp-2 whitespace-pre-wrap">{sub.task_notes}</div>
                      )}
                      {(() => {
                        // Account AND project/category, like the list view shows both —
                        // each switchable now, and skipped when it's already the title.
                        const place = [
                          shows("account") && titleDef.value !== "account" ? sub.account : null,
                          shows("project") && titleDef.value !== "project" ? sub.project ?? sub.category : null,
                        ].filter(Boolean).join(" · ");
                        // Countdown only while the task is still open — once it's
                        // approved/completed, days left or late stop meaning anything.
                        const days =
                          shows("due_countdown") && sub.due_date && !RESOLVED_STATUSES.has(shownStatus(sub))
                            ? daysUntil(sub.due_date, today)
                            : null;
                        const showDue = shows("due_date") && sub.due_date;
                        if (!place && !showDue && days == null) return null;
                        return (
                          <div className="flex items-start justify-between gap-2 text-[11px] text-stone/80">
                            <span>{place}</span>
                            {(showDue || days != null) && (
                              <span className="flex shrink-0 flex-col items-end text-right">
                                {showDue && (
                                  <span className={isOverdue(sub, today) ? "font-semibold text-terracotta" : undefined}>
                                    Due: {formatDate(sub.due_date)}
                                  </span>
                                )}
                                {days != null && (
                                  <span
                                    className={
                                      days < 0
                                        ? "font-semibold text-terracotta"
                                        : days === 0
                                          ? "font-semibold text-amber"
                                          : "text-stone"
                                    }
                                  >
                                    {days < 0
                                      ? `${-days} day${days === -1 ? "" : "s"} overdue`
                                      : days === 0
                                        ? "Due today"
                                        : `${days} day${days === 1 ? "" : "s"} left`}
                                  </span>
                                )}
                              </span>
                            )}
                          </div>
                        );
                      })()}
                    </div>
                    );
                  })}
                </div>

                {total > PAGE_SIZE && (
                  <div className="flex items-center justify-between gap-2 pt-1 text-[10px] text-bark">
                    <button
                      type="button"
                      onClick={() => setPage(page - 1)}
                      disabled={page === 0}
                      className="px-2 py-0.5 rounded font-semibold hover:text-espresso disabled:opacity-40 disabled:hover:text-bark"
                    >
                      ‹ Prev
                    </button>
                    <span>{start + 1}–{Math.min(start + PAGE_SIZE, total)} of {total}</span>
                    <button
                      type="button"
                      onClick={() => setPage(page + 1)}
                      disabled={page >= pageCount - 1}
                      className="px-2 py-0.5 rounded font-semibold hover:text-espresso disabled:opacity-40 disabled:hover:text-bark"
                    >
                      Next ›
                    </button>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
    </div>
  );
}

/**
 * Same Fields dropdown as the Submissions page's CardFieldsPicker — Title plus
 * "Also show" checkboxes — with a choice of who it applies to: just this
 * person, or (admins only) everyone who hasn't picked their own.
 */
function BoardCardPicker({
  prefs,
  sitewidePrefs,
  hasPersonal,
  canSetSitewide,
  onUpdate,
  onResetMine,
}: {
  prefs: CardPrefs;
  sitewidePrefs: CardPrefs;
  hasPersonal: boolean;
  canSetSitewide: boolean;
  onUpdate: (patch: Partial<CardPrefs>, scope: "mine" | "sitewide") => void;
  onResetMine: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [scope, setScope] = useState<"mine" | "sitewide">("mine");
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onClickOutside(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onClickOutside);
    return () => document.removeEventListener("mousedown", onClickOutside);
  }, [open]);

  // While editing the sitewide default, the controls show that default rather
  // than whatever this admin happens to be looking at.
  const editing = scope === "sitewide" ? sitewidePrefs : prefs;
  const toggle = (key: string) => {
    const hidden = editing.hidden.includes(key)
      ? editing.hidden.filter((h) => h !== key)
      : [...editing.hidden, key];
    onUpdate({ hidden }, scope);
  };
  const shown = CARD_FIELDS.length - CARD_FIELDS.filter((f) => prefs.hidden.includes(f.key)).length;

  return (
    <div className="relative inline-block" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-1.5 rounded-lg border border-sand bg-white px-2 py-1 text-[11px] text-espresso outline-none transition-colors hover:border-walnut"
      >
        <svg className="h-3 w-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <rect x="3" y="3" width="7" height="18" rx="1" />
          <rect x="14" y="3" width="7" height="18" rx="1" />
        </svg>
        Fields
        <span className="rounded-full bg-terracotta px-1.5 py-px text-[10px] font-bold leading-none text-white">
          {shown}
        </span>
      </button>

      {open && (
        <div className="absolute right-0 top-9 z-30 w-60 rounded-lg border border-sand bg-white p-2 shadow-lg">
          {canSetSitewide && (
            <>
              <label className="mb-1 block text-[10px] font-bold uppercase tracking-wide text-walnut">
                Apply to
              </label>
              {([
                ["mine", "Just my view"],
                ["sitewide", "Everyone (sitewide)"],
              ] as const).map(([value, label]) => (
                <label
                  key={value}
                  className="flex cursor-pointer items-center gap-2 rounded px-1 py-1 text-[12px] text-espresso hover:bg-parchment"
                >
                  <input
                    type="radio"
                    name="board-card-scope"
                    checked={scope === value}
                    onChange={() => setScope(value)}
                    className="cursor-pointer accent-terracotta"
                  />
                  <span className="truncate">{label}</span>
                </label>
              ))}
              <div className="my-1 border-t border-parchment" />
            </>
          )}

          <label className="mb-1 block text-[10px] font-bold uppercase tracking-wide text-walnut">
            Title
          </label>
          <select
            value={editing.title}
            onChange={(e) => onUpdate({ title: e.target.value }, scope)}
            className="mb-2 w-full rounded-lg border border-sand bg-white px-2 py-1 text-[12px] text-espresso outline-none"
          >
            {TITLE_FIELDS.map((f) => (
              <option key={f.value} value={f.value}>
                {f.label}
              </option>
            ))}
          </select>

          <div className="my-1 border-t border-parchment" />
          <label className="mb-1 block text-[10px] font-bold uppercase tracking-wide text-walnut">
            Also show
          </label>
          {CARD_FIELDS.map((f) => (
            <label
              key={f.key}
              className="flex cursor-pointer items-center gap-2 rounded px-1 py-1 text-[12px] text-espresso hover:bg-parchment"
            >
              <input
                type="checkbox"
                checked={!editing.hidden.includes(f.key)}
                onChange={() => toggle(f.key)}
                className="cursor-pointer accent-terracotta"
              />
              <span className="truncate">{f.label}</span>
            </label>
          ))}

          {hasPersonal && scope === "mine" && (
            <>
              <div className="my-1 border-t border-parchment" />
              <button
                type="button"
                onClick={onResetMine}
                className="px-1 text-[11px] font-semibold text-bark hover:text-espresso"
              >
                Use the sitewide layout instead
              </button>
            </>
          )}
        </div>
      )}
    </div>
  );
}
