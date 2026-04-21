"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState, useCallback } from "react";
import { signOut } from "@/app/actions/auth";
import { createClient } from "@/lib/supabase/client";

type NavItem = {
  label: string;
  href: string;
};

const allNavItems: NavItem[] = [
  { label: "Dashboard", href: "/dashboard" },
  { label: "Time Log", href: "/timelog" },
  { label: "Team", href: "/team" },
  { label: "Reports", href: "/reports" },
];

import { getTimezoneAbbr } from "@/lib/utils";
import type { UserRole } from "@/types/database";

type TopNavProps = {
  user: {
    full_name: string;
    role: UserRole;
  };
};

function Clock() {
  const [time, setTime] = useState("");
  const [timezone, setTimezone] = useState<string>("UTC");
  const [tzAbbr, setTzAbbr] = useState("UTC");

  // Fetch org timezone on mount
  useEffect(() => {
    async function fetchTimezone() {
      const supabase = createClient();
      const { data } = await supabase
        .from("organization_settings")
        .select("timezone")
        .limit(1)
        .single();
      if (data?.timezone) {
        setTimezone(data.timezone);
        setTzAbbr(getTimezoneAbbr(data.timezone));
      }
    }
    fetchTimezone();
  }, []);

  useEffect(() => {
    function updateClock() {
      const now = new Date();
      setTime(
        now.toLocaleTimeString("en-US", {
          timeZone: timezone,
          hour: "numeric",
          minute: "2-digit",
          second: "2-digit",
          hour12: true,
        }) + " " + tzAbbr
      );
    }
    updateClock();
    const interval = setInterval(updateClock, 1000);
    return () => clearInterval(interval);
  }, [timezone, tzAbbr]);

  if (!time) return null;

  return (
    <span className="font-serif text-sm text-bark tabular-nums">{time}</span>
  );
}

function getInitials(name: string): string {
  return name
    .split(" ")
    .map((n) => n[0])
    .join("")
    .toUpperCase()
    .slice(0, 2);
}

export default function TopNav({ user }: TopNavProps) {
  const pathname = usePathname();
  const supabase = createClient();

  // Change password modal
  const [showChangePassword, setShowChangePassword] = useState(false);
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [passwordError, setPasswordError] = useState("");
  const [passwordSuccess, setPasswordSuccess] = useState(false);
  const [changingPassword, setChangingPassword] = useState(false);

  // Close-task-before-logout modal state
  const [showCloseTaskModal, setShowCloseTaskModal] = useState(false);
  const [activeTaskName, setActiveTaskName] = useState("");
  const [activeLogId, setActiveLogId] = useState<number | null>(null);
  const [activeTaskStartTime, setActiveTaskStartTime] = useState<string | null>(null);
  const [logoutTaskStatus, setLogoutTaskStatus] = useState("");
  const [logoutClientMemo, setLogoutClientMemo] = useState("");
  const [logoutInternalMemo, setLogoutInternalMemo] = useState("");
  const [showLogoutClientMemo, setShowLogoutClientMemo] = useState(false);
  const [showLogoutInternalMemo, setShowLogoutInternalMemo] = useState(false);
  const [loggingOut, setLoggingOut] = useState(false);
  const [logoutMood, setLogoutMood] = useState<'bad' | 'neutral' | 'good' | null>(null);

  // Filter nav items based on role
  // VAs see Dashboard, Time Log, Reports (same as admin minus Team)
  const navItems = allNavItems.filter((item) => {
    if (user.role === "va") {
      return item.href !== "/team";
    }
    return true;
  });

  const handleChangePassword = useCallback(async () => {
    setPasswordError("");
    setPasswordSuccess(false);

    if (newPassword.length < 6) {
      setPasswordError("Password must be at least 6 characters.");
      return;
    }
    if (newPassword !== confirmPassword) {
      setPasswordError("Passwords do not match.");
      return;
    }

    setChangingPassword(true);
    const { error } = await supabase.auth.updateUser({ password: newPassword });
    setChangingPassword(false);

    if (error) {
      setPasswordError(error.message);
      return;
    }

    setPasswordSuccess(true);
    setNewPassword("");
    setConfirmPassword("");
    setTimeout(() => {
      setShowChangePassword(false);
      setPasswordSuccess(false);
    }, 2000);
  }, [supabase, newPassword, confirmPassword]);

  const handleLogoutClick = useCallback(async () => {
    // Check if user has an active task by reading their session from Supabase
    const { data: { user: authUser } } = await supabase.auth.getUser();
    if (!authUser) {
      // No auth user — just sign out
      const form = document.createElement("form");
      form.style.display = "none";
      document.body.appendChild(form);
      // Use server action directly
      await signOut();
      return;
    }

    const { data: sessionData } = await supabase
      .from("sessions")
      .select("*")
      .eq("user_id", authUser.id)
      .maybeSingle();

    if (sessionData?.active_task && sessionData.clocked_in) {
      // Active task exists — show the close-task modal
      const task = sessionData.active_task as {
        task_name: string;
        logId: string;
        start_time: string;
      };
      setActiveTaskName(task.task_name || "Untitled Task");
      setActiveLogId(task.logId ? parseInt(task.logId, 10) : null);
      setActiveTaskStartTime(task.start_time || null);
      setShowCloseTaskModal(true);
    } else {
      // No active task — sign out immediately
      await signOut();
    }
  }, [supabase]);

  const handleCloseTaskAndLogout = useCallback(async () => {
    if (!logoutTaskStatus || (!logoutClientMemo.trim() && !logoutInternalMemo.trim())) return;
    setLoggingOut(true);

    try {
      const { data: { user: authUser } } = await supabase.auth.getUser();
      if (!authUser) {
        await signOut();
        return;
      }

      const now = new Date().toISOString();

      // Close the active task in time_logs
      if (activeLogId) {
        const durationMs = activeTaskStartTime
          ? Date.now() - new Date(activeTaskStartTime).getTime()
          : 0;

        const updatePayload: Record<string, unknown> = {
          end_time: now,
          duration_ms: durationMs,
        };
        if (logoutClientMemo.trim()) updatePayload.client_memo = logoutClientMemo.trim();
        if (logoutInternalMemo.trim()) updatePayload.internal_memo = logoutInternalMemo.trim();

        await supabase.from("time_logs").update(updatePayload).eq("id", activeLogId);
      }

      // Clock out the session with mood
      const sessionPayload: Record<string, unknown> = {
        user_id: authUser.id,
        clocked_in: false,
        clock_in_time: null,
        clock_out_time: now,
        active_task: null,
        updated_at: now,
      };
      if (logoutMood) {
        sessionPayload.mood = logoutMood;
      }

      // Fetch session for break recalculation before clearing it
      const { data: sessionForBreaks } = await supabase
        .from("sessions")
        .select("clock_in_time, session_date")
        .eq("user_id", authUser.id)
        .maybeSingle();

      await supabase.from("sessions").upsert(
        sessionPayload,
        { onConflict: "user_id" }
      );

      // Persist mood to mood_logs for historical tracking
      if (logoutMood) {
        const moodDate = sessionForBreaks?.session_date || new Date().toISOString().split("T")[0];
        await supabase.from("mood_logs").upsert(
          { user_id: authUser.id, session_date: moodDate, mood: logoutMood },
          { onConflict: "user_id,session_date" }
        );
      }

      // --- Billable Break Allowance: recalculate at clock-out ---
      const clockInTime = sessionForBreaks?.clock_in_time;
      const sessionDate = sessionForBreaks?.session_date || new Date().toISOString().split("T")[0];

      if (clockInTime) {
        const shiftMs = new Date(now).getTime() - new Date(clockInTime).getTime();
        const shiftHours = shiftMs / (1000 * 60 * 60);
        let allowedBreakMs = 0;
        if (shiftHours >= 8) allowedBreakMs = 45 * 60 * 1000;
        else if (shiftHours >= 7) allowedBreakMs = 30 * 60 * 1000;
        else if (shiftHours >= 6) allowedBreakMs = 25 * 60 * 1000;
        else if (shiftHours >= 5) allowedBreakMs = 20 * 60 * 1000;
        else if (shiftHours >= 4) allowedBreakMs = 15 * 60 * 1000;

        const { data: breakLogs } = await supabase
          .from("time_logs")
          .select("id, duration_ms, start_time")
          .eq("user_id", authUser.id)
          .eq("category", "Break")
          .gte("start_time", clockInTime)
          .lte("start_time", now)
          .not("end_time", "is", null)
          .order("start_time", { ascending: true });

        if (breakLogs && breakLogs.length > 0) {
          const totalBreakMs = breakLogs.reduce((sum, b) => sum + (b.duration_ms || 0), 0);
          const excessMs = Math.max(0, totalBreakMs - allowedBreakMs);

          if (excessMs > 0) {
            const sortedDesc = [...breakLogs].sort(
              (a, b) => new Date(b.start_time).getTime() - new Date(a.start_time).getTime()
            );
            let remaining = excessMs;
            const idsToFlip: number[] = [];
            for (const bl of sortedDesc) {
              if (remaining <= 0) break;
              idsToFlip.push(bl.id);
              remaining -= (bl.duration_ms || 0);
            }
            if (idsToFlip.length > 0) {
              await supabase
                .from("time_logs")
                .update({ billable: false })
                .in("id", idsToFlip);
            }
            await supabase
              .from("break_correction_requests")
              .insert({
                user_id: authUser.id,
                session_date: sessionDate,
                clock_in_time: clockInTime,
                clock_out_time: now,
                shift_duration_ms: shiftMs,
                total_break_ms: totalBreakMs,
                allowed_break_ms: allowedBreakMs,
                excess_break_ms: excessMs,
                break_log_ids: breakLogs.map((b) => b.id),
                status: "pending",
              });
          }
        }
      }
      // --- End Billable Break Allowance ---

      // Now sign out
      await signOut();
    } catch (err) {
      console.error("Error closing task before logout:", err);
      setLoggingOut(false);
    }
  }, [supabase, activeLogId, activeTaskStartTime, logoutTaskStatus, logoutClientMemo, logoutInternalMemo, logoutMood]);

  const cancelCloseTaskModal = useCallback(() => {
    setShowCloseTaskModal(false);
    setActiveTaskName("");
    setActiveLogId(null);
    setActiveTaskStartTime(null);
    setLogoutTaskStatus("");
    setLogoutClientMemo("");
    setLogoutInternalMemo("");
    setShowLogoutClientMemo(false);
    setShowLogoutInternalMemo(false);
    setLoggingOut(false);
    setLogoutMood(null);
  }, []);

  return (
    <>
      <header className="sticky top-0 z-50 border-b border-sand bg-white">
        <div className="mx-auto flex h-14 max-w-7xl items-center justify-between px-6">
          {/* Left: Brand */}
          <Link href="/dashboard" className="flex items-center gap-1">
            <span className="font-serif text-xl font-bold text-ink">
              Minute
              <span className="italic text-terracotta">Flow</span>
            </span>
          </Link>

          {/* Center: Tab navigation */}
          <nav className="flex items-center gap-1">
            {navItems.map((item) => {
              const isActive = pathname.startsWith(item.href);
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={`rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
                    isActive
                      ? "bg-terracotta-soft text-terracotta"
                      : "text-bark hover:bg-parchment hover:text-espresso"
                  }`}
                >
                  {item.label}
                </Link>
              );
            })}
          </nav>

          {/* Right: Clock, user chip, logout */}
          <div className="flex items-center gap-4">
            <Clock />

            <div className="flex items-center gap-2 rounded-full bg-parchment px-3 py-1">
              <div className="flex h-7 w-7 items-center justify-center rounded-full bg-terracotta text-xs font-bold text-white">
                {getInitials(user.full_name)}
              </div>
              <div className="hidden sm:block">
                <p className="text-xs font-medium text-espresso leading-tight">
                  {user.full_name}
                </p>
                {user.role && (
                  <p className="text-[10px] text-bark leading-tight">
                    {user.role}
                  </p>
                )}
              </div>
            </div>

            <button
              type="button"
              onClick={() => setShowChangePassword(true)}
              className="rounded-md px-3 py-1.5 text-sm text-bark transition-colors hover:bg-parchment hover:text-espresso cursor-pointer"
            >
              Password
            </button>

            {user.role === "admin" && (
              <Link
                href="/admin"
                className="rounded-md px-3 py-1.5 text-sm text-bark transition-colors hover:bg-parchment hover:text-espresso"
              >
                Admin
              </Link>
            )}

            <button
              type="button"
              onClick={handleLogoutClick}
              className="rounded-md px-3 py-1.5 text-sm text-bark transition-colors hover:bg-parchment hover:text-espresso cursor-pointer"
            >
              Log out
            </button>
          </div>
        </div>
      </header>

      {/* ─── Change Password Modal ─── */}
      {showChangePassword && (
        <div className="fixed inset-0 bg-black/30 flex items-center justify-center z-[60]">
          <div className="bg-white rounded-xl border border-sand shadow-xl w-full max-w-sm mx-4">
            <div className="py-4 px-5 border-b border-parchment flex items-center justify-between">
              <h3 className="text-sm font-bold text-espresso">Change Password</h3>
              <button
                onClick={() => {
                  setShowChangePassword(false);
                  setNewPassword("");
                  setConfirmPassword("");
                  setPasswordError("");
                  setPasswordSuccess(false);
                }}
                className="text-bark hover:text-terracotta text-lg leading-none cursor-pointer"
              >
                &times;
              </button>
            </div>
            <div className="p-5">
              {passwordSuccess ? (
                <div className="p-3 rounded-lg bg-sage-soft border border-sage text-xs text-sage font-medium text-center">
                  Password updated successfully!
                </div>
              ) : (
                <>
                  <div className="mb-3">
                    <label className="block text-[11px] font-semibold text-walnut mb-[5px] tracking-wide">
                      New Password
                    </label>
                    <input
                      type="password"
                      value={newPassword}
                      onChange={(e) => setNewPassword(e.target.value)}
                      placeholder="Min. 6 characters"
                      className="w-full py-2.5 px-[13px] border border-sand rounded-lg text-[13px] text-ink bg-white outline-none transition-all focus:border-terracotta focus:shadow-[0_0_0_3px_rgba(194,105,79,0.08)] placeholder:text-stone"
                    />
                  </div>
                  <div className="mb-3">
                    <label className="block text-[11px] font-semibold text-walnut mb-[5px] tracking-wide">
                      Confirm Password
                    </label>
                    <input
                      type="password"
                      value={confirmPassword}
                      onChange={(e) => setConfirmPassword(e.target.value)}
                      placeholder="Repeat new password"
                      className="w-full py-2.5 px-[13px] border border-sand rounded-lg text-[13px] text-ink bg-white outline-none transition-all focus:border-terracotta focus:shadow-[0_0_0_3px_rgba(194,105,79,0.08)] placeholder:text-stone"
                    />
                  </div>
                  {passwordError && (
                    <div className="mb-3 p-2.5 rounded-lg bg-red-50 border border-red-200 text-xs text-red-600">
                      {passwordError}
                    </div>
                  )}
                  <button
                    onClick={handleChangePassword}
                    disabled={changingPassword || !newPassword || !confirmPassword}
                    className="w-full py-2.5 rounded-lg bg-terracotta text-white text-[13px] font-semibold cursor-pointer transition-all hover:bg-[#a85840] disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {changingPassword ? "Updating..." : "Update Password"}
                  </button>
                </>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ─── Close Task Before Logout Modal ─── */}
      {showCloseTaskModal && (
        <div className="fixed inset-0 bg-black/30 flex items-center justify-center z-[60]">
          <div className="bg-white rounded-xl border border-sand shadow-xl w-full max-w-lg mx-4">
            <div className="py-4 px-5 border-b border-parchment flex items-center justify-between">
              <h3 className="text-sm font-bold text-espresso">
                Close Active Task Before Signing Out
              </h3>
              <button
                onClick={cancelCloseTaskModal}
                className="text-bark hover:text-terracotta text-lg leading-none cursor-pointer"
              >
                &times;
              </button>
            </div>
            <div className="p-5">
              {/* Info banner */}
              <div className="mb-4 p-3 rounded-lg bg-amber-soft border border-[#d4c07a] text-xs text-amber font-medium">
                You have an active task: <strong>{activeTaskName}</strong>. Please close it before signing out.
              </div>

              {/* Task Status */}
              <div className="mb-4">
                <p className="text-[11px] font-semibold text-walnut mb-2 tracking-wide">
                  Task Status <span className="text-terracotta">*</span>
                </p>
                <div className="flex gap-2">
                  {["In Progress", "Completed", "On Hold"].map((status) => (
                    <button
                      key={status}
                      onClick={() => setLogoutTaskStatus(status)}
                      className={`flex-1 py-2 rounded-lg text-xs font-semibold cursor-pointer transition-all ${
                        logoutTaskStatus === status
                          ? status === "Completed"
                            ? "bg-sage text-white border border-sage"
                            : status === "On Hold"
                            ? "bg-amber text-white border border-amber"
                            : "bg-terracotta text-white border border-terracotta"
                          : "border border-sand bg-white text-bark hover:border-terracotta"
                      }`}
                    >
                      {status}
                    </button>
                  ))}
                </div>
              </div>

              {/* Memos — both can be filled independently */}
              <div className="mb-3">
                <p className="text-[11px] font-semibold text-walnut mb-2 tracking-wide">
                  Add Comments <span className="text-stone font-normal">(at least one required)</span>
                </p>

                {/* Client Memo */}
                <div className="mb-3">
                  <button
                    onClick={() => setShowLogoutClientMemo(!showLogoutClientMemo)}
                    className={`w-full flex items-center justify-between py-2.5 px-3.5 rounded-lg text-xs font-semibold cursor-pointer transition-all ${
                      showLogoutClientMemo || logoutClientMemo
                        ? "bg-slate-blue text-white border border-slate-blue"
                        : "border border-slate-blue/30 bg-slate-blue-soft text-slate-blue hover:border-slate-blue"
                    }`}
                  >
                    <span>Client Memo</span>
                    <span className="text-[10px] opacity-75">
                      {logoutClientMemo ? "filled" : showLogoutClientMemo ? "collapse" : "expand"}
                    </span>
                  </button>
                  {showLogoutClientMemo && (
                    <textarea
                      value={logoutClientMemo}
                      onChange={(e) => setLogoutClientMemo(e.target.value)}
                      placeholder="Notes visible to the client..."
                      rows={2}
                      autoFocus
                      className="w-full mt-1.5 py-2.5 px-[13px] border border-slate-blue/30 rounded-lg text-[13px] text-ink bg-white outline-none transition-all focus:border-slate-blue focus:shadow-[0_0_0_3px_rgba(100,116,139,0.08)] placeholder:text-stone resize-none"
                    />
                  )}
                </div>

                {/* Internal Memo */}
                <div>
                  <button
                    onClick={() => setShowLogoutInternalMemo(!showLogoutInternalMemo)}
                    className={`w-full flex items-center justify-between py-2.5 px-3.5 rounded-lg text-xs font-semibold cursor-pointer transition-all ${
                      showLogoutInternalMemo || logoutInternalMemo
                        ? "bg-walnut text-white border border-walnut"
                        : "border border-walnut/30 bg-amber-soft text-walnut hover:border-walnut"
                    }`}
                  >
                    <span>Internal Memo</span>
                    <span className="text-[10px] opacity-75">
                      {logoutInternalMemo ? "filled" : showLogoutInternalMemo ? "collapse" : "expand"}
                    </span>
                  </button>
                  {showLogoutInternalMemo && (
                    <textarea
                      value={logoutInternalMemo}
                      onChange={(e) => setLogoutInternalMemo(e.target.value)}
                      placeholder="Internal notes (not visible to client)..."
                      rows={2}
                      autoFocus
                      className="w-full mt-1.5 py-2.5 px-[13px] border border-walnut/30 rounded-lg text-[13px] text-ink bg-white outline-none transition-all focus:border-walnut focus:shadow-[0_0_0_3px_rgba(93,75,60,0.08)] placeholder:text-stone resize-none"
                    />
                  )}
                </div>
              </div>

              {/* Mood Rating */}
              <div className="mb-3">
                <p className="text-[11px] font-semibold text-walnut mb-2 tracking-wide">
                  How was your day? <span className="text-stone font-normal">(optional)</span>
                </p>
                <div className="flex gap-2">
                  {([
                    { value: 'bad' as const, emoji: "\uD83D\uDE1E", label: "Not great" },
                    { value: 'neutral' as const, emoji: "\uD83D\uDE10", label: "Okay" },
                    { value: 'good' as const, emoji: "\uD83D\uDE0A", label: "Great" },
                  ]).map((mood) => (
                    <button
                      key={mood.value}
                      onClick={() => setLogoutMood(logoutMood === mood.value ? null : mood.value)}
                      className={`flex-1 flex flex-col items-center gap-1 py-2.5 rounded-lg text-xs font-semibold cursor-pointer transition-all ${
                        logoutMood === mood.value
                          ? mood.value === 'good'
                            ? "bg-sage text-white border-2 border-sage"
                            : mood.value === 'bad'
                            ? "bg-terracotta text-white border-2 border-terracotta"
                            : "bg-amber text-white border-2 border-amber"
                          : "border border-sand bg-white text-bark hover:border-terracotta"
                      }`}
                    >
                      <span className="text-xl">{mood.emoji}</span>
                      <span className="text-[10px]">{mood.label}</span>
                    </button>
                  ))}
                </div>
              </div>

              {/* Submit */}
              <div className="flex gap-3 mt-4">
                <button
                  onClick={cancelCloseTaskModal}
                  className="flex-1 py-2.5 rounded-lg bg-parchment text-walnut border border-sand text-[13px] font-semibold cursor-pointer transition-all hover:bg-sand hover:text-espresso"
                >
                  Cancel
                </button>
                <button
                  onClick={handleCloseTaskAndLogout}
                  disabled={!logoutTaskStatus || (!logoutClientMemo.trim() && !logoutInternalMemo.trim()) || loggingOut}
                  className="flex-1 py-2.5 rounded-lg bg-terracotta text-white text-[13px] font-semibold cursor-pointer transition-all hover:bg-[#a85840] disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {loggingOut ? "Closing & signing out..." : "Close Task & Sign Out"}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
