"use client";

// Board View for the Subtasks section (Part B, docs/objective-foundation-feature.md).
// Kanban columns + a persistent left-side reference list, both reading the same
// `subtasks` array passed in from VAProjectsTab — no separate data set.
//
// Column/status grouping lives entirely in src/lib/subtaskStatusColumns.ts — see
// that file for the still-open questions on revision_needed / on_queue / paid /
// cancelled placement.

import { useMemo, useState } from "react";
import { BOARD_COLUMNS, columnForStatus } from "@/lib/subtaskStatusColumns";
import { assigneeNames } from "@/lib/subtaskDisplay";
import type { Profile } from "@/types/database";
import type { SubtaskRow } from "@/components/VAProjectsTab";

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
}: SubtaskBoardViewProps) {
  // Per-column page index. The ONLY drag allowed is Approved → Completed (a card
  // approved by a reviewer is dragged to Completed, which persists everywhere);
  // every other status still moves through the dashboard flow, never by drag.
  const [pageByCol, setPageByCol] = useState<Record<string, number>>({});
  const [dragging, setDragging] = useState<{ id: number; status: string } | null>(null);
  const [overCol, setOverCol] = useState<string | null>(null);
  const canComplete = Boolean(onMoveStatus) && dragging?.status === DRAG_FROM_STATUS;

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
      const col = columnForStatus(sub.status);
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
    <div className="flex gap-4 items-start">
      {/* ── Persistent Subtasks reference list ──────────────────────────────── */}
      <div className="w-56 shrink-0 space-y-2">
        <p className="text-[10px] font-semibold text-walnut tracking-wide uppercase">Subtasks</p>
        <div className="space-y-1.5 max-h-[560px] overflow-y-auto pr-1">
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
                {sub.task_name}
              </span>
              <StatusBadge status={sub.status} paidManually={sub.paid_manually ?? false} />
            </button>
          ))}
        </div>
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
                  <p className="text-[11px] font-semibold text-walnut tracking-wide uppercase">{col.label}</p>
                  <span className="text-[10px] font-semibold px-2 py-[2px] rounded-full bg-stone/10 text-stone border border-stone/20">
                    {total}
                  </span>
                </div>

                <div className="space-y-1.5 min-h-[40px]">
                  {pageSubtasks.map((sub) => {
                    const isDraggable = Boolean(onMoveStatus) && sub.status === DRAG_FROM_STATUS;
                    return (
                    <div
                      key={sub.id}
                      draggable={isDraggable}
                      onDragStart={isDraggable ? (e) => { e.dataTransfer.effectAllowed = "move"; setDragging({ id: sub.id, status: sub.status }); } : undefined}
                      onDragEnd={isDraggable ? () => { setDragging(null); setOverCol(null); } : undefined}
                      onClick={() => onOpenEdit(sub)}
                      title={isDraggable ? "Drag to Completed to finish this task" : undefined}
                      className={`flex flex-col gap-1.5 py-2.5 px-3 rounded-lg border border-sand bg-white hover:bg-cream transition-colors ${isDraggable ? "cursor-grab active:cursor-grabbing" : "cursor-pointer"}`}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <span className="text-[13px] font-semibold text-espresso leading-tight">
                          {sub.task_name}
                        </span>
                        <StatusBadge status={sub.status} paidManually={sub.paid_manually ?? false} />
                      </div>
                      {(() => {
                        const names = assigneeNames(sub.assigned_task_assignees, activeProfiles);
                        return names && <div className="text-[11px] text-stone/80">{names}</div>;
                      })()}
                      <div className="flex items-center justify-between gap-2 text-[11px] text-stone/80">
                        {/* Account AND project/category, like the list view shows both —
                            not one OR the other, so this card can't show less than List View
                            does for the same subtask. */}
                        <span>{[sub.account, sub.project ?? sub.category].filter(Boolean).join(" · ")}</span>
                        {sub.due_date && <span>Due: {formatDate(sub.due_date)}</span>}
                      </div>
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
  );
}
