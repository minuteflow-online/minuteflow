// Log an Activity + Assigned Tasks in one tabbed card, same pattern as web's
// TaskWidgetsTabs (tab strip classes lifted directly). Budget and Limit
// isn't ported — desktop has no equivalent widget yet.
import { useState } from "react";
import LogActivityPanel from "./LogActivityPanel";
import TasksPanel from "./TasksPanel";
import type { VAAssignedTask } from "../lib/tasks";
import type { AdHocTaskInput, CloseOldTaskInput } from "../lib/clock";
import type { TeamRosterMember } from "../lib/team";

type Tab = "log" | "assigned";

const TAB_LABELS: Record<Tab, string> = {
  log: "Log an Activity",
  assigned: "Assigned Tasks",
};

interface TaskWidgetsTabsProps {
  tasks: VAAssignedTask[];
  loading: boolean;
  selectedId: number | null;
  onSelect: (task: VAAssignedTask) => void;
  startingId: number | null;
  onStart: (task: VAAssignedTask) => void;
  /** For TasksPanel's Add Memo lookup. */
  userId: string;
  /** Real Stop (Phase 1/4, Toni's call, 2026-11-02) — see TasksPanel's own
   *  comment on why activeAssignedTaskId gates it rather than status alone. */
  stoppingId: number | null;
  onStop: (task: VAAssignedTask) => void;
  activeAssignedTaskId: number | null;
  onSubmit: (task: VAAssignedTask) => void;
  onReorder: (source: VAAssignedTask, target: VAAssignedTask) => void;
  hasActiveTask: boolean;
  actionPending: boolean;
  onStartAdHoc: (input: AdHocTaskInput, closeOld?: CloseOldTaskInput) => void;
  /** Admin's "View as VA" (Toni's call, 2026-11-13), ported from web's own
   *  TaskWidgetsTabs. State lives in App.tsx here rather than self-contained
   *  like web's, since picking a VA has to drive a separate fetch
   *  (fetchAssignedTasksForVa) that App.tsx owns — this component only
   *  renders the picker and the resulting read-only list it's handed. */
  isAdmin?: boolean;
  teamMembers?: TeamRosterMember[];
  viewAsVaId?: string | null;
  onViewAsVaChange?: (id: string | null) => void;
}

export default function TaskWidgetsTabs({
  tasks,
  loading,
  selectedId,
  onSelect,
  startingId,
  onStart,
  userId,
  stoppingId,
  onStop,
  activeAssignedTaskId,
  onSubmit,
  onReorder,
  hasActiveTask,
  actionPending,
  onStartAdHoc,
  isAdmin = false,
  teamMembers = [],
  viewAsVaId = null,
  onViewAsVaChange,
}: TaskWidgetsTabsProps) {
  const [activeTab, setActiveTab] = useState<Tab>("assigned");

  return (
    <div className="rounded-xl border border-sand bg-white flex-1 min-h-0 flex flex-col">
      <div className="flex border-b border-parchment shrink-0">
        {(["log", "assigned"] as Tab[]).map((tab) => (
          <button
            key={tab}
            type="button"
            onClick={() => setActiveTab(tab)}
            className={`flex-1 px-2 py-2.5 text-[11px] font-semibold uppercase tracking-wide transition-colors cursor-pointer ${
              activeTab === tab
                ? "text-terracotta border-b-2 border-terracotta bg-terracotta-soft/40"
                : "text-stone hover:text-espresso border-b-2 border-transparent"
            }`}
          >
            {TAB_LABELS[tab]}
          </button>
        ))}
      </div>

      <div className="p-3 flex-1 min-h-0 overflow-y-auto">
        {activeTab === "log" ? (
          <LogActivityPanel hasActiveTask={hasActiveTask} submitting={actionPending} onSubmit={onStartAdHoc} />
        ) : (
          <>
            {isAdmin && teamMembers.length > 0 && (
              <div className="mb-2 flex items-center gap-2">
                <span className="text-[11px] font-semibold text-stone whitespace-nowrap">View as VA:</span>
                <select
                  value={viewAsVaId ?? ""}
                  onChange={(e) => onViewAsVaChange?.(e.target.value || null)}
                  className="rounded-lg border border-sand px-2 py-1 text-[11px] text-espresso outline-none bg-white"
                >
                  <option value="">My View</option>
                  {teamMembers
                    .map((m) => m.profile)
                    .filter((p) => p.id !== userId)
                    .slice()
                    .sort((a, b) => (a.full_name ?? "").localeCompare(b.full_name ?? ""))
                    .map((p) => (
                      <option key={p.id} value={p.id}>{p.full_name}</option>
                    ))}
                </select>
              </div>
            )}
            <TasksPanel
              tasks={tasks}
              loading={loading}
              selectedId={selectedId}
              onSelect={onSelect}
              startingId={startingId}
              onStart={onStart}
              userId={userId}
              stoppingId={stoppingId}
              onStop={onStop}
              activeAssignedTaskId={activeAssignedTaskId}
              onSubmit={onSubmit}
              onReorder={onReorder}
              bare
              readOnly={Boolean(viewAsVaId)}
            />
          </>
        )}
      </div>
    </div>
  );
}
