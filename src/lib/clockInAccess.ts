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
