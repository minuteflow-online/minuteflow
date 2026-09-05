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

/**
 * What a birthday post actually says.
 *
 * "Hope it is a good one" is what you say to an acquaintance: passive, and
 * plainly no effort. These say the thing worth saying instead — that the
 * person is valued here, by this team, by name. Toni's line: at CoVAP we
 * celebrate you. Nothing in this pool wishes; every line states.
 *
 * A pool rather than one sentence, because the same words every time stop
 * meaning anything by the third person to receive them.
 */
const BIRTHDAY_LINES = [
  "At CoVAP we celebrate you! 🎉",
  "Today we celebrate you — thank you for being one of us. 🎉",
  "CoVAP is better for having you in it, and today we say so. 🎉",
  "You matter here. At CoVAP we celebrate you today. 🎉",
  "Today CoVAP celebrates you — not the work, you. 🎉",
  "This team is stronger because you are in it. We celebrate you. 🎉",
  "At CoVAP we are grateful you are part of this, today most of all. 🎉",
  "We are celebrating you today, and everything you bring to this team. 🎉",
];

/** Anniversaries get their own pool. Staying for years is a different thing
 *  from having a birthday, and deserves different words. */
const ANNIVERSARY_LINES = [
  "Thank you for every one of them. CoVAP is what it is because you stayed.",
  "Thank you for the years you have given this team.",
  "CoVAP has grown with you in it, and we are glad you are still here.",
  "Years of showing up. That is not a small thing — thank you.",
  "Thank you for choosing to stay. It matters more than you know.",
];

function pickLine(pool: string[]): string {
  return pool[Math.floor(Math.random() * pool.length)];
}

/**
 * Birthdays and work anniversaries, on their own.
 *
 * These used to be the first lines of the daily digest, above "Due tomorrow".
 * Rhealin's birthday went out on 2026-09-05 stacked on top of four content
 * deadlines, which is not how you tell someone their birthday matters. A
 * celebration sharing a message with a to-do list reads as an agenda item.
 *
 * So it is posted separately, before the digest, and the digest no longer
 * mentions either. Nothing else changes — same people, same day, same wording.
 */
export async function buildCelebrations(kind: DigestKind): Promise<{
  text: string;
  birthdayPeople: string[];
} | null> {
  // The scheduled run only ever asks for "tomorrow" — sent the night before,
  // Eastern, so it lands on the morning of the day itself in Manila. "today"
  // exists for a resend on the day, when the scheduled one went out wrong.
  const date = kind === "today" ? orgDate(0) : orgDate(1);
  const [birthdays, anniversaries] = await Promise.all([
    birthdaysOn(date),
    anniversariesOn(date),
  ]);
  if (birthdays.length === 0 && anniversaries.length === 0) return null;

  const lines: string[] = [];

  for (const p of birthdays) {
    const who = (p.full_name as string) || (p.username as string) || "Someone";
    lines.push(
      `🎂 <b>Happy birthday, ${mention(who, p.telegram_chat_id as number | null)}!</b>`,
      "",
      pickLine(BIRTHDAY_LINES)
    );
  }

  for (const p of anniversaries) {
    if (lines.length > 0) lines.push("");
    const who = (p.full_name as string) || (p.username as string) || "Someone";
    lines.push(
      `🎉 <b>${mention(who, p.telegram_chat_id as number | null)}</b> — ${p.years} year${p.years === 1 ? "" : "s"} with CoVAP today.`,
      "",
      pickLine(ANNIVERSARY_LINES)
    );
  }

  return {
    text: lines.join("\n"),
    birthdayPeople: birthdays.map(
      (p) => (p.full_name as string) || (p.username as string) || "Someone"
    ),
  };
}

/**
 * A private note to Toni that someone's day is coming.
 *
 * The team greeting fires on its own the evening before, which is their
 * morning. She wanted three days of warning ahead of that, so there is time
 * to arrange something — a card, a gift, a word of her own — rather than
 * finding out when the bot posts.
 *
 * Goes to her chat only. A heads-up in the team room would spoil the thing it
 * is warning her about.
 */
const HEADS_UP_LEAD_DAYS = 3;

export async function buildBirthdayHeadsUp(): Promise<string | null> {
  const date = orgDate(HEADS_UP_LEAD_DAYS);
  const [birthdays, anniversaries] = await Promise.all([
    birthdaysOn(date),
    anniversariesOn(date),
  ]);
  if (birthdays.length === 0 && anniversaries.length === 0) return null;

  const lines: string[] = ["🎂 <b>Heads-up</b>", ""];

  for (const p of birthdays) {
    const who = (p.full_name as string) || (p.username as string) || "Someone";
    lines.push(`It is <b>${esc(who)}</b>'s birthday on ${longDate(date)}.`);
  }
  for (const p of anniversaries) {
    const who = (p.full_name as string) || (p.username as string) || "Someone";
    lines.push(
      `<b>${esc(who)}</b> reaches ${p.years} year${p.years === 1 ? "" : "s"} with CoVAP on ${longDate(date)}.`
    );
  }

  lines.push(
    "",
    "<i>The team chat gets its greeting automatically the evening before, which is their morning. This is just so you know it is coming.</i>"
  );
  return lines.join("\n");
}
/** Builds the message, or null when there is nothing worth saying. A digest
 *  that only ever says "nothing today" trains people to stop reading it. */
export async function buildTeamDigest(kind: DigestKind): Promise<{
  text: string;
  birthdayPeople: string[];
} | null> {
  const date = kind === "today" ? orgDate(0) : orgDate(1);
  // Birthdays and anniversaries are deliberately absent — buildCelebrations
  // posts those on their own, so they are not read as agenda items.
  const [due, off] = await Promise.all([dueOn(date), offOn(date)]);

  if (due.length === 0 && off.length === 0) {
    return null;
  }

  const lines: string[] = [
    kind === "today"
      ? `📅 <b>${longDate(date)}</b>`
      : `🌙 <b>Tomorrow — ${longDate(date)}</b>`,
  ];

  if (due.length > 0) {
    lines.push("", kind === "today" ? "<b>Due today</b>" : "<b>Due tomorrow</b>");
    for (const t of due.slice(0, 15)) {
      const where = [t.account, t.project].filter(Boolean).join(" / ");
      // Same 12-hour form the meeting reminder uses. "at 15:00" reads as a
      // timestamp, and half the team is twelve hours from Eastern.
      const at = t.due_time ? ` at ${esc(meetingClock(String(t.due_time)))}` : "";
      lines.push(`• ${esc(String(t.task_name ?? "a task"))}${at}${where ? ` — ${esc(where)}` : ""}`);
    }
    if (due.length > 15) lines.push(`…and ${due.length - 15} more`);
  }

  if (off.length > 0) {
    lines.push("", `🌴 <b>Away</b>: ${esc(off.join(", "))}`);
  }

  return { text: lines.join("\n"), birthdayPeople: [] };
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
/** "6:00 AM" from a stored "06:00:00". A bare 24-hour clock reads as a
 *  timestamp, not an appointment, and half the team is twelve hours away. */
export function meetingClock(dueTime: string): string {
  const [hourText, minuteText] = String(dueTime).split(":");
  const hour = Number(hourText);
  const minute = Number(minuteText ?? 0);
  if (!Number.isFinite(hour)) return String(dueTime).slice(0, 5);
  const suffix = hour >= 12 ? "PM" : "AM";
  const hour12 = hour % 12 === 0 ? 12 : hour % 12;
  return `${hour12}:${String(minute).padStart(2, "0")} ${suffix} ET`;
}

export interface MeetingReminder {
  /** The group post, mentions and all. */
  groupMessage: string;
  /** The same meeting said to one person, with no @everyone. */
  personalMessage: string;
}

export async function buildMeetingReminder(
  when: "today" | "tomorrow"
): Promise<MeetingReminder | null> {
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
    const at = m.due_time ? ` at ${esc(meetingClock(String(m.due_time)))}` : "";
    lines.push(
      when === "today"
        ? `🔔 <b>${name} today${at}</b>`
        : `🔔 <b>${name} tomorrow${at}</b> — ${longDate(date)}`
    );
  }

  return {
    // The one scheduled team post that everybody has to act on, so it pings the
    // room. The birthdays, recaps and digests deliberately do not — a chat that
    // notifies for everything is a chat people mute, and then they miss this.
    groupMessage: [...lines, "", "@everyone", "", "See you there."].join("\n"),
    // No @everyone in a message to one person: it would ping the whole team
    // from inside a private chat, or read as a broadcast pasted at them.
    personalMessage: [...lines, "", "See you there."].join("\n"),
  };
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
 * Celebrates whoever has set theirs, by name, and nudges whoever has not.
 * Praise first and always: being listed after everyone else's finished
 * calendar is reminder enough, so the nudge can stay light rather than
 * carrying any weight of its own.
 *
 * The wording rotates. A weekly post with identical text becomes one people
 * scroll past by the third week, and then the week someone genuinely needs to
 * act they scroll past that too.
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

  // Varied so a weekly post does not become one block of text people stop
  // seeing. Praise first and by name; the nudge after, light enough that
  // being on it is not a telling-off.
  const PRAISE = [
    "⭐ Locked in and ready:",
    "🙌 These legends are all set:",
    "✅ Calendars in, week sorted:",
    "💪 Ready to go:",
    "🎯 All set for the week:",
  ];
  const NUDGE = [
    "👀 Still a blank canvas for:",
    "🫣 Quietly missing from the calendar:",
    "📭 Empty diary alert:",
    "🔍 We cannot find a calendar for:",
    "⏳ Waiting on:",
  ];
  const CLOSER = [
    "Two minutes in your Portal and you are on the list too. 😄",
    "Pop your days and hours in and you will be up there next week!",
    "Sneak into your Portal and fill it in — we would love to see you on the list.",
    "A quick trip to your Portal is all it takes. We will save you a spot. ✨",
  ];
  const ALL_IN = [
    "🎉 Every single calendar is in. Look at this team!",
    "🏆 A clean sweep — everyone is set for the week. Brilliant.",
    "✨ Full house! Every calendar in. Thank you, all of you.",
  ];
  const pick = (a: string[]) => a[Math.floor(Math.random() * a.length)];

  const lines = ["🗓️ <b>Next week's schedule</b>"];

  if (set.length > 0) {
    lines.push("", pick(PRAISE), ...set);
  }

  if (missing.length > 0) {
    lines.push("", `${pick(NUDGE)} ${missing.join(", ")}`, pick(CLOSER));
  } else if (set.length > 0) {
    lines.push("", pick(ALL_IN));
  }

  return lines.join("\n");
}

/**
 * Work whose due date has passed and which nobody has closed.
 *
 * Named per person rather than as a count, because "7 tasks overdue" tells the
 * team a number and tells nobody what to do. Kept to the group deliberately —
 * this is coordination, not a reprimand, and the wording stays flat: no "still
 * not done", no exclamation marks.
 *
 * Anything overdue by more than a fortnight is left out of the daily line. Work
 * that old is a planning conversation, not something a morning reminder will
 * move, and carrying it forever makes the list unreadable.
 */
const OVERDUE_HORIZON_DAYS = 14;

export async function buildOverdue(): Promise<string | null> {
  const supabase = service();
  const today = orgDate(0);
  const horizon = orgDate(-OVERDUE_HORIZON_DAYS);

  const { data } = await supabase
    .from("assigned_tasks")
    .select("id, task_name, due_date, account, project, status")
    .lt("due_date", today)
    .gte("due_date", horizon)
    .is("deleted_at", null)
    .is("archived_at", null)
    .order("due_date", { ascending: true });

  const open = (data ?? []).filter(
    (t) => !["approved", "completed", "cancelled"].includes(String(t.status ?? ""))
  );
  if (open.length === 0) return null;

  // Who each one belongs to, so the line reaches the person holding it.
  const { data: assignees } = await supabase
    .from("assigned_task_assignees")
    .select("assigned_task_id, va_id")
    .in("assigned_task_id", open.map((t) => t.id));

  const ids = [...new Set((assignees ?? []).map((a) => a.va_id as string))];
  const { data: profs } = ids.length
    ? await supabase.from("profiles").select("id, full_name, username, telegram_chat_id").in("id", ids)
    : { data: [] };

  const byId = new Map((profs ?? []).map((p) => [p.id as string, p]));
  const ownerOf = new Map<number, string[]>();
  for (const a of assignees ?? []) {
    const list = ownerOf.get(a.assigned_task_id as number) ?? [];
    list.push(a.va_id as string);
    ownerOf.set(a.assigned_task_id as number, list);
  }

  const lines = ["⏰ <b>Past due</b>", ""];
  for (const t of open.slice(0, 15)) {
    const owners = (ownerOf.get(t.id as number) ?? [])
      .map((id) => {
        const p = byId.get(id);
        const name = (p?.full_name as string) || (p?.username as string) || "Unassigned";
        return mention(name, (p?.telegram_chat_id as number | null) ?? null);
      })
      .join(", ");
    const since = longDate(String(t.due_date));
    lines.push(`• ${esc(String(t.task_name ?? "a task"))} — due ${esc(since)}${owners ? ` · ${owners}` : ""}`);
  }
  if (open.length > 15) lines.push(`…and ${open.length - 15} more`);

  lines.push("", "If any of these have moved on, update the due date so the list stays honest.");
  return lines.join("\n");
}

/**
 * Work sitting unclaimed, so it does not quietly wait for someone to notice it.
 *
 * Each line says whether the task is time-based or output-based, because that
 * decides who can take it and how they are paid for it — a VA scanning the list
 * needs it before deciding whether the task is theirs to claim at all.
 *
 * The distinction lives in fixed_pay_task_id rather than a billing column:
 * a task linked to a fixed-pay item is output-based, everything else is hourly.
 * That is the same test AvailableTasksWidget uses to decide which list a task
 * belongs in, and the two must not disagree.
 */
export async function buildUnclaimed(): Promise<string | null> {
  const supabase = service();

  const { data } = await supabase
    .from("assigned_tasks")
    .select("id, task_name, account, project, due_date, fixed_pay_task_id")
    .eq("status", "unassigned")
    .is("deleted_at", null)
    .is("archived_at", null)
    .order("due_date", { ascending: true, nullsFirst: false });

  const open = data ?? [];
  if (open.length === 0) return null;

  const lines = [
    `🙋 <b>Up for grabs</b> — ${open.length} task${open.length === 1 ? "" : "s"} waiting`,
    "",
  ];

  for (const t of open.slice(0, 15)) {
    const kind = t.fixed_pay_task_id ? "💰 Output-based" : "⏱️ Time-based";
    const where = [t.account, t.project].filter(Boolean).join(" / ");
    const due = t.due_date ? ` · due ${esc(longDate(String(t.due_date)))}` : "";
    lines.push(
      `• ${esc(String(t.task_name ?? "a task"))} — ${kind}${where ? ` · ${esc(where)}` : ""}${due}`
    );
  }
  if (open.length > 15) lines.push(`…and ${open.length - 15} more`);

  lines.push("", "Claim anything you can take on: https://minuteflow.click/dashboard");
  return lines.join("\n");
}
