import { NextRequest, NextResponse } from "next/server";
import { checkInternalPin, serviceClient } from "../../../_internalAuth";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest, { params }: { params: Promise<{ userId: string }> }) {
  const denied = checkInternalPin(request);
  if (denied) return denied;

  const { userId } = await params;
  const month = new URL(request.url).searchParams.get("month");
  if (!month || !/^\d{4}-\d{2}$/.test(month)) {
    return NextResponse.json({ error: "month must be YYYY-MM" }, { status: 400 });
  }
  const supabase = serviceClient();
  const start = `${month}-01`;
  const [y, m] = month.split("-").map(Number);
  const end = `${month}-${String(new Date(y, m, 0).getDate()).padStart(2, "0")}`;

  const { data: logs, error: logsErr } = await supabase
    .from("time_logs")
    .select("id, session_date")
    .eq("user_id", userId)
    .gte("session_date", start)
    .lte("session_date", end);
  if (logsErr) return NextResponse.json({ error: logsErr.message }, { status: 500 });

  const byDay: Record<string, number[]> = {};
  for (const row of logs || []) {
    if (!row.session_date) continue;
    (byDay[row.session_date] ||= []).push(row.id);
  }
  const allIds = (logs || []).map((r) => r.id);

  let shotDays = new Set<string>();
  if (allIds.length) {
    const { data: shots, error: shotsErr } = await supabase.from("task_screenshots").select("log_id").in("log_id", allIds);
    if (shotsErr) return NextResponse.json({ error: shotsErr.message }, { status: 500 });
    const logIdToDay: Record<number, string> = {};
    for (const [day, ids] of Object.entries(byDay)) for (const id of ids) logIdToDay[id] = day;
    shotDays = new Set((shots || []).map((s) => (s.log_id ? logIdToDay[s.log_id] : null)).filter(Boolean) as string[]);
  }

  const days = Object.keys(byDay).map((date) => ({ date, hasTime: true, hasScreenshots: shotDays.has(date) }));
  return NextResponse.json({ userId: userId, month, days });
}
