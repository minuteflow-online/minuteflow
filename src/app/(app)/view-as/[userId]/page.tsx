import { createClient as createAdminClient } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import Link from "next/link";
import type { Profile, Session, TimeLog, TaskScreenshot } from "@/types/database";

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

// ─── Helpers ───────────────────────────────────────────────

function formatDuration(ms: number): string {
  if (!ms || ms <= 0) return "0m";
  const totalMin = Math.floor(ms / 60000);
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  if (h > 0) return `${h}h ${m.toString().padStart(2, "0")}m`;
  return `${m}m`;
}

function formatTime(iso: string, timezone: string): string {
  return new Date(iso).toLocaleTimeString("en-US", {
    timeZone: timezone,
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });
}

function formatDateToday(timezone: string): string {
  return new Date().toLocaleDateString("en-US", {
    timeZone: timezone,
    weekday: "long",
    month: "long",
    day: "numeric",
  });
}

function getTodaySessionDate(timezone: string): string {
  return new Date().toLocaleDateString("en-CA", { timeZone: timezone }); // YYYY-MM-DD
}

function getTodayBounds(timezone: string): { start: string; end: string } {
  const today = getTodaySessionDate(timezone);
  const start = new Date(`${today}T00:00:00`);
  const end = new Date(`${today}T23:59:59.999`);
  // Adjust for timezone offset
  const startUTC = new Date(start.toLocaleString("en-US", { timeZone: "UTC" }));
  const tzStart = new Date(start.toLocaleString("en-US", { timeZone: timezone }));
  const offset = startUTC.getTime() - tzStart.getTime();
  return {
    start: new Date(start.getTime() + offset).toISOString(),
    end: new Date(end.getTime() + offset).toISOString(),
  };
}

function getAvatarColor(id: string): string {
  const colors = [
    "#8B7355", "#7C8B6E", "#B87333", "#6B8E9F", "#9E7B7B",
    "#7B9E87", "#8E8E6B", "#7B7B9E", "#9E8E7B", "#7B9E9E",
  ];
  let hash = 0;
  for (const ch of id) hash = (hash * 31 + ch.charCodeAt(0)) & 0xffffffff;
  return colors[Math.abs(hash) % colors.length];
}

function getInitials(name: string): string {
  return name.split(" ").map((w) => w[0]).join("").slice(0, 2).toUpperCase();
}

// ─── Page ──────────────────────────────────────────────────

export default async function ViewAsPage({
  params,
}: {
  params: Promise<{ userId: string }>;
}) {
  const { userId } = await params;

  // ── Verify admin ──
  const serverSupabase = await createClient();
  const {
    data: { user },
  } = await serverSupabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: adminProfile } = await serverSupabase
    .from("profiles")
    .select("role, full_name")
    .eq("id", user.id)
    .single();

  if (!adminProfile || adminProfile.role !== "admin") redirect("/dashboard");

  // ── Fetch VA data via service role ──
  const adminClient = createAdminClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  );

  // Get org timezone first
  const { data: orgSettings } = await adminClient
    .from("organization_settings")
    .select("timezone")
    .limit(1)
    .single();
  const timezone = orgSettings?.timezone || "UTC";

  const sessionDate = getTodaySessionDate(timezone);
  const { start: todayStart, end: todayEnd } = getTodayBounds(timezone);

  const [profileRes, sessionRes, logsRes, plannedRes, screenshotsRes] =
    await Promise.all([
      adminClient.from("profiles").select("*").eq("id", userId).single(),
      adminClient.from("sessions").select("*").eq("user_id", userId).maybeSingle(),
      adminClient
        .from("time_logs")
        .select("*")
        .eq("user_id", userId)
        .eq("session_date", sessionDate)
        .is("deleted_at", null)
        .order("start_time", { ascending: false }),
      adminClient
        .from("planned_tasks")
        .select("*")
        .eq("user_id", userId)
        .eq("plan_date", sessionDate)
        .order("sort_order"),
      adminClient
        .from("task_screenshots")
        .select("*")
        .eq("user_id", userId)
        .gte("created_at", todayStart)
        .lte("created_at", todayEnd)
        .order("created_at", { ascending: false })
        .limit(12),
    ]);

  const vaProfile = profileRes.data as Profile | null;
  if (!vaProfile) redirect("/team");

  const vaSession = sessionRes.data as Session | null;
  const timeLogs = (logsRes.data ?? []) as TimeLog[];
  const plannedTasks = (plannedRes.data ?? []) as PlannedTask[];
  const screenshots = (screenshotsRes.data ?? []) as TaskScreenshot[];

  // ── Compute session status ──
  const STALE_MS = 5 * 60 * 1000;
  const isStale =
    vaSession?.updated_at &&
    Date.now() - new Date(vaSession.updated_at).getTime() > STALE_MS;

  let status: "working" | "on-break" | "away" = "away";
  let currentTask: string | null = null;
  let currentMeta: string | null = null;

  if (!isStale && vaSession?.clocked_in && vaSession.active_task) {
    const task = vaSession.active_task;
    if (task.isBreak) {
      status = "on-break";
      currentTask = "On Break";
    } else {
      status = "working";
      currentTask = task.task_name || null;
      const parts = [task.account, task.client_name].filter(Boolean);
      currentMeta = parts.join(" · ") || null;
    }
  }

  // ── Stats ──
  const nonBreakLogs = timeLogs.filter((l) => l.category !== "Break");
  const totalMs = timeLogs.reduce((s, l) => s + (l.duration_ms || 0), 0);
  const taskCount = nonBreakLogs.length;

  const statusConfig = {
    working: { label: "Working", bg: "bg-green-100", text: "text-green-700" },
    "on-break": { label: "On Break", bg: "bg-amber-100", text: "text-amber-700" },
    away: { label: "Offline", bg: "bg-gray-100", text: "text-gray-500" },
  }[status];

  const avatarColor = getAvatarColor(vaProfile.id);

  return (
    <div className="min-h-screen bg-cream">
      {/* ── Admin Mode Banner ── */}
      <div className="sticky top-0 z-50 flex items-center justify-between bg-espresso px-5 py-2.5 text-white shadow-md">
        <div className="flex items-center gap-3">
          <span className="rounded-full bg-terracotta px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wider">
            Admin Mode
          </span>
          <span className="text-[13px] font-semibold">
            Viewing as {vaProfile.full_name}
          </span>
          <span className="text-[11px] text-white/60">
            — this is a read-only preview of their account
          </span>
        </div>
        <Link
          href="/team"
          className="rounded-lg bg-white/10 px-3 py-1.5 text-[12px] font-semibold hover:bg-white/20 transition-colors"
        >
          ← Back to Team
        </Link>
      </div>

      <div className="mx-auto max-w-5xl px-6 py-8">
        {/* ── VA Header ── */}
        <div className="mb-6 flex items-center gap-4">
          <div
            className="flex h-14 w-14 shrink-0 items-center justify-center rounded-full text-lg font-bold text-white"
            style={{ backgroundColor: avatarColor }}
          >
            {getInitials(vaProfile.full_name)}
          </div>
          <div className="flex-1">
            <h1 className="font-serif text-2xl font-bold text-espresso">
              {vaProfile.full_name}
            </h1>
            <p className="text-[13px] text-bark">
              {vaProfile.position || vaProfile.department || "Team Member"}
              {vaProfile.role !== "va" && (
                <span className="ml-2 text-terracotta font-semibold">
                  · {vaProfile.role}
                </span>
              )}
            </p>
          </div>
          <span
            className={`rounded-full px-3 py-1 text-[12px] font-semibold ${statusConfig.bg} ${statusConfig.text}`}
          >
            {statusConfig.label}
          </span>
        </div>

        {/* ── Current Task (if active) ── */}
        {status !== "away" && (
          <div className="mb-6 rounded-xl border border-sand bg-white p-5">
            <div className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-bark">
              Currently Working On
            </div>
            <div className="text-[16px] font-bold text-espresso">
              {currentTask || "—"}
            </div>
            {currentMeta && (
              <div className="mt-0.5 text-[12px] text-stone">{currentMeta}</div>
            )}
            {vaSession?.clock_in_time && (
              <div className="mt-2 text-[11px] text-bark">
                Clocked in at {formatTime(vaSession.clock_in_time, timezone)}
              </div>
            )}
          </div>
        )}

        {/* ── Stats Row ── */}
        <div className="mb-6 grid grid-cols-3 gap-4">
          <div className="rounded-xl border border-sand bg-white px-5 py-4 text-center">
            <div className="font-serif text-2xl font-bold text-espresso">
              {formatDuration(totalMs)}
            </div>
            <div className="mt-1 text-[11px] font-semibold text-bark">
              {formatDateToday(timezone)}
            </div>
          </div>
          <div className="rounded-xl border border-sand bg-white px-5 py-4 text-center">
            <div className="font-serif text-2xl font-bold text-espresso">
              {taskCount}
            </div>
            <div className="mt-1 text-[11px] font-semibold text-bark">Tasks Today</div>
          </div>
          <div className="rounded-xl border border-sand bg-white px-5 py-4 text-center">
            <div className="font-serif text-2xl font-bold text-espresso">
              {screenshots.length}
            </div>
            <div className="mt-1 text-[11px] font-semibold text-bark">
              Screenshots Today
            </div>
          </div>
        </div>

        <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
          {/* ── Today's Time Log ── */}
          <div className="rounded-xl border border-sand bg-white">
            <div className="border-b border-parchment px-5 py-4">
              <h2 className="text-sm font-bold text-espresso">
                Today&apos;s Time Log
              </h2>
              <p className="mt-0.5 text-[11px] text-bark">
                {timeLogs.length} entries
              </p>
            </div>
            <div className="divide-y divide-parchment max-h-[480px] overflow-y-auto">
              {timeLogs.length === 0 ? (
                <div className="px-5 py-6 text-center text-[13px] text-stone">
                  No entries logged today.
                </div>
              ) : (
                timeLogs.map((log) => {
                  const isActive = !log.end_time;
                  const duration =
                    log.duration_ms > 0
                      ? formatDuration(log.duration_ms)
                      : isActive
                      ? "active"
                      : "—";

                  const catColor =
                    log.category === "Break"
                      ? "bg-stone/60"
                      : log.category === "Personal"
                      ? "bg-clay-rose"
                      : log.category === "Sorting Tasks" ||
                        log.category === "Planning"
                      ? "bg-amber"
                      : "bg-sage";

                  return (
                    <div
                      key={log.id}
                      className={`flex items-start gap-3 px-5 py-3 ${
                        isActive ? "bg-sage-soft/30" : ""
                      }`}
                    >
                      <span
                        className={`mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full ${catColor}`}
                      />
                      <div className="flex-1 min-w-0">
                        <div className="text-[13px] font-semibold text-espresso truncate">
                          {log.task_name}
                        </div>
                        <div className="text-[11px] text-bark truncate">
                          {[log.account, log.category].filter(Boolean).join(" · ")}
                        </div>
                        {(log.client_memo || log.internal_memo) && (
                          <div className="mt-0.5 text-[10px] text-stone italic truncate">
                            {log.client_memo || log.internal_memo}
                          </div>
                        )}
                      </div>
                      <div className="text-right shrink-0">
                        <div
                          className={`text-[12px] font-semibold ${
                            isActive ? "text-sage" : "text-espresso"
                          }`}
                        >
                          {duration}
                        </div>
                        <div className="text-[10px] text-stone">
                          {formatTime(log.start_time, timezone)}
                        </div>
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </div>

          <div className="flex flex-col gap-6">
            {/* ── Today's Plan ── */}
            <div className="rounded-xl border border-sand bg-white">
              <div className="border-b border-parchment px-5 py-4">
                <h2 className="text-sm font-bold text-espresso">
                  Today&apos;s Plan
                </h2>
                <p className="mt-0.5 text-[11px] text-bark">
                  {plannedTasks.filter((t) => t.completed).length} of{" "}
                  {plannedTasks.length} completed
                </p>
              </div>
              <div className="divide-y divide-parchment max-h-[220px] overflow-y-auto">
                {plannedTasks.length === 0 ? (
                  <div className="px-5 py-6 text-center text-[13px] text-stone">
                    No tasks planned for today.
                  </div>
                ) : (
                  plannedTasks.map((task) => (
                    <div
                      key={task.id}
                      className="flex items-center gap-3 px-5 py-3"
                    >
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
                            task.completed
                              ? "text-stone line-through"
                              : "text-espresso"
                          }`}
                        >
                          {task.task_name}
                        </div>
                        {task.account && (
                          <div className="text-[11px] text-bark">{task.account}</div>
                        )}
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>

            {/* ── Screenshots ── */}
            <div className="rounded-xl border border-sand bg-white">
              <div className="border-b border-parchment px-5 py-4">
                <h2 className="text-sm font-bold text-espresso">
                  Screenshots Today
                </h2>
                <p className="mt-0.5 text-[11px] text-bark">
                  {screenshots.length} captured
                </p>
              </div>
              <div className="p-5">
                {screenshots.length === 0 ? (
                  <div className="text-center text-[13px] text-stone py-4">
                    No screenshots captured today.
                  </div>
                ) : (
                  <div className="grid grid-cols-3 gap-2">
                    {screenshots.map((s) => (
                      <a
                        key={s.id}
                        href={
                          s.drive_file_id
                            ? `https://drive.google.com/file/d/${s.drive_file_id}/view`
                            : "#"
                        }
                        target="_blank"
                        rel="noopener noreferrer"
                        className="group relative aspect-video overflow-hidden rounded-lg border border-sand bg-parchment hover:border-terracotta transition-colors"
                        title={s.filename || "Screenshot"}
                      >
                        {s.drive_file_id ? (
                          <img
                            src={`https://drive.google.com/thumbnail?id=${s.drive_file_id}&sz=w200`}
                            alt={s.filename || "Screenshot"}
                            className="h-full w-full object-cover"
                          />
                        ) : (
                          <div className="flex h-full w-full items-center justify-center text-[10px] text-stone">
                            No preview
                          </div>
                        )}
                        <div className="absolute inset-0 bg-black/0 group-hover:bg-black/10 transition-colors" />
                      </a>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
