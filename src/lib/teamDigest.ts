import { createClient } from "@supabase/supabase-js";
import { ORG_TIMEZONE } from "./taskSchedule";
import { esc, mention } from "./telegram";

/**
 * The team chat's daily notes: whose day it is, what is due, who is away.
 *
 * Two runs, because one time cannot serve both halves. The morning note covers
 * today — what is due, who is away. The evening note covers tomorrow, and is
 * where birthdays and anniversaries go.
 *
 * Birthdays deliberately go out the evening before, Eastern. The team is in
 * the Philippines, twelve hours ahead, so 7pm here is breakfast there on the
 * day itself — a greeting sent on the Eastern morning would reach them as
 * their birthday was already ending.
 *
 * Meetings are not a separate thing to track. Ari schedules the team meeting as
 * a recurring assigned task with a due date, so it arrives through the same
 * query as everything else — and if she moves it, the reminder moves with it
 * rather than drifting away from a hardcoded Saturday.
 */

function service() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  );
}

/** YYYY-MM-DD in the org's timezone. Dates in this app are org-local, never
 *  the server's — a digest built on UTC would announce tomorrow's birthday to
 *  people who are still in yesterday. */
function orgDate(offsetDays = 0): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + offsetDays);
  return d.toLocaleDateString("en-CA", { timeZone: ORG_TIMEZONE });
}

function longDate(iso: string): string {
  return new Date(iso + "T12:00:00Z").toLocaleDateString("en-US", {
    timeZone: ORG_TIMEZONE,
    weekday: "long",
    month: "long",
    day: "numeric",
  });
}

/** People whose birthday falls on this month and day, whatever the year. */
async function birthdaysOn(date: string) {
  const supabase = service();
  const [, month, day] = date.split("-");
  const { data } = await supabase
    .from("profiles")
    .select("full_name, username, birthday, telegram_chat_id")
    .eq("is_active", true)
    .not("birthday", "is", null);

  return (data ?? []).filter((p) => {
    const b = String(p.birthday);
    return b.slice(5, 7) === month && b.slice(8, 10) === day;
  });
}

/** Work anniversaries — same day and month as their start date, at least a
 *  year ago. Someone's first day is not an anniversary. */
async function anniversariesOn(date: string) {
  const supabase = service();
  const [year, month, day] = date.split("-");
  const { data } = await supabase
    .from("profiles")
    .select("full_name, username, date_started, telegram_chat_id")
    .eq("is_active", true)
    .not("date_started", "is", null);

  return (data ?? [])
    .filter((p) => {
      const d = String(p.date_started);
      return d.slice(5, 7) === month && d.slice(8, 10) === day && d.slice(0, 4) < year;
    })
    .map((p) => ({
      ...p,
      years: Number(year) - Number(String(p.date_started).slice(0, 4)),
    }));
}

/** Tasks and meetings due on a given day, with who they belong to. */
async function dueOn(date: string) {
  const supabase = service();
  const { data } = await supabase
    .from("assigned_tasks")
    .select("id, task_name, due_time, account, project, status")
    .eq("due_date", date)
    .is("deleted_at", null)
    .is("archived_at", null);

  // Finished work is not a reminder. Anything still open is.
  return (data ?? []).filter((t) => !["approved", "completed"].includes(String(t.status ?? "")));
}

/** Who has approved time off covering this day. */
async function offOn(date: string) {
  const supabase = service();
  const { data } = await supabase
    .from("va_requests")
    .select("user_id, start_date, end_date, type, status")
    .eq("type", "time_off")
    .eq("status", "approved")
    .lte("start_date", date);

  const covering = (data ?? []).filter((r) => (r.end_date ?? r.start_date) >= date);
  if (covering.length === 0) return [];

  const { data: profs } = await supabase
    .from("profiles")
    .select("id, full_name, username")
    .in("id", covering.map((r) => r.user_id));

  return (profs ?? []).map((p) => p.full_name || p.username || "Someone");
}

export type DigestKind = "today" | "tomorrow";

/** Builds the message, or null when there is nothing worth saying. A digest
 *  that only ever says "nothing today" trains people to stop reading it. */
export async function buildTeamDigest(kind: DigestKind): Promise<{
  text: string;
  birthdayPeople: string[];
} | null> {
  const date = kind === "today" ? orgDate(0) : orgDate(1);
  const [birthdays, anniversaries, due, off] = await Promise.all([
    kind === "tomorrow" ? birthdaysOn(date) : Promise.resolve([]),
    kind === "tomorrow" ? anniversariesOn(date) : Promise.resolve([]),
    dueOn(date),
    offOn(date),
  ]);

  if (birthdays.length === 0 && anniversaries.length === 0 && due.length === 0 && off.length === 0) {
    return null;
  }

  const lines: string[] = [
    kind === "today"
      ? `📅 <b>${longDate(date)}</b>`
      : `🌙 <b>Tomorrow — ${longDate(date)}</b>`,
  ];

  for (const p of birthdays) {
    const who = (p.full_name as string) || (p.username as string) || "Someone";
    lines.push("", `🎂 <b>Happy birthday, ${mention(who, p.telegram_chat_id as number | null)}!</b>`);
  }

  for (const p of anniversaries) {
    const who = (p.full_name as string) || (p.username as string) || "Someone";
    lines.push(
      "",
      `🎉 <b>${mention(who, p.telegram_chat_id as number | null)}</b> — ${p.years} year${p.years === 1 ? "" : "s"} with MinuteFlow today. Thank you.`
    );
  }

  if (due.length > 0) {
    lines.push("", kind === "today" ? "<b>Due today</b>" : "<b>Due tomorrow</b>");
    for (const t of due.slice(0, 15)) {
      const where = [t.account, t.project].filter(Boolean).join(" / ");
      const at = t.due_time ? ` at ${esc(String(t.due_time).slice(0, 5))}` : "";
      lines.push(`• ${esc(String(t.task_name ?? "a task"))}${at}${where ? ` — ${esc(where)}` : ""}`);
    }
    if (due.length > 15) lines.push(`…and ${due.length - 15} more`);
  }

  if (off.length > 0) {
    lines.push("", `🌴 <b>Away</b>: ${esc(off.join(", "))}`);
  }

  return {
    text: lines.join("\n"),
    birthdayPeople: birthdays.map((p) => (p.full_name as string) || (p.username as string) || "Someone"),
  };
}

/**
 * Friday's recap of what the team shipped this week.
 *
 * Counts submissions rather than hours. Hours say how long someone sat there;
 * submissions say what actually left their hands, which is the thing worth
 * reading aloud on a Friday.
 *
 * Returns null on a quiet week rather than posting an empty scoreboard.
 */
export async function buildWeeklyRecap(): Promise<string | null> {
  const supabase = service();
  const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();

  const { data: subs } = await supabase
    .from("task_submissions")
    .select("user_id")
    .eq("message_type", "submission")
    .gte("created_at", weekAgo)
    .is("deleted_at", null);

  if (!subs || subs.length === 0) return null;

  const counts = new Map<string, number>();
  for (const s of subs) {
    const id = s.user_id as string;
    if (id) counts.set(id, (counts.get(id) ?? 0) + 1);
  }

  const { data: profs } = await supabase
    .from("profiles")
    .select("id, full_name, username, telegram_chat_id")
    .in("id", [...counts.keys()]);

  const ranked = (profs ?? [])
    .map((p) => ({
      name: (p.full_name as string) || (p.username as string) || "Someone",
      chatId: p.telegram_chat_id as number | null,
      count: counts.get(p.id as string) ?? 0,
    }))
    .sort((a, b) => b.count - a.count);

  if (ranked.length === 0) return null;

  const total = ranked.reduce((sum, r) => sum + r.count, 0);
  const lines = [
    "🏁 <b>This week</b>",
    "",
    `${total} submission${total === 1 ? "" : "s"} from ${ranked.length} ${ranked.length === 1 ? "person" : "people"}.`,
    "",
  ];

  // Everyone who submitted is named. No ranking flourishes, no "top
  // performer" — a recap that crowns someone makes it a leaderboard, and
  // whoever is at the bottom reads it that way every Friday.
  for (const r of ranked) {
    lines.push(`• ${mention(r.name, r.chatId)} — ${r.count}`);
  }

  lines.push("", "Thank you, all of you. Have a good weekend.");
  return lines.join("\n");
}

/**
 * A reminder for a meeting that is due today or tomorrow.
 *
 * Found by name against the calendar rather than hardcoded to Saturday. Ari
 * schedules the team meeting as a recurring assigned task, and a fixed weekday
 * would keep firing at the old time the first week she moves it.
 *
 * Returns null when no meeting is on, so the same three clock times can run
 * every day and simply say nothing six days a week.
 */
export async function buildMeetingReminder(
  when: "today" | "tomorrow"
): Promise<string | null> {
  const supabase = service();
  const date = when === "today" ? orgDate(0) : orgDate(1);

  const { data } = await supabase
    .from("assigned_tasks")
    .select("task_name, due_time, status")
    .eq("due_date", date)
    .ilike("task_name", "%meeting%")
    .is("deleted_at", null)
    .is("archived_at", null);

  const live = (data ?? []).filter(
    (t) => !["approved", "completed", "cancelled"].includes(String(t.status ?? ""))
  );
  if (live.length === 0) return null;

  const lines: string[] = [];
  for (const m of live) {
    const name = esc(String(m.task_name ?? "Team meeting"));
    const at = m.due_time ? ` at ${esc(String(m.due_time).slice(0, 5))}` : "";
    lines.push(
      when === "today"
        ? `🔔 <b>${name} today${at}</b>`
        : `🔔 <b>${name} tomorrow${at}</b> — ${longDate(date)}`
    );
  }

  lines.push("", "See you there.");
  return lines.join("\n");
}

/** 0 = Sunday, matching profiles.work_days. */
const DAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function fmtShift(start: string | null, end: string | null): string | null {
  if (!start) return null;
  const short = (t: string) => {
    const [h, m] = t.split(":").map(Number);
    const ap = h >= 12 ? "pm" : "am";
    const h12 = h % 12 === 0 ? 12 : h % 12;
    return m === 0 ? `${h12}${ap}` : `${h12}:${String(m).padStart(2, "0")}${ap}`;
  };
  return end ? `${short(start)}–${short(end)}` : short(start);
}

/**
 * Friday's look at the coming week's schedule.
 *
 * Thanks the people who have set theirs and names the ones who have not, in
 * that order and in that tone. Being listed under "still to add" alongside
 * everyone else's completed schedule is reminder enough; it does not need a
 * sharper word than that.
 *
 * Returns null only when nobody is active, since even a fully-set team is
 * worth confirming — the point of the post is that the week ahead is known.
 */
export async function buildSchedulePost(): Promise<string | null> {
  const supabase = service();
  const { data } = await supabase
    .from("profiles")
    .select("full_name, username, shift_start, shift_end, shift_hours, work_days, telegram_chat_id")
    .eq("is_active", true)
    .neq("role", "admin")
    .order("full_name");

  const people = data ?? [];
  if (people.length === 0) return null;

  const set: string[] = [];
  const missing: string[] = [];

  for (const p of people) {
    const who = (p.full_name as string) || (p.username as string) || "Someone";
    const shift = fmtShift(p.shift_start as string | null, p.shift_end as string | null);
    const days = Array.isArray(p.work_days) ? (p.work_days as number[]) : [];

    // A schedule counts as set when there are hours to work and days to work
    // them. Either half alone leaves the week genuinely unknown.
    const hasHours = Boolean(shift) || Boolean(p.shift_hours);
    if (hasHours && days.length > 0) {
      const dayList = days.map((d) => DAY_NAMES[d] ?? "?").join(" ");
      const hours = shift ?? `${p.shift_hours}h`;
      set.push(`• ${esc(who)} — ${esc(dayList)}, ${esc(hours)}`);
    } else {
      missing.push(mention(who, p.telegram_chat_id as number | null));
    }
  }

  const lines = ["🗓️ <b>Next week's schedule</b>"];

  if (set.length > 0) {
    lines.push("", "Thank you to everyone who has theirs in:", ...set);
  }

  if (missing.length > 0) {
    lines.push(
      "",
      `Still to add: ${missing.join(", ")}`,
      "When you have a moment, set your days and hours in MinuteFlow so the week ahead is clear for everyone."
    );
  } else {
    lines.push("", "Everyone is set for the week. Thank you.");
  }

  return lines.join("\n");
}
