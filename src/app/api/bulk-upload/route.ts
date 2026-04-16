import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

/**
 * POST /api/bulk-upload
 * Body JSON: { type: "expenses" | "time_logs", rows: Array<Record<string, string>> }
 *
 * Validates rows and inserts them into the appropriate table.
 * Returns { inserted: number, errors: Array<{ row: number, message: string }> }
 */
export async function POST(request: Request) {
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      return Response.json({ error: "Unauthorized" }, { status: 401 });
    }

    // Check admin
    const { data: profile } = await supabase
      .from("profiles")
      .select("role")
      .eq("id", user.id)
      .single();
    if (profile?.role !== "admin") {
      return Response.json({ error: "Forbidden" }, { status: 403 });
    }

    let body: { type?: string; rows?: Record<string, string>[] };
    try {
      body = await request.json();
    } catch {
      return Response.json({ error: "Invalid JSON in request body" }, { status: 400 });
    }
    const { type, rows } = body as { type: string; rows: Record<string, string>[] };

    if (!type || !rows || !Array.isArray(rows) || rows.length === 0) {
      return Response.json({ error: "Missing type or rows" }, { status: 400 });
    }

    if (type === "expenses") {
      return handleExpenses(supabase, rows);
    } else if (type === "time_logs") {
      return handleTimeLogs(supabase, rows);
    } else {
      return Response.json({ error: `Unknown type: ${type}` }, { status: 400 });
    }
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    const errStack = err instanceof Error ? err.stack : "";
    console.error("Bulk upload error:", errMsg, errStack);
    return Response.json(
      { error: `Server error: ${errMsg}`, inserted: 0, errors: [] },
      { status: 500 }
    );
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function handleExpenses(supabase: any, rows: Record<string, string>[]) {
  const errors: { row: number; message: string }[] = [];
  const valid: {
    description: string;
    amount: number;
    expense_date: string;
    category: string;
    account: string | null;
    is_reimbursable: boolean;
    notes: string | null;
  }[] = [];

  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    const rowNum = i + 1; // 1-indexed for user-facing errors

    // Skip blank rows or rows where all values are empty/whitespace
    const allValues = Object.values(r);
    if (allValues.length === 0 || allValues.every((v) => !(v || "").trim())) continue;

    // Skip rows missing all required fields (description AND amount AND date) — treat as junk data
    const desc_check = (r.description || "").trim();
    const amt_check = (r.amount || "").trim();
    const date_check_exp = (r.expense_date || r.date || "").trim();
    if (!desc_check && !amt_check && !date_check_exp) continue;

    // description (required)
    const description = (r.description || "").trim();
    if (!description) {
      errors.push({ row: rowNum, message: "Description is required" });
      continue;
    }

    // amount (required, must be > 0)
    const amount = parseFloat(r.amount);
    if (isNaN(amount) || amount <= 0) {
      errors.push({ row: rowNum, message: `Invalid amount: "${r.amount}"` });
      continue;
    }

    // expense_date (required, must be a valid date)
    const dateStr = (r.expense_date || r.date || "").trim();
    if (!dateStr || !/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
      errors.push({ row: rowNum, message: `Invalid date format (use YYYY-MM-DD): "${dateStr}"` });
      continue;
    }

    // category (optional, default "other")
    const category = (r.category || "other").trim().toLowerCase();

    // account (optional)
    const account = (r.account || "").trim() || null;

    // is_reimbursable (optional, boolean-like)
    const reimbStr = (r.is_reimbursable || r.reimbursable || "").trim().toLowerCase();
    const is_reimbursable = ["true", "yes", "1", "y"].includes(reimbStr);

    // notes (optional)
    const notes = (r.notes || "").trim() || null;

    valid.push({ description, amount, expense_date: dateStr, category, account, is_reimbursable, notes });
  }

  if (valid.length === 0) {
    return Response.json({ inserted: 0, errors });
  }

  const { error: insertError } = await supabase.from("financial_expenses").insert(valid);
  if (insertError) {
    return Response.json({ error: `Database insert failed: ${insertError.message}`, inserted: 0, errors }, { status: 500 });
  }

  return Response.json({ inserted: valid.length, errors });
}

/**
 * Normalize a date string to YYYY-MM-DD.
 * Handles DD/MM/YY and DD/MM/YYYY formats (e.g. from Notion exports).
 */
function normalizeDate(dateStr: string): string {
  // DD/MM/YY → YYYY-MM-DD
  const ddmmyy = dateStr.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2})$/);
  if (ddmmyy) {
    const [, dd, mm, yy] = ddmmyy;
    const year = parseInt(yy) >= 50 ? `19${yy}` : `20${yy}`;
    return `${year}-${mm.padStart(2, "0")}-${dd.padStart(2, "0")}`;
  }
  // DD/MM/YYYY → YYYY-MM-DD
  const ddmmyyyy = dateStr.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (ddmmyyyy) {
    const [, dd, mm, yyyy] = ddmmyyyy;
    return `${yyyy}-${mm.padStart(2, "0")}-${dd.padStart(2, "0")}`;
  }
  return dateStr; // already YYYY-MM-DD or other format, pass through
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function handleTimeLogs(supabase: any, rows: Record<string, string>[]) {
  const errors: { row: number; message: string }[] = [];
  const valid: {
    user_id: string;
    username: string;
    full_name: string;
    task_name: string;
    category: string;
    account: string | null;
    project: string | null;
    client_name: string | null;
    start_time: string;
    end_time: string;
    duration_ms: number;
    billable: boolean;
    client_memo: string | null;
    internal_memo: string | null;
    is_manual: boolean;
  }[] = [];

  // Fetch profiles to validate VA names
  const { data: profiles } = await supabase
    .from("profiles")
    .select("id, full_name, username")
    .eq("is_active", true);
  const profileMap = new Map<string, { id: string; full_name: string; username: string }>();
  (profiles || []).forEach((p: { id: string; full_name: string; username: string }) => {
    profileMap.set(p.full_name.toLowerCase(), p);
    if (p.username) profileMap.set(p.username.toLowerCase(), p);
  });

  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    const rowNum = i + 1;

    // Skip blank rows or rows where all values are empty/whitespace
    const allValues = Object.values(r);
    if (allValues.length === 0 || allValues.every((v) => !(v || "").trim())) continue;

    // Skip rows missing all required fields (va_name AND task_name AND date) — treat as junk data
    const vaName_check = (r.va_name || r.full_name || r.name || "").trim();
    const task_check = (r.task_name || r.task || "").trim();
    const date_check = (r.date || "").trim();
    if (!vaName_check && !task_check && !date_check) continue;

    // va_name (required) - match against profiles
    const vaName = (r.va_name || r.full_name || r.name || "").trim();
    const matchedProfile = profileMap.get(vaName.toLowerCase());
    if (!vaName || !matchedProfile) {
      errors.push({ row: rowNum, message: `Unknown VA name: "${vaName}". Must match a profile.` });
      continue;
    }

    // task_name (required)
    const task_name = (r.task_name || r.task || "").trim();
    if (!task_name) {
      errors.push({ row: rowNum, message: "Task name is required" });
      continue;
    }

    // category (optional, default "Task")
    const category = (r.category || "Task").trim();

    // account (optional)
    const account = (r.account || "").trim() || null;

    // project (optional)
    const project = (r.project || "").trim() || null;

    // client_name (optional)
    const client_name = (r.client_name || r.client || "").trim() || null;

    // date + start_time + end_time OR date + duration_hours
    const dateStr = normalizeDate((r.date || "").trim());
    const startStr = (r.start_time || "").trim();
    const endStr = (r.end_time || "").trim();
    const durationHoursStr = (r.duration_hours || r.hours || "").trim();

    let start_time: string;
    let end_time: string;
    let duration_ms: number;

    if (dateStr && startStr && endStr) {
      // Full date + time provided — use space separator (not T) so AM/PM parses correctly
      const startRaw = `${dateStr} ${startStr}`;
      const endRaw = `${dateStr} ${endStr}`;
      const startMs = new Date(startRaw).getTime();
      let endMs = new Date(endRaw).getTime();
      if (isNaN(startMs) || isNaN(endMs)) {
        errors.push({ row: rowNum, message: `Invalid date/time: ${dateStr} ${startStr} - ${endStr}` });
        continue;
      }
      // Handle overnight spans (e.g., 11:36 PM → 12:31 AM) — add 1 day to end
      // Use strict < so identical start/end (0-duration entries like Clock Out) stay at 0ms
      if (endMs < startMs) {
        endMs += 86400000; // +24 hours
      }
      start_time = new Date(startMs).toISOString();
      end_time = new Date(endMs).toISOString();
      duration_ms = endMs - startMs;
    } else if (dateStr && startStr && !endStr && durationHoursStr) {
      // Start time + duration but no end time — calculate end from duration
      const startRaw = `${dateStr} ${startStr}`;
      const startMs = new Date(startRaw).getTime();
      if (isNaN(startMs)) {
        errors.push({ row: rowNum, message: `Invalid start time: ${dateStr} ${startStr}` });
        continue;
      }
      const hours = parseFloat(durationHoursStr);
      if (isNaN(hours) || hours <= 0) {
        errors.push({ row: rowNum, message: `Invalid duration_hours: "${durationHoursStr}"` });
        continue;
      }
      duration_ms = Math.round(hours * 3600000);
      start_time = new Date(startMs).toISOString();
      end_time = new Date(startMs + duration_ms).toISOString();
    } else if (dateStr && durationHoursStr) {
      // Date + duration in hours only (no start/end times)
      const hours = parseFloat(durationHoursStr);
      if (isNaN(hours) || hours <= 0) {
        errors.push({ row: rowNum, message: `Invalid duration_hours: "${durationHoursStr}"` });
        continue;
      }
      duration_ms = Math.round(hours * 3600000);
      // Default to 9am start, use space separator for AM/PM safety
      const startRaw = `${dateStr} 09:00:00`;
      const startMs = new Date(startRaw).getTime();
      if (isNaN(startMs)) {
        errors.push({ row: rowNum, message: `Invalid date: "${dateStr}"` });
        continue;
      }
      start_time = new Date(startMs).toISOString();
      end_time = new Date(startMs + duration_ms).toISOString();
    } else {
      errors.push({ row: rowNum, message: "Need either (date + start_time + end_time) or (date + duration_hours)" });
      continue;
    }

    // billable (optional, default true)
    const billableStr = (r.billable || "true").trim().toLowerCase();
    const billable = !["false", "no", "0", "n"].includes(billableStr);

    // memos (optional)
    const client_memo = (r.client_memo || "").trim() || null;
    const internal_memo = (r.internal_memo || r.memo || r.notes || "").trim() || null;

    valid.push({
      user_id: matchedProfile.id,
      username: matchedProfile.username,
      full_name: matchedProfile.full_name,
      task_name,
      category,
      account,
      project,
      client_name,
      start_time,
      end_time,
      duration_ms,
      billable,
      client_memo,
      internal_memo,
      is_manual: true,
    });
  }

  if (valid.length === 0) {
    return Response.json({ inserted: 0, errors });
  }

  // Insert rows one at a time so partial successes are saved and per-row errors are reported
  let inserted = 0;
  for (let i = 0; i < valid.length; i++) {
    const row = valid[i];
    const { error: insertError } = await supabase.from("time_logs").insert(row);
    if (insertError) {
      console.error(`Bulk upload row ${i + 1} insert failed:`, insertError.message, JSON.stringify(row));
      errors.push({ row: i + 1, message: `Database insert failed: ${insertError.message}` });
    } else {
      inserted++;
    }
  }

  const status = inserted === 0 && errors.length > 0 ? 500 : 200;
  return Response.json({ inserted, errors }, { status });
}
