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

/** Format a date to time display in a specific timezone (e.g. "3:45 PM") */
export function formatTimeET(date: Date | string, timezone?: string): string {
  const d = typeof date === "string" ? new Date(date) : date;
  return d.toLocaleTimeString("en-US", {
    timeZone: timezone || "America/New_York",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });
}

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
  return parts.split(" ").pop() || "ET";
}

/** Get today's date boundaries in a specific timezone */
export function getTodayBoundsInTimezone(timezone: string): { start: string; end: string } {
  const now = new Date();
  // Get today's date string in the target timezone
  const dateStr = now.toLocaleDateString("en-CA", { timeZone: timezone }); // YYYY-MM-DD format
  // Create start/end boundaries — these are ISO strings representing midnight in the org timezone
  // We use the timezone offset to compute exact UTC boundaries
  const startLocal = new Date(`${dateStr}T00:00:00`);
  const endLocal = new Date(`${dateStr}T23:59:59.999`);
  // Get the offset for this timezone
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
  const parts = formatter.formatToParts(now);
  const tzYear = parseInt(parts.find(p => p.type === "year")!.value);
  const tzMonth = parseInt(parts.find(p => p.type === "month")!.value) - 1;
  const tzDay = parseInt(parts.find(p => p.type === "day")!.value);
  const tzHour = parseInt(parts.find(p => p.type === "hour")!.value);
  const tzMinute = parseInt(parts.find(p => p.type === "minute")!.value);
  const tzSecond = parseInt(parts.find(p => p.type === "second")!.value);

  // Local time in tz as if it were UTC
  const tzAsUtc = new Date(Date.UTC(tzYear, tzMonth, tzDay, tzHour, tzMinute, tzSecond));
  const offsetMs = tzAsUtc.getTime() - now.getTime();

  // Midnight today in tz → UTC
  const midnightTzAsUtc = new Date(Date.UTC(tzYear, tzMonth, tzDay, 0, 0, 0, 0));
  const startUtc = new Date(midnightTzAsUtc.getTime() - offsetMs);
  const endUtc = new Date(midnightTzAsUtc.getTime() - offsetMs + 24 * 60 * 60 * 1000 - 1);

  return { start: startUtc.toISOString(), end: endUtc.toISOString() };
}

/** Get start of today in ISO format */
export function todayStart(): string {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d.toISOString();
}

/** Get start of the week (Monday) */
export function weekStart(date?: Date): Date {
  const d = date ? new Date(date) : new Date();
  const day = d.getDay();
  const diff = d.getDate() - day + (day === 0 ? -6 : 1);
  d.setDate(diff);
  d.setHours(0, 0, 0, 0);
  return d;
}

/** Get end of the week (Sunday) */
export function weekEnd(date?: Date): Date {
  const start = weekStart(date);
  const end = new Date(start);
  end.setDate(end.getDate() + 6);
  end.setHours(23, 59, 59, 999);
  return end;
}
