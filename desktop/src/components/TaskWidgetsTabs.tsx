// Log an Activity + Assigned Tasks in one tabbed card, same pattern as web's
// TaskWidgetsTabs (tab strip classes lifted directly). Budget and Limit
// isn't ported — desktop has no equivalent widget yet.
import { useState } from "react";
import LogActivityPanel from "./LogActivityPanel";
import TasksPanel from "./TasksPanel";
import type { VAAssignedTask } from "../lib/tasks";
import type { AdHocTaskInput, CloseOldTaskInput } from "../lib/clock";

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
  onSubmit: (task: VAAssignedTask) => void;
  onReorder: (source: VAAssignedTask, target: VAAssignedTask) => void;
  hasActiveTask: boolean;
  actionPending: boolean;
  onStartAdHoc: (input: AdHocTaskInput, closeOld?: CloseOldTaskInput) => void;
}

export default function TaskWidgetsTabs({
  tasks,
  loading,
  selectedId,
  onSelect,
  startingId,
  onStart,
  onSubmit,
  onReorder,
  hasActiveTask,
  actionPending,
  onStartAdHoc,
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
          <TasksPanel
            tasks={tasks}
            loading={loading}
            selectedId={selectedId}
            onSelect={onSelect}
            startingId={startingId}
            onStart={onStart}
            onSubmit={onSubmit}
            onReorder={onReorder}
            bare
          />
        )}
      </div>
    </div>
  );
}
