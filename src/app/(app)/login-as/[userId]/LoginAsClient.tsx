"use client";

import Link from "next/link";
import SessionBanner from "@/components/SessionBanner";
import TaskEntryForm from "@/components/TaskEntryForm";
import ProjectSidebar from "@/components/ProjectSidebar";
import ActivityLog from "@/components/ActivityLog";
import type { Profile, Session, TimeLog, TaskScreenshot } from "@/types/database";

// ─── Helpers ───────────────────────────────────────────────

function getGreeting(timezone?: string): string {
  const hourStr = new Date().toLocaleTimeString("en-US", {
    timeZone: timezone || "UTC",
    hour: "numeric",
    hour12: false,
  });
  const h = parseInt(hourStr, 10);
  if (h < 12) return "Good morning";
  if (h < 17) return "Good afternoon";
  return "Good evening";
}

function formatDateLong(timezone?: string): string {
  return new Date().toLocaleDateString("en-US", {
    timeZone: timezone || "UTC",
    weekday: "long",
    month: "long",
    day: "numeric",
  });
}

function formatHoursMinutes(ms: number): string {
  const totalMinutes = Math.floor(ms / 60000);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (hours > 0) return `${hours}h ${minutes.toString().padStart(2, "0")}m`;
  return `${minutes}m`;
}

function secondsSince(isoDate: string): number {
  return Math.max(0, Math.floor((Date.now() - new Date(isoDate).getTime()) / 1000));
}

// ─── Types ─────────────────────────────────────────────────

interface PlannedTask {
  id: number;
  user_id: string;
  task_name: string;
  account: string | null;
  plan_date: string;
  sort_order: number;
  completed: boolean;
  log_id: number | null;
}

interface LoginAsClientProps {
  vaProfile: Profile;
  vaSession: Session | null;
  timeLogs: TimeLog[];
  plannedTasks: PlannedTask[];
  screenshots: TaskScreenshot[];
  timezone: string;
}

// ─── Component ─────────────────────────────────────────────

export default function LoginAsClient({
  vaProfile,
  vaSession,
  timeLogs,
  plannedTasks,
  screenshots,
  timezone,
}: LoginAsClientProps) {
  const STALE_MS = 5 * 60 * 1000;
  const isStale =
    vaSession?.updated_at &&
    Date.now() - new Date(vaSession.updated_at).getTime() > STALE_MS;

  // Determine session state
  let sessionState: "idle" | "clocked-in" | "on-break" = "idle";
  if (!isStale && vaSession?.clocked_in && vaSession.active_task) {
    const task = vaSession.active_task as { isBreak?: boolean };
    sessionState = task.isBreak ? "on-break" : "clocked-in";
  }

  // Stats
  const firstName = vaProfile.full_name.split(" ")[0];
  const nonBreakLogs = timeLogs.filter((l) => l.category !== "Break");
  const totalMs = timeLogs.reduce((s, l) => s + (l.duration_ms || 0), 0);

  // Elapsed seconds for session banner timer
  const elapsedSeconds =
    sessionState !== "idle" && vaSession?.clock_in_time
      ? secondsSince(vaSession.clock_in_time)
      : 0;

  // Group screenshots by log_id for ActivityLog
  const screenshotsByLogId = screenshots.reduce<Record<number, TaskScreenshot[]>>(
    (acc, s) => {
      if (s.log_id) {
        acc[s.log_id] = [...(acc[s.log_id] ?? []), s];
      }
      return acc;
    },
    {}
  );

  return (
    <div className="min-h-screen bg-cream">
      {/* ── Admin Preview Banner ── */}
      <div className="sticky top-0 z-50 flex items-center justify-between bg-espresso px-5 py-2.5 text-white shadow-md">
        <div className="flex items-center gap-3 min-w-0">
          <span className="shrink-0 rounded-full bg-terracotta px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wider">
            Admin Preview
          </span>
          <span className="text-[13px] font-semibold truncate">
            Viewing as {vaProfile.full_name}
          </span>
          <span className="hidden sm:block text-[11px] text-white/60 shrink-0">
            — read-only · nothing saves
          </span>
        </div>
        <Link
          href="/team"
          className="shrink-0 ml-3 rounded-lg bg-white/10 px-3 py-1.5 text-[12px] font-semibold hover:bg-white/20 transition-colors"
        >
          ← Back to Team
        </Link>
      </div>

      {/* ── Main Layout ── */}
      <div className="px-6 py-6">
        {/* Greeting */}
        <div className="mb-7">
          <h1 className="font-serif text-[26px] font-normal text-espresso mb-1">
            {getGreeting(timezone)},{" "}
            <strong className="font-bold">{firstName}</strong>
          </h1>
          <p className="text-sm text-bark">
            {formatDateLong(timezone)} &mdash;{" "}
            {nonBreakLogs.length > 0
              ? `${nonBreakLogs.length} task${nonBreakLogs.length !== 1 ? "s" : ""} logged · ${formatHoursMinutes(totalMs)} tracked today`
              : "No tasks logged yet today"}
          </p>
        </div>

        {/* Session Banner — pointer-events-none so buttons are visible but unclickable */}
        <div className="pointer-events-none mb-4">
          <SessionBanner
            state={sessionState}
            clockInTime={vaSession?.clock_in_time ?? null}
            elapsedSeconds={elapsedSeconds}
            breakElapsedSeconds={0}
            timezone={timezone}
            actionPending={false}
            onClockOut={() => {}}
            onStartBreak={() => {}}
            onEndBreak={() => {}}
          />
        </div>

        {/* 4-column VA grid: Task Form | Daily Plan | Assignments (locked) | Quick Pick */}
        <div className="grid gap-5 mb-6 grid-cols-1 md:grid-cols-[1fr_260px_260px_260px]">
          {/* Task Entry Form — dropdowns live, submit disabled */}
          <TaskEntryForm
            onStartTask={() => {}}
            hasActiveTask={sessionState !== "idle"}
            role="va"
            sessionState={sessionState}
            previewMode={true}
          />

          {/* Daily Plan — from server-fetched VA data */}
          <div className="rounded-xl border border-sand bg-white">
            <div className="border-b border-parchment px-4 py-3">
              <p className="text-sm font-bold text-espresso">Today&apos;s Plan</p>
              <p className="text-[11px] text-bark mt-0.5">
                {plannedTasks.filter((t) => t.completed).length} of{" "}
                {plannedTasks.length} done
              </p>
            </div>
            <div className="divide-y divide-parchment max-h-[400px] overflow-y-auto">
              {plannedTasks.length === 0 ? (
                <div className="px-4 py-8 text-center text-[13px] text-stone">
                  No tasks planned for today.
                </div>
              ) : (
                plannedTasks.map((task) => (
                  <div key={task.id} className="flex items-center gap-3 px-4 py-3">
                    <span
                      className={`h-4 w-4 shrink-0 rounded border-2 flex items-center justify-center text-[9px] font-bold ${
                        task.completed
                          ? "border-sage bg-sage text-white"
                          : "border-sand bg-white text-transparent"
                      }`}
                    >
                      ✓
                    </span>
                    <div className="flex-1 min-w-0">
                      <div
                        className={`text-[13px] font-semibold truncate ${
                          task.completed ? "text-stone line-through" : "text-espresso"
                        }`}
                      >
                        {task.task_name}
                      </div>
                      {task.account && (
                        <div className="text-[11px] text-bark truncate">
                          {task.account}
                        </div>
                      )}
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>

          {/* My Assignments — locked in preview */}
          <div className="rounded-xl border border-sand bg-white/60 p-3 flex flex-col items-center justify-center text-center min-h-[120px]">
            <svg
              className="h-6 w-6 text-stone/40 mb-1.5"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
            >
              <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
              <path d="M7 11V7a5 5 0 0110 0v4" />
            </svg>
            <p className="text-[11px] text-stone font-medium">My Assignments</p>
            <p className="text-[10px] text-stone/60 mt-0.5">Locked in preview</p>
          </div>

          {/* Quick Pick Sidebar — loads live org data, buttons are no-ops */}
          <ProjectSidebar
            onSelectProject={() => {}}
            onQuickAction={() => {}}
            onAutoHoldAction={() => {}}
            isAdmin={false}
          />
        </div>

        {/* Activity Log — VA's actual today's logs */}
        <ActivityLog
          logs={timeLogs}
          screenshots={screenshotsByLogId}
          onAddScreenshot={() => {}}
          role="admin"
          currentUserId={vaProfile.id}
          profiles={[vaProfile]}
          onRefresh={() => {}}
          timezone={timezone}
        />
      </div>
    </div>
  );
}
