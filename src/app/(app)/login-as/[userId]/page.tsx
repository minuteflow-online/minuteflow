import { createClient as createAdminClient } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import LoginAsClient from "./LoginAsClient";
import type { Profile, Session, TimeLog, TaskScreenshot } from "@/types/database";

// ─── Helpers ───────────────────────────────────────────────

function getTodaySessionDate(timezone: string): string {
  return new Date().toLocaleDateString("en-CA", { timeZone: timezone });
}

function getTodayBounds(timezone: string): { start: string; end: string } {
  const today = getTodaySessionDate(timezone);
  const start = new Date(`${today}T00:00:00`);
  const end = new Date(`${today}T23:59:59.999`);
  const startUTC = new Date(start.toLocaleString("en-US", { timeZone: "UTC" }));
  const tzStart = new Date(start.toLocaleString("en-US", { timeZone: timezone }));
  const offset = startUTC.getTime() - tzStart.getTime();
  return {
    start: new Date(start.getTime() + offset).toISOString(),
    end: new Date(end.getTime() + offset).toISOString(),
  };
}

// ─── Page ──────────────────────────────────────────────────

export default async function LoginAsPage({
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

  // Org timezone
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
      adminClient
        .from("sessions")
        .select("*")
        .eq("user_id", userId)
        .maybeSingle(),
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
        .order("created_at", { ascending: false }),
    ]);

  const vaProfile = profileRes.data as Profile | null;
  if (!vaProfile) redirect("/team");

  const vaSession = sessionRes.data as Session | null;
  const timeLogs = (logsRes.data ?? []) as TimeLog[];
  const plannedTasks = (plannedRes.data ?? []) as {
    id: number;
    user_id: string;
    task_name: string;
    account: string | null;
    plan_date: string;
    sort_order: number;
    completed: boolean;
    log_id: number | null;
  }[];
  const screenshots = (screenshotsRes.data ?? []) as TaskScreenshot[];

  return (
    <LoginAsClient
      vaProfile={vaProfile}
      vaSession={vaSession}
      timeLogs={timeLogs}
      plannedTasks={plannedTasks}
      screenshots={screenshots}
      timezone={timezone}
    />
  );
}
