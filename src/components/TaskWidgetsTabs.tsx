"use client";

// Merges Log a Task, Assigned Tasks, and Daily Budget into one tabbed card
// instead of three separate boxes stacked in the dashboard grid — each widget
// is rendered in "bare" mode (no card/header/collapse of its own) so this
// container is the only chrome. Assigned Tasks is the default tab.
import { useState } from "react";
import TaskEntryForm, { type TaskFormData } from "@/components/TaskEntryForm";
import AssignedTasksWidget from "@/components/AssignedTasksWidget";
import BudgetWidget from "@/components/BudgetWidget";
import type { VAAssignedTask, Profile } from "@/types/database";
import type { TaskTodo } from "@/lib/taskTodos";

type Tab = "log" | "assigned" | "budget";

interface TaskWidgetsTabsProps {
  userId: string;
  sessionState: string;
  hasActiveTask: boolean;
  onPlayAssignedTask: (task: VAAssignedTask) => void;
  onPlayTodo: (task: VAAssignedTask, todo: TaskTodo) => void;
  /** Stops whatever task is currently running — real Stop action (Phase 1, Toni's call, 2026-11-02). */
  onStopActiveTask?: () => void;
  /** Called when the task submitted was the one the VA is currently clocked into. */
  onActiveTaskSubmitted?: () => void;
  orgTimezone: string;
  isAdmin: boolean;
  refetchCount: number;
  activeAssignedTaskId: number | null;
  activeTodoLabel: string | null;
  assignedKey: string | number;
  claimRefreshKey: number;
  // Log a Task
  onStartTask: (data: TaskFormData) => void;
  role: string;
  activeTaskClientMemo: string;
  /** For the admin-only "View as VA" picker on the Assigned Tasks tab
   *  (Toni's call, 2026-11-11) — same pattern as the Assignment page's own. */
  teamMembers?: Profile[];
}

const TAB_LABELS: Record<Tab, string> = {
  log: "Log an Activity",
  assigned: "Assigned Tasks",
  budget: "Budget and Limit",
};

const TABS: Tab[] = ["log", "assigned", "budget"];

export default function TaskWidgetsTabs({
  userId,
  sessionState,
  hasActiveTask,
  onPlayAssignedTask,
  onPlayTodo,
  onStopActiveTask,
  onActiveTaskSubmitted,
  orgTimezone,
  isAdmin,
  refetchCount,
  activeAssignedTaskId,
  activeTodoLabel,
  assignedKey,
  claimRefreshKey,
  onStartTask,
  role,
  activeTaskClientMemo,
  teamMembers = [],
}: TaskWidgetsTabsProps) {
  const [activeTab, setActiveTab] = useState<Tab>("assigned");
  // Admin-only "View as VA" on the Assigned Tasks tab — null means "my own".
  const [viewAsVaId, setViewAsVaId] = useState<string | null>(null);

  return (
    <div className="rounded-xl border border-sand bg-white">
      <div className="flex border-b border-parchment">
        {TABS.map((tab) => (
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

      <div className="p-3">
        {activeTab === "log" && (
          <TaskEntryForm
            onStartTask={onStartTask}
            hasActiveTask={hasActiveTask}
            role={role}
            sessionState={sessionState as "idle" | "clocked-in" | "on-break"}
            activeTaskClientMemo={activeTaskClientMemo}
            bare
          />
        )}
        {activeTab === "assigned" && (
          <>
            {isAdmin && teamMembers.length > 0 && (
              <div className="mb-2 flex items-center gap-2">
                <span className="text-[11px] font-semibold text-stone whitespace-nowrap">View as VA:</span>
                <select
                  value={viewAsVaId ?? ""}
                  onChange={(e) => setViewAsVaId(e.target.value || null)}
                  className="rounded-lg border border-sand px-2 py-1 text-[11px] text-espresso outline-none bg-white"
                >
                  <option value="">My View</option>
                  {teamMembers
                    .filter((p) => p.id !== userId)
                    .slice()
                    .sort((a, b) => (a.full_name ?? "").localeCompare(b.full_name ?? ""))
                    .map((p) => (
                      <option key={p.id} value={p.id}>{p.full_name}</option>
                    ))}
                </select>
              </div>
            )}
            <AssignedTasksWidget
              key={`assigned-${assignedKey}-${viewAsVaId ?? "self"}`}
              userId={userId}
              sessionState={sessionState}
              hasActiveTask={hasActiveTask}
              onPlayAssignedTask={onPlayAssignedTask}
              onPlayTodo={onPlayTodo}
              onStopActiveTask={onStopActiveTask}
              onActiveTaskSubmitted={onActiveTaskSubmitted}
              orgTimezone={orgTimezone}
              isAdmin={isAdmin}
              refetchCount={refetchCount}
              activeAssignedTaskId={activeAssignedTaskId}
              activeTodoLabel={activeTodoLabel}
              viewAsVaId={viewAsVaId}
              bare
            />
          </>
        )}
        {activeTab === "budget" && <BudgetWidget currentUserId={userId} refreshKey={claimRefreshKey} bare />}
      </div>
    </div>
  );
}
