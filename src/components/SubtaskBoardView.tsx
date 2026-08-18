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
  onStatusChange: (subtaskId: number, status: string) => void | Promise<void>;
  formatDate: (iso: string | null | undefined) => string;
  StatusBadge: React.ComponentType<{ status: string }>;
  activeProfiles: Pick<Profile, "id" | "full_name" | "username">[];
}

export default function SubtaskBoardView({
  subtasks,
  editingSubId,
  onOpenEdit,
  onStatusChange,
  formatDate,
  StatusBadge,
  activeProfiles,
}: SubtaskBoardViewProps) {
  const [dragSubId, setDragSubId] = useState<number | null>(null);
  const [dragOverCol, setDragOverCol] = useState<string | null>(null);

  // One pass over `subtasks` builds both the column grouping and the
  // reference list, so dragging (which re-renders this component on every
  // dragover via dragOverCol/dragSubId, unrelated to `subtasks` itself)
  // doesn't re-scan and re-call columnForStatus for every subtask twice.
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

  const handleDrop = (colKey: string) => {
    setDragOverCol(null);
    if (dragSubId == null) return;
    const col = BOARD_COLUMNS.find((c) => c.key === colKey);
    const sub = subtasks.find((s) => s.id === dragSubId);
    // Compare by the card's current COLUMN, not its literal status, so
    // releasing a card back inside the column it's already in (e.g. an
    // on_queue or unassigned card dropped anywhere in Pending, which holds
    // three different statuses under one dropStatus) doesn't silently
    // rewrite its status just because it isn't byte-identical to dropStatus.
    const sourceCol = sub ? columnForStatus(sub.status) : undefined;
    if (!col || !sub || sourceCol?.key === col.key) {
      setDragSubId(null);
      return;
    }
    void onStatusChange(sub.id, col.dropStatus);
    setDragSubId(null);
  };

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
              <StatusBadge status={sub.status} />
            </button>
          ))}
        </div>
      </div>

      {/* ── Kanban columns ───────────────────────────────────────────────────── */}
      <div className="flex-1 min-w-0 overflow-x-auto">
        <div className="flex gap-3 min-w-max">
          {BOARD_COLUMNS.map((col) => {
            const colSubtasks = subtasksByColumn.get(col.key) ?? [];
            const isDragOver = dragOverCol === col.key;
            return (
              <div
                key={col.key}
                onDragOver={(e) => {
                  e.preventDefault();
                  if (dragOverCol !== col.key) setDragOverCol(col.key);
                }}
                onDragLeave={() => setDragOverCol((prev) => (prev === col.key ? null : prev))}
                onDrop={(e) => {
                  e.preventDefault();
                  handleDrop(col.key);
                }}
                className={`w-64 shrink-0 rounded-xl border bg-parchment p-2.5 space-y-2 transition-colors ${
                  isDragOver ? "border-terracotta" : "border-sand"
                }`}
              >
                <div className="flex items-center justify-between px-0.5">
                  <p className="text-[11px] font-semibold text-walnut tracking-wide uppercase">{col.label}</p>
                  <span className="text-[10px] font-semibold px-2 py-[2px] rounded-full bg-stone/10 text-stone border border-stone/20">
                    {colSubtasks.length}
                  </span>
                </div>

                <div className="space-y-1.5 min-h-[40px]">
                  {colSubtasks.map((sub) => (
                    <div
                      key={sub.id}
                      draggable
                      onDragStart={() => setDragSubId(sub.id)}
                      onDragEnd={() => { setDragSubId(null); setDragOverCol(null); }}
                      onClick={() => onOpenEdit(sub)}
                      className={`flex flex-col gap-1.5 py-2.5 px-3 rounded-lg border border-sand bg-white hover:bg-cream transition-colors cursor-grab active:cursor-grabbing ${
                        dragSubId === sub.id ? "opacity-50" : ""
                      }`}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <span className="text-[13px] font-semibold text-espresso leading-tight">
                          {sub.task_name}
                        </span>
                        <StatusBadge status={sub.status} />
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
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
