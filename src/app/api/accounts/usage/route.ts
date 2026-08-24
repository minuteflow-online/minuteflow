import { createClient as createAdminClient } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import { isDateInSpan, orgDateOf, addDaysToDateStr } from "@/lib/taskSchedule";

export const dynamic = "force-dynamic";

/**
 * GET /api/accounts/usage?date=YYYY-MM-DD
 *
 * Time consumed per account, agency-wide, for the day/week/month containing
 * `date` (default today) — every VA's hours on an account count against that
 * account's one cap, since that's what a client hours cap means. Powers the
 * Calendar's account budget panel.
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
 */

type Bucket = "daily" | "weekly" | "monthly";

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

  const [{ data: accounts, error: accError }, { data: assigned, error: assignedError }, { data: fixed, error: fixedError }] =
    await Promise.all([
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
        .select("account, start_date, end_date, due_date, start_time, end_time, planned_minutes")
        .is("deleted_at", null)
        .not("account", "is", null),
      admin
        .from("fixed_pay_tasks")
        .select("account, start_date, end_date, due_date, planned_minutes")
        .is("deleted_at", null)
        .not("account", "is", null),
    ]);

  if (accError) return Response.json({ error: accError.message }, { status: 500 });
  if (assignedError) return Response.json({ error: assignedError.message }, { status: 500 });
  if (fixedError) return Response.json({ error: fixedError.message }, { status: 500 });

  // account -> bucket -> minutes
  const totals = new Map<string, Record<Bucket, number>>();
  const add = (account: string | null, bucket: Bucket, minutes: number) => {
    if (!account || minutes <= 0) return;
    const row = totals.get(account) ?? { daily: 0, weekly: 0, monthly: 0 };
    row[bucket] += minutes;
    totals.set(account, row);
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
    addFn: typeof add,
    bucketsFn: typeof bucketsForDate
  ) {
    if (minutes <= 0) return;
    if (startDate && endDate && endDate !== startDate) {
      let cursor = startDate;
      for (let i = 0; cursor <= endDate && i < MAX_SPAN_DAYS; i++, cursor = addDaysToDateStr(cursor, 1)) {
        for (const bucket of bucketsFn(cursor)) addFn(account, bucket, minutes);
      }
      return;
    }
    const anchor = startDate ?? dueDate;
    if (!anchor) return;
    for (const bucket of bucketsFn(anchor)) addFn(account, bucket, minutes);
  }

  for (const t of assigned ?? []) {
    const minutesPerOccurrence = t.start_time && t.end_time ? minutesBetween(t.start_time, t.end_time) : t.planned_minutes ?? 0;
    if (minutesPerOccurrence <= 0) continue;

    billOccurrence(t.account, minutesPerOccurrence, t.start_date, t.end_date, t.due_date, add, bucketsForDate);
  }

  for (const t of fixed ?? []) {
    const minutesPerOccurrence = t.planned_minutes ?? 0;
    // Fixed-pay tasks carry no start_time/end_time, so this is always the
    // duration-only path — same per-day billing rule as assigned_tasks' span case.
    billOccurrence(t.account, minutesPerOccurrence, t.start_date, t.end_date, t.due_date, add, bucketsForDate);
  }

  const result = (accounts ?? []).map((a) => {
    const used = totals.get(a.name) ?? { daily: 0, weekly: 0, monthly: 0 };
    return {
      id: a.id,
      name: a.name,
      daily_hours_budget: a.daily_hours_budget,
      weekly_hours_budget: a.weekly_hours_budget,
      monthly_hours_budget: a.monthly_hours_budget,
      daily_minutes: Math.round(used.daily),
      weekly_minutes: Math.round(used.weekly),
      monthly_minutes: Math.round(used.monthly),
    };
  });

  return Response.json({ date, week, month, accounts: result });
}
