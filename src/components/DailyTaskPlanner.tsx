"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import { createClient } from "@/lib/supabase/client";
import type { PlannedTask, UserRole, Profile } from "@/types/database";

interface DailyTaskPlannerProps {
  userId: string;
  role: UserRole;
  onStartPlannedTask: (task: PlannedTask) => void;
  teamMembers?: Profile[];
  orgTimezone?: string;
}

const FALLBACK_ACCOUNTS = [
  "TAT Foundation",
  "WSB Awesome Team",
  "Virtual Concierge",
  "Colina Portrait",
  "SNAPS Sublimation",
  "Thess Personal",
  "Thess Base",
  "Right Path Agency",
  "Personal",
  "Quad Life",
  "TONIWSB",
];

function getDateInTimezone(tz: string): string {
  return new Date().toLocaleDateString("en-CA", { timeZone: tz });
}

function shiftDate(dateStr: string, days: number): string {
  // Use noon to avoid DST edge cases
  const d = new Date(dateStr + "T12:00:00");
  d.setDate(d.getDate() + days);
  return d.toLocaleDateString("en-CA");
}

function formatDateDisplay(dateStr: string, todayStr: string): string {
  if (dateStr === todayStr) return "Today";
  const d = new Date(dateStr + "T12:00:00");
  return d.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
}

export default function DailyTaskPlanner({
  userId,
  role,
  onStartPlannedTask,
  teamMembers = [],
  orgTimezone = "UTC",
}: DailyTaskPlannerProps) {
  const supabase = createClient();
  const [tasks, setTasks] = useState<PlannedTask[]>([]);
  const [accounts, setAccounts] = useState<string[]>(FALLBACK_ACCOUNTS);
  const [loading, setLoading] = useState(true);
  const [logDurations, setLogDurations] = useState<Record<number, number>>({});

  // Today in org timezone
  const todayStr = getDateInTimezone(orgTimezone);

  // Viewed date — defaults to today, navigable with ← → arrows
  const [viewDate, setViewDate] = useState<string>(todayStr);

  // Single task entry
  const [newTaskName, setNewTaskName] = useState("");
  const [newTaskAccount, setNewTaskAccount] = useState("");

  // Bulk entry mode
  const [bulkMode, setBulkMode] = useState(false);
  const [bulkText, setBulkText] = useState("");
  const [bulkAccount, setBulkAccount] = useState("");

  // Collapsed state
  const [collapsed, setCollapsed] = useState(false);

  // Yesterday's incomplete tasks not yet in today's plan (for carry-over button)
  const [yesterdayPending, setYesterdayPending] = useState<PlannedTask[]>([]);
  const [carryingOver, setCarryingOver] = useState(false);

  // Priority for new tasks
  const [newTaskPriority, setNewTaskPriority] = useState<"urgent" | "important" | "needed" | "">("");
  const [bulkPriority, setBulkPriority] = useState<"urgent" | "important" | "needed" | "">("");

  // Collapsed state per category section
  const [sectionCollapsed, setSectionCollapsed] = useState<Record<string, boolean>>({});

  // Admin: which VA to view
  const [viewUserId, setViewUserId] = useState(userId);

  // Re-sync viewDate when orgTimezone resolves (avoids showing UTC "today" briefly)
  useEffect(() => {
    setViewDate(getDateInTimezone(orgTimezone));
  }, [orgTimezone]);

  // Fetch accounts from DB
  const fetchAccounts = useCallback(async () => {
    try {
      const res = await fetch("/api/accounts");
      if (res.ok) {
        const data = await res.json();
        const activeAccounts = (data.accounts ?? [])
          .filter((a: { active: boolean }) => a.active)
          .map((a: { name: string }) => a.name);
        if (activeAccounts.length > 0) setAccounts(activeAccounts);
      }
    } catch {
      // Keep fallback accounts
    }
  }, []);

  // Fetch planned tasks for viewDate
  const fetchTasks = useCallback(async () => {
    setLoading(true);
    const targetUserId = role === "va" ? userId : viewUserId;

    let query = supabase
      .from("planned_tasks")
      .select("*")
      .eq("plan_date", viewDate)
      .order("sort_order", { ascending: true })
      .order("created_at", { ascending: true });

    // "ALL" shows all users' tasks, otherwise filter by selected user
    if (targetUserId !== "__all__") {
      query = query.eq("user_id", targetUserId);
    }

    const { data, error } = await query;

    if (!error && data) {
      const allTasks = data as PlannedTask[];

      // Check yesterday for incomplete tasks not already in today's plan
      // (used to populate the "Carry over from yesterday" button)
      if (viewDate === todayStr && targetUserId !== "__all__") {
        const yesterday = shiftDate(todayStr, -1);
        const { data: pastTasks } = await supabase
          .from("planned_tasks")
          .select("*")
          .eq("user_id", targetUserId)
          .eq("plan_date", yesterday)
          .eq("completed", false)
          .order("sort_order", { ascending: true });

        if (pastTasks && pastTasks.length > 0) {
          const todayNames = new Set(
            allTasks.map((t) => t.task_name.toLowerCase().trim())
          );
          const pending = (pastTasks as PlannedTask[]).filter(
            (t) => !todayNames.has(t.task_name.toLowerCase().trim())
          );
          setYesterdayPending(pending);
        } else {
          setYesterdayPending([]);
        }
      } else {
        setYesterdayPending([]);
      }

      setTasks(allTasks);
    }
    setLoading(false);
  }, [supabase, userId, viewUserId, role, viewDate, todayStr]);

  useEffect(() => {
    fetchAccounts();
  }, [fetchAccounts]);

  useEffect(() => {
    if (userId) fetchTasks();
  }, [userId, fetchTasks]);

  // Fetch durations for completed tasks that have linked time_logs
  useEffect(() => {
    const completedWithLogs = tasks.filter((t) => t.completed && t.log_id);
    if (completedWithLogs.length === 0) return;
    const logIds = completedWithLogs.map((t) => t.log_id!);
    const missing = logIds.filter((id) => !(id in logDurations));
    if (missing.length === 0) return;

    (async () => {
      const { data } = await supabase
        .from("time_logs")
        .select("id, duration_ms")
        .in("id", missing);
      if (data) {
        const newDurations: Record<number, number> = { ...logDurations };
        data.forEach((d: { id: number; duration_ms: number }) => {
          newDurations[d.id] = d.duration_ms;
        });
        setLogDurations(newDurations);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tasks]);

  // Add a single task
  const addTask = useCallback(async () => {
    if (!newTaskName.trim()) return;

    const { data, error } = await supabase
      .from("planned_tasks")
      .insert({
        user_id: role === "va" ? userId : viewUserId,
        task_name: newTaskName.trim(),
        account: newTaskAccount || null,
        plan_date: viewDate,
        sort_order: tasks.length,
        priority: newTaskPriority || null,
      })
      .select()
      .single();

    if (!error && data) {
      setTasks((prev) => [...prev, data as PlannedTask]);
      setNewTaskName("");
      setNewTaskAccount("");
      setNewTaskPriority("");
    }
  }, [supabase, userId, viewUserId, role, newTaskName, newTaskAccount, newTaskPriority, viewDate, tasks.length]);

  // Add tasks in bulk (one per line)
  const addBulkTasks = useCallback(async () => {
    const lines = bulkText
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line.length > 0);

    if (lines.length === 0) return;

    const inserts = lines.map((line, i) => ({
      user_id: role === "va" ? userId : viewUserId,
      task_name: line,
      account: bulkAccount || null,
      plan_date: viewDate,
      sort_order: tasks.length + i,
      priority: bulkPriority || null,
    }));

    const { data, error } = await supabase
      .from("planned_tasks")
      .insert(inserts)
      .select();

    if (!error && data) {
      setTasks((prev) => [...prev, ...(data as PlannedTask[])]);
      setBulkText("");
      setBulkAccount("");
      setBulkPriority("");
      setBulkMode(false);
    }
  }, [supabase, userId, viewUserId, role, bulkText, bulkAccount, bulkPriority, viewDate, tasks.length]);

  // Toggle completed
  const toggleCompleted = useCallback(
    async (taskId: number, completed: boolean) => {
      const { error } = await supabase
        .from("planned_tasks")
        .update({ completed, updated_at: new Date().toISOString() })
        .eq("id", taskId);

      if (!error) {
        setTasks((prev) =>
          prev.map((t) => (t.id === taskId ? { ...t, completed } : t))
        );
      }
    },
    [supabase]
  );

  // Delete a single task
  const deleteTask = useCallback(
    async (taskId: number) => {
      const { error } = await supabase
        .from("planned_tasks")
        .delete()
        .eq("id", taskId);

      if (!error) {
        setTasks((prev) => prev.filter((t) => t.id !== taskId));
      }
    },
    [supabase]
  );

  // Clear all tasks for the viewed date
  const clearDay = useCallback(async () => {
    if (!confirm(`Clear all tasks for ${formatDateDisplay(viewDate, todayStr)}?`)) return;
    const targetUserId = role === "va" ? userId : viewUserId;

    let query = supabase
      .from("planned_tasks")
      .delete()
      .eq("plan_date", viewDate);

    if (targetUserId !== "__all__") {
      query = query.eq("user_id", targetUserId);
    }

    const { error } = await query;
    if (!error) setTasks([]);
  }, [supabase, userId, viewUserId, role, viewDate, todayStr]);

  // Carry over yesterday's incomplete tasks into today's plan
  const carryOverFromYesterday = useCallback(async () => {
    if (yesterdayPending.length === 0) return;
    setCarryingOver(true);
    const targetUserId = role === "va" ? userId : viewUserId;
    const maxSortOrder =
      tasks.length > 0 ? Math.max(...tasks.map((t) => t.sort_order ?? 0)) : -1;

    const inserts = yesterdayPending.map((t, i) => ({
      user_id: targetUserId,
      task_name: t.task_name,
      account: t.account,
      plan_date: todayStr,
      sort_order: maxSortOrder + 1 + i,
      completed: false,
      priority: t.priority ?? null,
    }));

    const { data, error } = await supabase
      .from("planned_tasks")
      .insert(inserts)
      .select();

    if (!error && data) {
      // Mark the old tasks as completed on their original date so they're no longer pending
      const oldIds = yesterdayPending.map((t) => t.id);
      await supabase
        .from("planned_tasks")
        .update({ completed: true })
        .in("id", oldIds);

      setTasks((prev) => [...prev, ...(data as PlannedTask[])]);
      setYesterdayPending([]);
    }
    setCarryingOver(false);
  }, [supabase, userId, viewUserId, role, todayStr, yesterdayPending, tasks]);

  // Update account on an existing task
  const updateTaskAccount = useCallback(
    async (taskId: number, account: string) => {
      const { error } = await supabase
        .from("planned_tasks")
        .update({ account: account || null, updated_at: new Date().toISOString() })
        .eq("id", taskId);

      if (!error) {
        setTasks((prev) =>
          prev.map((t) => (t.id === taskId ? { ...t, account: account || null } : t))
        );
      }
    },
    [supabase]
  );

  // Update priority on an existing task
  const updateTaskPriority = useCallback(
    async (taskId: number, priority: "urgent" | "important" | "needed" | null) => {
      const { error } = await supabase
        .from("planned_tasks")
        .update({ priority, updated_at: new Date().toISOString() })
        .eq("id", taskId);

      if (!error) {
        setTasks((prev) =>
          prev.map((t) => (t.id === taskId ? { ...t, priority } : t))
        );
      }
    },
    [supabase]
  );

  // Start working on a planned task (triggers task entry form prefill)
  const handleStartTask = useCallback(
    (task: PlannedTask) => {
      onStartPlannedTask(task);
    },
    [onStartPlannedTask]
  );

  const pendingTasks = tasks.filter((t) => !t.completed);
  const completedTasks = tasks.filter((t) => t.completed);

  // Cycle through priorities on dot click: none → urgent → important → needed → none
  const cyclePriority = (current: "urgent" | "important" | "needed" | null): "urgent" | "important" | "needed" | null => {
    if (!current) return "urgent";
    if (current === "urgent") return "important";
    if (current === "important") return "needed";
    return null;
  };

  const vaOptions = role !== "va"
    ? teamMembers.filter((m) => m.role === "va" || m.id === userId)
    : [];

  // Name lookup for "All" view
  const nameMap = useMemo(() => {
    const map = new Map<string, string>();
    teamMembers.forEach((m) => map.set(m.id, m.full_name.split(" ")[0]));
    return map;
  }, [teamMembers]);
  const isViewAll = viewUserId === "__all__";

  const isToday = viewDate === todayStr;
  // Don't allow navigating forward past today
  const canGoForward = viewDate < todayStr;

  return (
    <div className="bg-white border border-sand rounded-xl">
      {/* Header */}
      <div className="py-4 px-5 border-b border-parchment flex items-center justify-between">
        <button
          onClick={() => setCollapsed(!collapsed)}
          className="flex items-center gap-2 cursor-pointer"
        >
          <svg
            width="12"
            height="12"
            viewBox="0 0 12 12"
            className={`text-bark transition-transform ${collapsed ? "" : "rotate-90"}`}
          >
            <path d="M4 2l4 4-4 4" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          <h3 className="text-sm font-bold text-espresso">
            {isToday ? "Today's Plan" : formatDateDisplay(viewDate, todayStr)}
          </h3>
        </button>
        <div className="flex items-center gap-2">
          {tasks.length > 0 && (
            <span className="text-[10px] font-semibold py-[2px] px-2 rounded-full bg-terracotta-soft text-terracotta">
              {pendingTasks.length} pending
            </span>
          )}
          {/* Date navigation arrows */}
          <div className="flex items-center gap-0.5">
            <button
              onClick={() => setViewDate((d) => shiftDate(d, -1))}
              className="p-1 rounded text-stone hover:text-terracotta hover:bg-terracotta-soft cursor-pointer transition-colors"
              title="Previous day"
            >
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="15 18 9 12 15 6" />
              </svg>
            </button>
            {!isToday && (
              <button
                onClick={() => setViewDate(todayStr)}
                className="text-[10px] font-semibold text-terracotta hover:text-[#a85840] cursor-pointer px-1"
                title="Jump to today"
              >
                Today
              </button>
            )}
            <button
              onClick={() => setViewDate((d) => shiftDate(d, 1))}
              disabled={!canGoForward}
              className="p-1 rounded text-stone hover:text-terracotta hover:bg-terracotta-soft cursor-pointer transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
              title="Next day"
            >
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="9 18 15 12 9 6" />
              </svg>
            </button>
          </div>
          {!collapsed && (
            <button
              onClick={() => setBulkMode(!bulkMode)}
              className="text-[10px] font-semibold text-terracotta hover:text-[#a85840] cursor-pointer"
            >
              {bulkMode ? "Single" : "Bulk"}
            </button>
          )}
        </div>
      </div>

      {/* Carry-over banner — only shows when viewing today and there are pending tasks from yesterday */}
      {!collapsed && isToday && yesterdayPending.length > 0 && (
        <div className="px-5 py-2.5 border-b border-parchment bg-cream flex items-center justify-between">
          <span className="text-[11px] text-bark">
            {yesterdayPending.length} unfinished {yesterdayPending.length === 1 ? "task" : "tasks"} from yesterday
          </span>
          <button
            onClick={carryOverFromYesterday}
            disabled={carryingOver}
            className="text-[11px] font-semibold text-terracotta hover:text-[#a85840] cursor-pointer transition-colors disabled:opacity-50 flex items-center gap-1"
          >
            ↩ {carryingOver ? "Adding..." : `Carry over (${yesterdayPending.length})`}
          </button>
        </div>
      )}

      {!collapsed && (
        <div className="p-[18px_20px]">
          {/* Admin: VA selector */}
          {role !== "va" && vaOptions.length > 0 && (
            <div className="mb-3">
              <label className="block text-[11px] font-semibold text-walnut mb-[5px] tracking-wide">
                View Plan For
              </label>
              <select
                value={viewUserId}
                onChange={(e) => setViewUserId(e.target.value)}
                className="w-full py-2 px-3 border border-sand rounded-lg text-[12px] text-ink bg-white outline-none transition-all focus:border-terracotta focus:shadow-[0_0_0_3px_rgba(194,105,79,0.08)]"
              >
                <option value="__all__">All Team Members</option>
                {vaOptions.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.full_name} {m.id === userId ? "(you)" : ""}
                  </option>
                ))}
              </select>
            </div>
          )}

          {/* Bulk Entry Mode */}
          {bulkMode ? (
            <div className="mb-3">
              <label className="block text-[11px] font-semibold text-walnut mb-[5px] tracking-wide">
                Bulk Add Tasks <span className="text-stone font-normal">(one per line)</span>
              </label>
              <textarea
                value={bulkText}
                onChange={(e) => setBulkText(e.target.value)}
                placeholder={"Check emails\nUpdate social media posts\nPrepare weekly report\nClient follow-up calls"}
                rows={5}
                className="w-full py-2.5 px-[13px] border border-sand rounded-lg text-[13px] text-ink bg-white outline-none transition-all focus:border-terracotta focus:shadow-[0_0_0_3px_rgba(194,105,79,0.08)] placeholder:text-stone resize-none"
              />
              <div className="mt-2">
                <label className="block text-[11px] font-semibold text-walnut mb-[5px] tracking-wide">
                  Account <span className="text-stone font-normal">(applied to all)</span>
                </label>
                <select
                  value={bulkAccount}
                  onChange={(e) => setBulkAccount(e.target.value)}
                  className="w-full py-2 px-3 border border-sand rounded-lg text-[12px] text-ink bg-white outline-none transition-all focus:border-terracotta focus:shadow-[0_0_0_3px_rgba(194,105,79,0.08)]"
                >
                  <option value="">No account</option>
                  {accounts.map((a) => (
                    <option key={a} value={a}>{a}</option>
                  ))}
                </select>
              </div>
              <div className="mt-2">
                <label className="block text-[11px] font-semibold text-walnut mb-[5px] tracking-wide">
                  Priority <span className="text-stone font-normal">(applied to all)</span>
                </label>
                <div className="flex gap-1.5">
                  {(["urgent", "important", "needed"] as const).map((p) => {
                    const isActive = bulkPriority === p;
                    const styles = {
                      urgent:    { active: "bg-terracotta text-white", inactive: "bg-terracotta/10 text-terracotta border border-terracotta/25" },
                      important: { active: "bg-amber-400 text-white",  inactive: "bg-amber-50 text-amber-500 border border-amber-200"          },
                      needed:    { active: "bg-sage text-white",       inactive: "bg-sage/10 text-sage border border-sage/25"                  },
                    };
                    return (
                      <button
                        key={p}
                        type="button"
                        onClick={() => setBulkPriority(bulkPriority === p ? "" : p)}
                        className={`flex-1 py-1.5 rounded text-[11px] font-semibold capitalize cursor-pointer transition-all ${
                          isActive ? styles[p].active : styles[p].inactive
                        }`}
                      >
                        {p.charAt(0).toUpperCase() + p.slice(1)}
                      </button>
                    );
                  })}
                </div>
              </div>
              <div className="flex gap-2 mt-3">
                <button
                  onClick={() => { setBulkMode(false); setBulkText(""); setBulkAccount(""); }}
                  className="flex-1 py-2 rounded-lg bg-parchment text-walnut border border-sand text-[12px] font-semibold cursor-pointer transition-all hover:bg-sand hover:text-espresso"
                >
                  Cancel
                </button>
                <button
                  onClick={addBulkTasks}
                  disabled={!bulkText.trim()}
                  className="flex-1 py-2 rounded-lg bg-terracotta text-white text-[12px] font-semibold cursor-pointer transition-all hover:bg-[#a85840] disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  Add {bulkText.split("\n").filter((l) => l.trim()).length || 0} Tasks
                </button>
              </div>
            </div>
          ) : (
            /* Single Task Entry */
            <div className="mb-3">
              <div className="flex gap-2 mb-2">
                <input
                  type="text"
                  value={newTaskName}
                  onChange={(e) => setNewTaskName(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && newTaskName.trim()) {
                      addTask();
                    }
                  }}
                  placeholder="Add a task..."
                  className="flex-1 py-2 px-3 border border-sand rounded-lg text-[12px] text-ink bg-white outline-none transition-all focus:border-terracotta focus:shadow-[0_0_0_3px_rgba(194,105,79,0.08)] placeholder:text-stone"
                />
                <button
                  onClick={addTask}
                  disabled={!newTaskName.trim()}
                  className="py-2 px-3 rounded-lg bg-terracotta text-white text-[12px] font-semibold cursor-pointer transition-all hover:bg-[#a85840] disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  +
                </button>
              </div>
              <select
                value={newTaskAccount}
                onChange={(e) => setNewTaskAccount(e.target.value)}
                className="w-full py-1.5 px-3 border border-sand rounded-lg text-[11px] text-bark bg-white outline-none transition-all focus:border-terracotta focus:shadow-[0_0_0_3px_rgba(194,105,79,0.08)]"
              >
                <option value="">No account</option>
                {accounts.map((a) => (
                  <option key={a} value={a}>{a}</option>
                ))}
              </select>
              {/* Priority pills — always colored so it's obvious what they do */}
              <div className="flex gap-1.5 mt-2">
                {(["urgent", "important", "needed"] as const).map((p) => {
                  const isActive = newTaskPriority === p;
                  const styles = {
                    urgent:    { active: "bg-terracotta text-white", inactive: "bg-terracotta/10 text-terracotta border border-terracotta/25" },
                    important: { active: "bg-amber-400 text-white",  inactive: "bg-amber-50 text-amber-500 border border-amber-200"          },
                    needed:    { active: "bg-sage text-white",       inactive: "bg-sage/10 text-sage border border-sage/25"                  },
                  };
                  return (
                    <button
                      key={p}
                      type="button"
                      onClick={() => setNewTaskPriority(newTaskPriority === p ? "" : p)}
                      className={`flex-1 py-1 rounded text-[10px] font-semibold capitalize cursor-pointer transition-all ${
                        isActive ? styles[p].active : styles[p].inactive
                      }`}
                    >
                      {p.charAt(0).toUpperCase() + p.slice(1)}
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {/* Task List */}
          {loading ? (
            <div className="py-4 text-center">
              <div className="animate-pulse h-4 w-32 bg-parchment rounded mx-auto" />
            </div>
          ) : tasks.length === 0 ? (
            <p className="text-xs text-stone py-3 text-center">
              {isToday
                ? "No tasks planned for today yet."
                : `No tasks for ${formatDateDisplay(viewDate, todayStr)}.`}
            </p>
          ) : (
            <div>
              {/* Pending tasks grouped by priority */}
              {pendingTasks.length > 0 && (
                <div className="space-y-0.5">
                  {(
                    [
                      { key: "urgent",    label: "Urgent",    dot: "bg-terracotta",  text: "text-terracotta" },
                      { key: "important", label: "Important", dot: "bg-amber-400",   text: "text-amber-500"  },
                      { key: "needed",    label: "Needed",    dot: "bg-sage",        text: "text-sage"       },
                      { key: "other",     label: "Other",     dot: "bg-stone/40",    text: "text-stone"      },
                    ] as const
                  ).map(({ key, label, dot, text }) => {
                    const group = pendingTasks.filter((t) =>
                      key === "other" ? !t.priority : t.priority === key
                    );
                    if (group.length === 0) return null;
                    const isCollapsed = !!sectionCollapsed[key];
                    return (
                      <div key={key}>
                        {/* Category header */}
                        <button
                          onClick={() =>
                            setSectionCollapsed((prev) => ({ ...prev, [key]: !prev[key] }))
                          }
                          className="w-full flex items-center gap-1.5 px-2 py-1 rounded hover:bg-cream cursor-pointer transition-colors"
                        >
                          <svg
                            width="10" height="10" viewBox="0 0 12 12"
                            className={`text-stone/60 flex-shrink-0 transition-transform ${isCollapsed ? "" : "rotate-90"}`}
                          >
                            <path d="M4 2l4 4-4 4" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                          </svg>
                          <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${dot}`} />
                          <span className={`text-[10px] font-bold uppercase tracking-wider ${text}`}>{label}</span>
                          <span className="text-[10px] text-stone ml-auto">{group.length}</span>
                        </button>

                        {/* Tasks in this category */}
                        {!isCollapsed && (
                          <div className="space-y-0.5 mb-1">
                            {group.map((task) => (
                              <div
                                key={task.id}
                                className="group flex items-start gap-2 py-2 px-2 rounded-lg hover:bg-cream transition-colors"
                              >
                                <button
                                  onClick={() => toggleCompleted(task.id, true)}
                                  className="mt-0.5 w-[16px] h-[16px] rounded border border-sand flex-shrink-0 flex items-center justify-center cursor-pointer hover:border-terracotta transition-colors"
                                >
                                  {/* Empty checkbox */}
                                </button>
                                {/* Colored dot — click to cycle priority */}
                                <button
                                  onClick={() => updateTaskPriority(task.id, cyclePriority(task.priority ?? null))}
                                  title={task.priority ? `${task.priority} — click to change` : "No priority — click to set"}
                                  className="mt-[3px] flex-shrink-0 cursor-pointer rounded-full transition-transform hover:scale-125"
                                >
                                  <span className={`w-2 h-2 rounded-full block ${
                                    task.priority === "urgent"    ? "bg-terracotta" :
                                    task.priority === "important" ? "bg-amber-400"  :
                                    task.priority === "needed"    ? "bg-sage"       :
                                    "bg-stone/25"
                                  }`} />
                                </button>
                                <div className="flex-1 min-w-0">
                                  <div className="text-[12px] text-espresso font-medium leading-tight">
                                    {isViewAll && (
                                      <span className="text-[9px] font-semibold text-terracotta bg-terracotta-soft px-1.5 py-[1px] rounded mr-1.5">
                                        {nameMap.get(task.user_id) || "?"}
                                      </span>
                                    )}
                                    {task.task_name}
                                  </div>
                                  {task.account ? (
                                    <div className="text-[10px] text-bark mt-0.5">{task.account}</div>
                                  ) : (
                                    <select
                                      value=""
                                      onChange={(e) => updateTaskAccount(task.id, e.target.value)}
                                      className="mt-0.5 text-[10px] text-stone bg-transparent border-none outline-none cursor-pointer p-0"
                                    >
                                      <option value="">+ assign account</option>
                                      {accounts.map((a) => (
                                        <option key={a} value={a}>{a}</option>
                                      ))}
                                    </select>
                                  )}
                                </div>
                                <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                                  <button
                                    onClick={() => handleStartTask(task)}
                                    title="Start this task"
                                    className="p-1 rounded text-sage hover:bg-sage-soft cursor-pointer transition-colors"
                                  >
                                    <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
                                      <polygon points="5,3 19,12 5,21" />
                                    </svg>
                                  </button>
                                  <button
                                    onClick={() => deleteTask(task.id)}
                                    title="Remove"
                                    className="p-1 rounded text-stone hover:text-terracotta hover:bg-terracotta-soft cursor-pointer transition-colors"
                                  >
                                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                      <path d="M18 6L6 18M6 6l12 12" />
                                    </svg>
                                  </button>
                                </div>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}

              {/* Done section */}
              {completedTasks.length > 0 && (
                <div className="mt-2 pt-2 border-t border-parchment">
                  <button
                    onClick={() =>
                      setSectionCollapsed((prev) => ({ ...prev, done: !prev.done }))
                    }
                    className="w-full flex items-center gap-1.5 px-2 py-1 rounded hover:bg-cream cursor-pointer transition-colors mb-0.5"
                  >
                    <svg
                      width="10" height="10" viewBox="0 0 12 12"
                      className={`text-stone/60 flex-shrink-0 transition-transform ${sectionCollapsed.done ? "" : "rotate-90"}`}
                    >
                      <path d="M4 2l4 4-4 4" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                    <span className="w-1.5 h-1.5 rounded-full flex-shrink-0 bg-sage" />
                    <span className="text-[10px] font-bold uppercase tracking-wider text-sage">Done</span>
                    <span className="text-[10px] text-stone ml-auto">{completedTasks.length}</span>
                  </button>
                  {!sectionCollapsed.done && (
                    <div className="space-y-0.5">
                      {completedTasks.map((task) => (
                        <div
                          key={task.id}
                          className="group flex items-center gap-2 py-1.5 px-2 rounded-lg hover:bg-cream transition-colors"
                        >
                          <button
                            onClick={() => toggleCompleted(task.id, false)}
                            className="w-[16px] h-[16px] rounded bg-sage border border-sage flex-shrink-0 flex items-center justify-center cursor-pointer hover:bg-sage/80 transition-colors"
                          >
                            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                              <polyline points="20 6 9 17 4 12" />
                            </svg>
                          </button>
                          <div className="flex-1 min-w-0">
                            <div className="text-[12px] text-stone line-through leading-tight">
                              {isViewAll && (
                                <span className="text-[9px] font-semibold text-stone/60 bg-parchment px-1.5 py-[1px] rounded mr-1.5 no-underline">
                                  {nameMap.get(task.user_id) || "?"}
                                </span>
                              )}
                              {task.task_name}
                            </div>
                            <div className="flex items-center gap-2 mt-0.5">
                              {task.account && (
                                <span className="text-[10px] text-stone/60">{task.account}</span>
                              )}
                              {task.log_id && logDurations[task.log_id] != null && logDurations[task.log_id] > 0 && (
                                <span className="text-[10px] font-semibold text-sage">
                                  {Math.round(logDurations[task.log_id] / 60000)}m
                                </span>
                              )}
                            </div>
                          </div>
                          <button
                            onClick={() => deleteTask(task.id)}
                            className="p-1 rounded text-stone opacity-0 group-hover:opacity-100 hover:text-terracotta cursor-pointer transition-all"
                          >
                            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                              <path d="M18 6L6 18M6 6l12 12" />
                            </svg>
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          {/* Summary + Clear button */}
          {tasks.length > 0 && (
            <div className="mt-3 pt-2 border-t border-parchment flex items-center justify-between text-[10px] text-bark">
              <span>{completedTasks.length}/{tasks.length} completed</span>
              <div className="flex items-center gap-3">
                {!isToday && (
                  <button
                    onClick={clearDay}
                    className="text-[10px] text-stone hover:text-terracotta cursor-pointer transition-colors"
                  >
                    Clear day
                  </button>
                )}
                <div className="w-20 h-1.5 bg-parchment rounded-full overflow-hidden">
                  <div
                    className="h-full bg-sage rounded-full transition-all"
                    style={{ width: `${tasks.length > 0 ? (completedTasks.length / tasks.length) * 100 : 0}%` }}
                  />
                </div>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
