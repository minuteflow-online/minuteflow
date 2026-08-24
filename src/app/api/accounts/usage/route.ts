import { createClient as createAdminClient } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import { isDateInSpan, orgDateOf, addDaysToDateStr } from "@/lib/taskSchedule";

export const dynamic = "force-dynamic";

/**
 * GET /api/accounts/usage?date=YYYY-MM-DD
 *
 * Time consumed per account, agency-wide, for the day/week/month containing
 * `date` (default today) — every VA's hours on an account count against that
 * account's one cap, since that's what a client hours cap means. Also breaks
 * each account's total down by VA, so "how much of TAT Foundation's week did
 * Arianne use" has an answer. Powers the Calendar's account budget panel.
 * Informational only — nothing here enforces the cap; a VA can still book
 * past it, the badge just goes terracotta.
 *
 * A task counts the way the Calendar's own day totals do, with one deliberate
 * difference: scheduled hours (start_time/end_time) measure their actual daily
 * window, and a multi-day span bills that same per-day window to every day it
 * spans. A duration-only task counts ONCE, on start_date if it has one, else
 * due_date — never both. The Calendar's single-day view checks
 * `start_date === day || due_date === day` independently per day, which is
 * fine for one day at a time but double-bills a task across a week/month total
 * when its start and due dates differ. Consumed-against-a-cap has to be
 * accurate, so this endpoint picks one anchor instead of reproducing that.
 *
 * The per-VA breakdown is a looser number than the account total: a task with
 * several assignees (assigned_task_assignees supports more than one) credits
 * its full duration to EACH assignee, since "how much of this did Arianne
 * personally spend" doesn't shrink just because someone else was also on it —
 * so the by-VA rows can sum to more than the account total on a shared task.
 * A fixed-pay task nobody has claimed yet still counts toward the account
 * total but attributes to no VA, for the same reason.
 */

type Bucket = "daily" | "weekly" | "monthly";
type BucketMinutes = Record<Bucket, number>;

function emptyBucket(): BucketMinutes {
  return { daily: 0, weekly: 0, monthly: 0 };
}

function minutesBetween(startIso: string, endIso: string): number {
  return (new Date(endIso).getTime() - new Date(startIso).getTime()) / 60000;
}

// Sunday-start week, same definition buildWeekGrid/weekDates use elsewhere on
// the Calendar — so "this week's" total here matches what the Week view shows.
function weekBounds(dateStr: string): { start: string; end: string } {
  const back = new Date(`${dateStr}T00:00:00Z`).getUTCDay();
  const start = addDaysToDateStr(dateStr, -back);
  return { start, end: addDaysToDateStr(start, 6) };
}

function monthBounds(dateStr: string): { start: string; end: string } {
  const [y, m] = dateStr.split("-").map(Number);
  const start = `${y}-${String(m).padStart(2, "0")}-01`;
  const lastDay = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const end = `${y}-${String(m).padStart(2, "0")}-${String(lastDay).padStart(2, "0")}`;
  return { start, end };
}

export async function GET(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const date = searchParams.get("date") || orgDateOf(new Date().toISOString());

  const week = weekBounds(date);
  const month = monthBounds(date);

  const admin = createAdminClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  );

  const [
    { data: accounts, error: accError },
    { data: assigned, error: assignedError },
    { data: fixed, error: fixedError },
    { data: profiles, error: profilesError },
  ] = await Promise.all([
    admin
      .from("accounts")
      .select("id, name, active, daily_hours_budget, weekly_hours_budget, monthly_hours_budget")
      .eq("active", true)
      .order("name"),
    // Date-filtered in JS below rather than in the query: a task with no
    // start_date (due-date-only, or a duration-only task anchored on its due
    // date) still needs to count, and expressing "start_date OR due_date
    // falls in range" as a Postgrest filter is easy to get subtly wrong. At
    // ~1,500 non-deleted rows org-wide this is cheap enough to just pull and
    // bucket client-side.
    admin
      .from("assigned_tasks")
      .select("account, start_date, end_date, due_date, start_time, end_time, planned_minutes, assigned_task_assignees(va_id)")
      .is("deleted_at", null)
      .not("account", "is", null),
    admin
      .from("fixed_pay_tasks")
      .select("account, start_date, end_date, due_date, planned_minutes, claimed_by")
      .is("deleted_at", null)
      .not("account", "is", null),
    admin.from("profiles").select("id, full_name, username"),
  ]);

  if (accError) return Response.json({ error: accError.message }, { status: 500 });
  if (assignedError) return Response.json({ error: assignedError.message }, { status: 500 });
  if (fixedError) return Response.json({ error: fixedError.message }, { status: 500 });
  if (profilesError) return Response.json({ error: profilesError.message }, { status: 500 });

  const nameById = new Map((profiles ?? []).map((p) => [p.id, p.full_name || p.username || p.id]));

  // account -> bucket -> minutes, and account -> va_id -> bucket -> minutes
  const totals = new Map<string, BucketMinutes>();
  const byVa = new Map<string, Map<string, BucketMinutes>>();

  const add = (account: string | null, bucket: Bucket, minutes: number, vaIds: string[]) => {
    if (!account || minutes <= 0) return;
    const row = totals.get(account) ?? emptyBucket();
    row[bucket] += minutes;
    totals.set(account, row);

    if (vaIds.length === 0) return;
    const vaMap = byVa.get(account) ?? new Map<string, BucketMinutes>();
    for (const vaId of vaIds) {
      const vaRow = vaMap.get(vaId) ?? emptyBucket();
      vaRow[bucket] += minutes;
      vaMap.set(vaId, vaRow);
    }
    byVa.set(account, vaMap);
  };

  const bucketsForDate = (d: string): Bucket[] => {
    const out: Bucket[] = [];
    if (d === date) out.push("daily");
    if (isDateInSpan(d, week.start, week.end)) out.push("weekly");
    if (isDateInSpan(d, month.start, month.end)) out.push("monthly");
    return out;
  };

  // One row can bill several days (a multi-day span) or just its one anchor
  // day. Capped at a year of iteration so a malformed end_date can't spin —
  // nothing legitimate spans that long.
  const MAX_SPAN_DAYS = 366;
  function billOccurrence(
    account: string | null,
    minutes: number,
    startDate: string | null,
    endDate: string | null,
    dueDate: string | null,
    vaIds: string[]
  ) {
    if (minutes <= 0) return;
    // Same guard the Calendar itself uses everywhere else (taskSchedule.ts's
    // isDateInSpan, and the two span checks in the Calendar page) — NOT a bare
    // inequality. Recurring occurrences can carry a stale end_date frozen at
    // generation time that ends up earlier than the occurrence's own
    // start_date (recurringOccurrences.ts always writes the TEMPLATE's
    // end_date, never advances it per-occurrence) — `!==` would read that as
    // a span and loop zero times, silently dropping the task's minutes.
    if (startDate && endDate && endDate > startDate) {
      let cursor = startDate;
      for (let i = 0; cursor <= endDate && i < MAX_SPAN_DAYS; i++, cursor = addDaysToDateStr(cursor, 1)) {
        for (const bucket of bucketsForDate(cursor)) add(account, bucket, minutes, vaIds);
      }
      return;
    }
    const anchor = startDate ?? dueDate;
    if (!anchor) return;
    for (const bucket of bucketsForDate(anchor)) add(account, bucket, minutes, vaIds);
  }

  for (const t of assigned ?? []) {
    const minutesPerOccurrence = t.start_time && t.end_time ? minutesBetween(t.start_time, t.end_time) : t.planned_minutes ?? 0;
    if (minutesPerOccurrence <= 0) continue;
    const vaIds = (t.assigned_task_assignees ?? []).map((a: { va_id: string }) => a.va_id).filter(Boolean);
    billOccurrence(t.account, minutesPerOccurrence, t.start_date, t.end_date, t.due_date, vaIds);
  }

  for (const t of fixed ?? []) {
    const minutesPerOccurrence = t.planned_minutes ?? 0;
    // Fixed-pay tasks carry no start_time/end_time, so this is always the
    // duration-only path — same per-day billing rule as assigned_tasks' span case.
    const vaIds = t.claimed_by ? [t.claimed_by] : [];
    billOccurrence(t.account, minutesPerOccurrence, t.start_date, t.end_date, t.due_date, vaIds);
  }

  const round = (b: BucketMinutes) => ({
    daily: Math.round(b.daily),
    weekly: Math.round(b.weekly),
    monthly: Math.round(b.monthly),
  });

  const result = (accounts ?? []).map((a) => {
    const used = round(totals.get(a.name) ?? emptyBucket());
    const vaMap = byVa.get(a.name);
    const byVaList = vaMap
      ? Array.from(vaMap.entries())
          .map(([vaId, minutes]) => ({ va_id: vaId, va_name: nameById.get(vaId) ?? "Unknown", ...round(minutes) }))
          .sort((x, y) => y.weekly - x.weekly || y.monthly - x.monthly || y.daily - x.daily)
      : [];
    return {
      id: a.id,
      name: a.name,
      daily_hours_budget: a.daily_hours_budget,
      weekly_hours_budget: a.weekly_hours_budget,
      monthly_hours_budget: a.monthly_hours_budget,
      daily_minutes: used.daily,
      weekly_minutes: used.weekly,
      monthly_minutes: used.monthly,
      by_va: byVaList,
    };
  });

  return Response.json({ date, week, month, accounts: result });
}
