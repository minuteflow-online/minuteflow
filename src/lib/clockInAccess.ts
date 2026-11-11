import { normalizePosition } from "@/types/database";

/**
 * Whether someone is allowed to clock in and track time.
 *
 * Two ways to be blocked:
 *   - the clock_in_disabled flag, set per person in Team Management
 *   - position Output Based, which is blocked by what it means: that work is
 *     paid per task, so there is no shift to run a clock against
 *
 * This governs time tracking only. A blocked person still signs in and uses
 * MinuteFlow normally — their tasks, submissions, portal and paystubs all work.
 * Taking away the clock is not taking away the account.
 */
export type ClockInProfile = {
  position?: string | null;
  clock_in_disabled?: boolean | null;
};

export function clockInBlockedReason(profile: ClockInProfile | null | undefined): string | null {
  if (!profile) return null;

  if (profile.clock_in_disabled) {
    return "Clocking in is turned off for your account. Ask an admin if you think this is wrong.";
  }

  if (normalizePosition(profile.position) === "Output Based") {
    return "Output Based work is paid per task, so there is no clock to run. Pick up a task instead.";
  }

  return null;
}

export function canClockIn(profile: ClockInProfile | null | undefined): boolean {
  return clockInBlockedReason(profile) === null;
}

export type WebTrackingProfile = {
  web_tracking_override_until?: string | null;
};

/**
 * True when the browser itself is running on Windows — the one signal
 * windowsWebBlockedReason keys off. Lives here rather than a shared
 * platform-sniffing util since this is its only caller.
 */
export function isWindowsBrowser(): boolean {
  if (typeof navigator === "undefined") return false;
  return /Windows/i.test(navigator.userAgent || "");
}

/**
 * Windows users are expected to run their task timer through the desktop
 * app, not the browser (Toni's call, 2026-11-11, refined 2026-11-11 after
 * walking back the original "block Clock In too" plan — attendance marking
 * stays on web; it's only running a task that moves to desktop). Blocks
 * starting/resuming a tracked task on web when running on Windows —
 * startTask, resumePreBreakTask, resumeOnHoldTask all check this. Blocking
 * those blocks web screenshot capture too for free, since that only ever
 * runs while a task is actively running.
 *
 * The real goal behind this (per Toni) is forcing the desktop app into daily
 * use, since that's the one she wants to be the only source of screenshots —
 * blocking web's own task timer is what makes opening the desktop app
 * unavoidable, not a goal in itself.
 *
 * An admin-granted exception (web_tracking_override_until set to a future
 * time) lets a specific person through regardless — the "my desktop app is
 * broken right now" escape hatch. It expires on its own; nothing has to turn
 * it back off.
 *
 * Desktop, Mac, iOS, and every other OS never see this at all — isWindows is
 * passed in by the caller (isWindowsBrowser(), web only), and desktop has its
 * own separate copy of clockInBlockedReason that never calls this.
 */
export function windowsWebBlockedReason(
  profile: WebTrackingProfile | null | undefined,
  isWindows: boolean
): string | null {
  if (!isWindows) return null;
  const until = profile?.web_tracking_override_until;
  if (until && new Date(until).getTime() > Date.now()) return null;
  return "Please use the MinuteFlow desktop app to start and track tasks on Windows. If it's broken, message Toni for a temporary exception.";
}
