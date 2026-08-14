import { createClient } from "@supabase/supabase-js";
import { requireFinancialAccess as verifyAdmin } from "@/lib/financialAccessServer";

export const dynamic = "force-dynamic";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;

function adminClient() {
  return createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

/** GET ?user_id=... — rate history for a user, newest first */
export async function GET(request: Request) {
  const authResult = await verifyAdmin();
  if (authResult instanceof Response) return authResult;

  const { searchParams } = new URL(request.url);
  const userId = searchParams.get("user_id");
  if (!userId) {
    return Response.json({ error: "user_id is required" }, { status: 400 });
  }

  const { data, error } = await adminClient()
    .from("pay_rate_history")
    .select("*")
    .eq("user_id", userId)
    .order("effective_date", { ascending: false });

  if (error) {
    return Response.json({ error: error.message }, { status: 400 });
  }
  return Response.json({ history: data || [] });
}

/**
 * POST { user_id, rate_amount, rate_type, effective_date }
 * Adds a new rate: closes the currently-open history row
 * (end_date = effective_date - 1 day), inserts the new row,
 * and syncs profiles.pay_rate / pay_rate_type.
 */
export async function POST(request: Request) {
  const authResult = await verifyAdmin();
  if (authResult instanceof Response) return authResult;

  const body = await request.json();
  const { user_id, rate_amount, rate_type, effective_date } = body;

  const amount = parseFloat(rate_amount);
  if (!user_id || isNaN(amount) || amount < 0 || !rate_type || !effective_date) {
    return Response.json(
      { error: "user_id, rate_amount, rate_type, and effective_date are required" },
      { status: 400 }
    );
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(effective_date)) {
    return Response.json({ error: "effective_date must be YYYY-MM-DD" }, { status: 400 });
  }
  if (!["hourly", "daily", "monthly", "per_task"].includes(rate_type)) {
    return Response.json({ error: "Invalid rate_type" }, { status: 400 });
  }

  const supabase = adminClient();

  // Find the currently-open history row
  const { data: openRows, error: openError } = await supabase
    .from("pay_rate_history")
    .select("id, effective_date")
    .eq("user_id", user_id)
    .is("end_date", null)
    .order("effective_date", { ascending: false });

  if (openError) {
    return Response.json({ error: openError.message }, { status: 400 });
  }

  const openRow = openRows?.[0] || null;
  if (openRow && effective_date <= openRow.effective_date) {
    return Response.json(
      { error: `Effective date must be after the current rate's effective date (${openRow.effective_date})` },
      { status: 400 }
    );
  }

  // Close the open row: end_date = day before new effective_date
  if (openRow) {
    const d = new Date(effective_date + "T00:00:00Z");
    d.setUTCDate(d.getUTCDate() - 1);
    const endDate = d.toISOString().slice(0, 10);
    const { error: closeError } = await supabase
      .from("pay_rate_history")
      .update({ end_date: endDate })
      .eq("id", openRow.id);
    if (closeError) {
      return Response.json({ error: closeError.message }, { status: 400 });
    }
  }

  // Insert the new open-ended rate row
  const { error: insertError } = await supabase.from("pay_rate_history").insert({
    user_id,
    rate_amount: amount,
    rate_type,
    effective_date,
    end_date: null,
  });
  if (insertError) {
    return Response.json({ error: insertError.message }, { status: 400 });
  }

  // Sync the current-rate cache on profiles
  const { error: profileError } = await supabase
    .from("profiles")
    .update({ pay_rate: amount, pay_rate_type: rate_type })
    .eq("id", user_id);
  if (profileError) {
    return Response.json({ error: profileError.message }, { status: 400 });
  }

  return Response.json({ success: true });
}
