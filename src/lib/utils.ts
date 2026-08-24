/**
 * True when a Supabase/Postgres insert error is the time_logs_one_active_per_user
 * unique-violation — this user already has an open task or break running
 * somewhere else (another tab, device, or the browser extension) at the same
 * moment this insert fired. Lets callers show "you're already tracking
 * something else" instead of the raw constraint-violation message.
 */
export function isDuplicateActiveLogError(error: { code?: string; message?: string } | null | undefined): boolean {
  if (!error) return false;
  return error.code === "23505" && (error.message?.includes("time_logs_one_active_per_user") ?? false);
}

/** Count words in a string (trims and splits on whitespace) */
export function countWords(text: string): number {
  const trimmed = text.trim();
  if (!trimmed) return 0;
  return trimmed.split(/\s+/).length;
}

/** Format milliseconds to "Xh Ym" display */
export function formatDuration(ms: number): string {
  if (ms <= 0) return "0:00";
  const totalMinutes = Math.floor(ms / 60000);
  const h = Math.floor(totalMinutes / 60);
  const m = totalMinutes % 60;
  if (h > 0) return `${h}h ${m.toString().padStart(2, "0")}m`;
  return `${m}m`;
}

/** Format milliseconds to "X:XX" short format */
export function formatDurationShort(ms: number): string {
  if (ms <= 0) return "0:00";
  const totalMinutes = Math.floor(ms / 60000);
  const h = Math.floor(totalMinutes / 60);
  const m = totalMinutes % 60;
  return `${h}:${m.toString().padStart(2, "0")}`;
}

/** Get initials from a full name */
export function getInitials(name: string): string {
  return name
    .split(" ")
    .map((n) => n[0])
    .join("")
    .toUpperCase()
    .slice(0, 2);
}

/** Color palette for avatars */
export const avatarColors = [
  "var(--color-terracotta)",
  "var(--color-sage)",
  "var(--color-clay-rose)",
  "var(--color-slate-blue)",
  "var(--color-walnut)",
  "var(--color-stone)",
  "var(--color-amber)",
] as const;

/** Get a deterministic avatar color from a user ID or name */
export function getAvatarColor(seed: string): string {
  let hash = 0;
  for (let i = 0; i < seed.length; i++) {
    hash = seed.charCodeAt(i) + ((hash << 5) - hash);
  }
  return avatarColors[Math.abs(hash) % avatarColors.length];
}

/**
 * Display label for a profile's role. "manager" is the underlying DB value
 * used for IT-department staff with admin-panel access (see the IT-admin
 * access commit) but reads confusingly like a real people-manager role —
 * this shows "IT Admin" instead wherever role + department are both known.
 * The database column itself is untouched; this is display-only.
 */
const ROLE_LABELS: Record<string, string> = {
  va: "Staff",
  admin: "Admin",
  manager: "Manager",
  coordinator: "Coordinator",
  specialist: "Specialist",
  ceo: "CEO",
  founder: "Founder",
};

export function displayRole(role: string | null | undefined, department?: string | null): string {
  if (role === "manager" && department?.trim().toUpperCase() === "IT") return "IT Admin";
  if (!role) return "";
  return ROLE_LABELS[role] ?? role;
}

/** Format a date to time display in a specific timezone (e.g. "3:45 PM") */
export function formatTimeTZ(date: Date | string, timezone: string): string {
  const d = typeof date === "string" ? new Date(date) : date;
  return d.toLocaleTimeString("en-US", {
    timeZone: timezone,
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });
}

/** @deprecated Use formatTimeTZ instead */
export const formatTimeET = formatTimeTZ;

/** Format a date to short date display in a specific timezone (e.g. "Jan 5") */
export function formatDateShortTZ(date: Date | string, timezone: string): string {
  const d = typeof date === "string" ? new Date(date) : date;
  return d.toLocaleDateString("en-US", {
    timeZone: timezone,
    month: "short",
    day: "numeric",
  });
}

/** Format a date to full date display in a specific timezone (e.g. "January 5, 2026") */
export function formatDateFullTZ(date: Date | string, timezone: string): string {
  const d = typeof date === "string" ? new Date(date) : date;
  return d.toLocaleDateString("en-US", {
    timeZone: timezone,
    month: "long",
    day: "numeric",
    year: "numeric",
  });
}

/** Format a date to date+time display in a specific timezone (e.g. "Jan 5, 3:45 PM") */
export function formatDateTimeTZ(date: Date | string, timezone: string): string {
  const d = typeof date === "string" ? new Date(date) : date;
  return d.toLocaleString("en-US", {
    timeZone: timezone,
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });
}

/** Format a date to YYYY-MM-DD in a specific timezone */
export function formatDateLocalTZ(date: Date | string, timezone: string): string {
  const d = typeof date === "string" ? new Date(date) : date;
  return d.toLocaleDateString("en-CA", { timeZone: timezone });
}

/** Get the timezone abbreviation for display */
export function getTimezoneAbbr(timezone: string): string {
  const d = new Date();
  const parts = d.toLocaleTimeString("en-US", {
    timeZone: timezone,
    timeZoneName: "short",
  });
  // Extract timezone abbreviation (last word)
  return parts.split(" ").pop() || "";
}

/**
 * Convert a wall-clock time (month is 0-indexed) as read in a given timezone to
 * the equivalent UTC instant.
 *
 * The UTC offset is derived from the target instant itself (not from "now"), so this
 * stays correct across DST transitions — reusing a single "now"-based offset for a
 * boundary date on the other side of a DST change silently shifts it by a day/hour.
 */
function zonedTimeToUtc(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
  second: number,
  ms: number,
  timezone: string
): Date {
  const guess = new Date(Date.UTC(year, month, day, hour, minute, second, ms));
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
  const parts = formatter.formatToParts(guess);
  const gYear = parseInt(parts.find(p => p.type === "year")!.value);
  const gMonth = parseInt(parts.find(p => p.type === "month")!.value) - 1;
  const gDay = parseInt(parts.find(p => p.type === "day")!.value);
  // Intl renders midnight as hour "24" in some zones; normalize it back to 0.
  const gHour = parseInt(parts.find(p => p.type === "hour")!.value) % 24;
  const gMinute = parseInt(parts.find(p => p.type === "minute")!.value);
  const gSecond = parseInt(parts.find(p => p.type === "second")!.value);
  // Zone offsets never carry a sub-second component, so the guess's own ms is
  // reused here — Intl gives no fractional seconds to read back.
  const tzAsUtc = Date.UTC(gYear, gMonth, gDay, gHour, gMinute, gSecond, ms);
  const offsetMs = tzAsUtc - guess.getTime();
  return new Date(guess.getTime() - offsetMs);
}

/** Convert local midnight (month is 0-indexed) in a given timezone to a UTC instant. */
function localMidnightToUtc(year: number, month: number, day: number, timezone: string): Date {
  return zonedTimeToUtc(year, month, day, 0, 0, 0, 0, timezone);
}

/**
 * When a screenshot was actually taken, read out of its Drive filename.
 *
 * The filename is written once at upload and never touched again, so it is the one
 * timestamp on a screenshot that cannot drift afterwards — `created_at` is the DB
 * insert, which lands a few seconds later and moves if a row is ever re-inserted.
 * Three filename generations exist in the data:
 *
 *   Name_Task_2026-08-16_14-12-58-411_ET.png  Eastern wall clock (current format)
 *   Name_Task_2026-07-23_21-40-23-665.png     UTC
 *   progress_2026-04-28T17-11-54-803Z.png     UTC (oldest)
 *
 * Returns a UTC ISO string, or null for a filename matching none of them — callers
 * fall back to `created_at` in that case.
 */
export function screenshotCaptureTime(filename: string | null | undefined): string | null {
  if (!filename) return null;

  const eastern = filename.match(/(\d{4})-(\d{2})-(\d{2})_(\d{2})-(\d{2})-(\d{2})-(\d{3})_ET\.png$/);
  if (eastern) {
    const [year, month, day, hour, minute, second, ms] = eastern.slice(1).map(Number);
    return zonedTimeToUtc(year, month - 1, day, hour, minute, second, ms, "America/New_York").toISOString();
  }

  const utc = filename.match(/(\d{4}-\d{2}-\d{2})[_T](\d{2})-(\d{2})-(\d{2})-(\d{3})Z?\.png$/);
  if (utc) {
    const parsed = new Date(`${utc[1]}T${utc[2]}:${utc[3]}:${utc[4]}.${utc[5]}Z`);
    return isNaN(parsed.getTime()) ? null : parsed.toISOString();
  }

  return null;
}

/**
 * Get the start/end boundaries of a specific day (as represented in a given timezone)
 * for any reference Date, returned as UTC ISO strings.
 */
export function getDayBoundsInTimezone(date: Date, timezone: string): { start: string; end: string } {
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour12: false,
  });
  const parts = formatter.formatToParts(date);
  const tzYear = parseInt(parts.find(p => p.type === "year")!.value);
  const tzMonth = parseInt(parts.find(p => p.type === "month")!.value) - 1;
  const tzDay = parseInt(parts.find(p => p.type === "day")!.value);

  const startUtc = localMidnightToUtc(tzYear, tzMonth, tzDay, timezone);
  const nextDayUtc = localMidnightToUtc(tzYear, tzMonth, tzDay + 1, timezone);
  const endUtc = new Date(nextDayUtc.getTime() - 1);

  return { start: startUtc.toISOString(), end: endUtc.toISOString() };
}

/** Get today's date boundaries in a specific timezone */
export function getTodayBoundsInTimezone(timezone: string): { start: string; end: string } {
  return getDayBoundsInTimezone(new Date(), timezone);
}

/** Get start of today in ISO format, in the given timezone (defaults to UTC) */
export function todayStart(timezone = "UTC"): string {
  return getTodayBoundsInTimezone(timezone).start;
}

/** Get start/end of the current week (Mon–Sun) in a given timezone, as UTC ISO strings */
export function getWeekBoundsInTimezone(timezone: string): { start: string; end: string } {
  const now = new Date();
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour12: false,
  });
  const parts = formatter.formatToParts(now);
  const tzYear = parseInt(parts.find(p => p.type === "year")!.value);
  const tzMonth = parseInt(parts.find(p => p.type === "month")!.value) - 1;
  const tzDay = parseInt(parts.find(p => p.type === "day")!.value);
  // Find Monday of current week in timezone
  const jsDay = new Date(tzYear, tzMonth, tzDay).getDay(); // 0=Sun
  const diffToMonday = jsDay === 0 ? -6 : 1 - jsDay;
  const mondayDate = new Date(tzYear, tzMonth, tzDay + diffToMonday);
  const sundayDate = new Date(tzYear, tzMonth, tzDay + diffToMonday + 6);
  const startUtc = localMidnightToUtc(mondayDate.getFullYear(), mondayDate.getMonth(), mondayDate.getDate(), timezone);
  const nextWeekStartUtc = localMidnightToUtc(sundayDate.getFullYear(), sundayDate.getMonth(), sundayDate.getDate() + 1, timezone);
  const endUtc = new Date(nextWeekStartUtc.getTime() - 1);
  return { start: startUtc.toISOString(), end: endUtc.toISOString() };
}

/**
 * Get start/end of the month containing a given date in a specific timezone,
 * as UTC ISO strings.
 */
export function getMonthBoundsForDate(date: Date, timezone: string): { start: string; end: string } {
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour12: false,
  });
  const parts = formatter.formatToParts(date);
  const tzYear = parseInt(parts.find(p => p.type === "year")!.value);
  const tzMonth = parseInt(parts.find(p => p.type === "month")!.value) - 1;
  const firstDay = new Date(tzYear, tzMonth, 1);
  const lastDay = new Date(tzYear, tzMonth + 1, 0);
  const startUtc = localMidnightToUtc(firstDay.getFullYear(), firstDay.getMonth(), firstDay.getDate(), timezone);
  const nextMonthStartUtc = localMidnightToUtc(lastDay.getFullYear(), lastDay.getMonth(), lastDay.getDate() + 1, timezone);
  const endUtc = new Date(nextMonthStartUtc.getTime() - 1);
  return { start: startUtc.toISOString(), end: endUtc.toISOString() };
}

/** Get start/end of the current month in a given timezone, as UTC ISO strings */
export function getMonthBoundsInTimezone(timezone: string): { start: string; end: string } {
  return getMonthBoundsForDate(new Date(), timezone);
}

/** Get start/end of the current year (Jan 1 – Dec 31) in a given timezone, as UTC ISO strings */
export function getYearBoundsInTimezone(timezone: string): { start: string; end: string } {
  const now = new Date();
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    year: "numeric",
    hour12: false,
  });
  const parts = formatter.formatToParts(now);
  const tzYear = parseInt(parts.find(p => p.type === "year")!.value);
  const startUtc = localMidnightToUtc(tzYear, 0, 1, timezone);
  const nextYearStartUtc = localMidnightToUtc(tzYear + 1, 0, 1, timezone);
  const endUtc = new Date(nextYearStartUtc.getTime() - 1);
  return { start: startUtc.toISOString(), end: endUtc.toISOString() };
}

/** Get start of the week (Monday) at midnight UTC */
export function weekStart(date?: Date): Date {
  const d = date ? new Date(date) : new Date();
  const day = d.getUTCDay();
  const diff = d.getUTCDate() - day + (day === 0 ? -6 : 1);
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), diff));
}

/** Get end of the week (Sunday) */
export function weekEnd(date?: Date): Date {
  const start = weekStart(date);
  const end = new Date(start);
  end.setDate(end.getDate() + 6);
  end.setHours(23, 59, 59, 999);
  return end;
}

/**
 * Whole days between a "YYYY-MM-DD" start date and today. Counted off the
 * calendar date rather than elapsed milliseconds, so someone who started
 * yesterday reads as 1 day whatever time of day either end falls on.
 */
export function daysSinceDate(isoDate: string | null | undefined): number | null {
  if (!isoDate) return null;
  const started = new Date(isoDate + "T12:00:00");
  if (Number.isNaN(started.getTime())) return null;
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 12, 0, 0);
  const days = Math.floor((today.getTime() - started.getTime()) / 86_400_000);
  return days >= 0 ? days : null;
}

/** "942 days (2y 7m)" — how long someone has been on the team. */
export function formatTenure(isoDate: string | null | undefined): string {
  const days = daysSinceDate(isoDate);
  if (days == null) return "—";
  if (days === 0) return "Started today";
  const label = `${days.toLocaleString()} day${days === 1 ? "" : "s"}`;
  // Past a year the raw day count stops being readable on its own.
  const years = Math.floor(days / 365);
  if (years >= 1) {
    const months = Math.floor((days - years * 365) / 30);
    const rounded = [`${years}y`, months > 0 ? `${months}m` : null].filter(Boolean).join(" ");
    return `${label} (${rounded})`;
  }
  return label;
}
