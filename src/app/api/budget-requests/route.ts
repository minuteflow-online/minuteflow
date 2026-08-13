import { createClient as createServerClient } from "@/lib/supabase/server";
import { createClient as createAdminClient } from "@supabase/supabase-js";

export const dynamic = "force-dynamic";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;

// Any authenticated user is let through; the caller branches on `role`.
async function requireAuthed() {
  const supabase = await createServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return { error: Response.json({ error: "Unauthorized" }, { status: 401 }) as Response };
  }
  const { data: profile } = await supabase.from("profiles").select("role").eq("id", user.id).single();
  return { userId: user.id, role: profile?.role ?? null };
}

function makeAdminClient() {
  return createAdminClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

// GET — admins see every request (with VA/reviewer names); VAs see only their
// own. Newest first.
export async function GET() {
  const auth = await requireAuthed();
  if ("error" in auth) return auth.error;

  const admin = makeAdminClient();
  const isAdminOrManager = auth.role === "admin" || auth.role === "manager";

  let query = admin
    .from("budget_requests")
    .select("id, va_id, amount, unit, reason, status, reviewed_by, review_notes, created_at, reviewed_at")
    .order("created_at", { ascending: false });
  if (!isAdminOrManager) query = query.eq("va_id", auth.userId);

  const { data: rows, error } = await query;
  if (error) return Response.json({ error: error.message }, { status: 500 });

  // Hydrate VA + reviewer names in one lookup.
  const ids = [...new Set((rows ?? []).flatMap((r) => [r.va_id, r.reviewed_by]).filter((v): v is string => Boolean(v)))];
  let names: Record<string, string> = {};
  if (ids.length > 0) {
    const { data: profiles } = await admin.from("profiles").select("id, full_name, username").in("id", ids);
    names = Object.fromEntries((profiles ?? []).map((p) => [p.id, p.full_name || p.username || "Unknown"]));
  }

  const requests = (rows ?? []).map((r) => ({
    ...r,
    va_name: names[r.va_id] ?? "Unknown",
    reviewed_by_name: r.reviewed_by ? names[r.reviewed_by] ?? null : null,
  }));

  return Response.json({ requests });
}

// POST — a VA submits an over-budget request for themselves (lands "pending").
// An admin/manager may instead grant budget directly to any VA by passing
// va_id — that lands pre-"approved", attributed to themselves as reviewer, so
// it counts toward that VA's limit immediately without a separate approve step.
export async function POST(request: Request) {
  const auth = await requireAuthed();
  if ("error" in auth) return auth.error;
  const isAdminOrManager = auth.role === "admin" || auth.role === "manager";

  const body = await request.json().catch(() => ({}));
  const amount = Number(body.amount);
  const unit = String(body.unit ?? "");
  const reason = typeof body.reason === "string" && body.reason.trim() ? body.reason.trim() : null;
  const targetVaId = typeof body.va_id === "string" && body.va_id.trim() ? body.va_id.trim() : null;

  if (!Number.isFinite(amount) || amount <= 0) {
    return Response.json({ error: "A positive amount is required." }, { status: 400 });
  }
  if (unit !== "hours" && unit !== "dollars") {
    return Response.json({ error: "unit must be 'hours' or 'dollars'." }, { status: 400 });
  }
  if (targetVaId && !isAdminOrManager) {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }

  const isDirectGrant = isAdminOrManager && Boolean(targetVaId);
  const now = new Date().toISOString();

  const admin = makeAdminClient();
  const { data, error } = await admin
    .from("budget_requests")
    .insert({
      va_id: isDirectGrant ? targetVaId : auth.userId,
      amount,
      unit,
      reason,
      status: isDirectGrant ? "approved" : "pending",
      reviewed_by: isDirectGrant ? auth.userId : null,
      reviewed_at: isDirectGrant ? now : null,
    })
    .select("id, va_id, amount, unit, reason, status, reviewed_by, review_notes, created_at, reviewed_at")
    .single();

  if (error) return Response.json({ error: error.message }, { status: 500 });
  return Response.json({ request: data });
}
