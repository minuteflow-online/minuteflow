import { NextRequest, NextResponse } from "next/server";
import { checkInternalPin, serviceClient } from "../../../../../_internalAuth";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest, { params }: { params: Promise<{ userId: string; date: string }> }) {
  const denied = checkInternalPin(request);
  if (denied) return denied;

  const { userId, date } = await params;
  const supabase = serviceClient();
  const { data, error } = await supabase
    .from("time_logs")
    .select("id, task_name, project, category, client_name, start_time, end_time, duration_ms, client_memo, is_manual")
    .eq("user_id", userId)
    .eq("session_date", date)
    .order("start_time");
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ userId, date, entries: data });
}
