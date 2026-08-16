import { createClient as createServerClient } from "@/lib/supabase/server";
import { createClient as createAdminClient } from "@supabase/supabase-js";
import { hasBroadAdminAccess } from "@/lib/financialAccess";

export const dynamic = "force-dynamic";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;

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

// PATCH — approve or deny a request. Any admin/manager may act (approval is not
// restricted to a single account).
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireAuthed();
  if ("error" in auth) return auth.error;

  const isAdminOrManager = hasBroadAdminAccess({ role: auth.role });
  if (!isAdminOrManager) {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }

  const { id } = await params;
  const requestId = Number(id);
  if (!Number.isFinite(requestId)) {
    return Response.json({ error: "Invalid request id" }, { status: 400 });
  }

  const body = await request.json().catch(() => ({}));
  const status = String(body.status ?? "");
  if (status !== "approved" && status !== "denied") {
    return Response.json({ error: "status must be 'approved' or 'denied'." }, { status: 400 });
  }
  const reviewNotes = typeof body.review_notes === "string" && body.review_notes.trim() ? body.review_notes.trim() : null;

  const admin = makeAdminClient();
  const { data, error } = await admin
    .from("budget_requests")
    .update({
      status,
      review_notes: reviewNotes,
      reviewed_by: auth.userId,
      reviewed_at: new Date().toISOString(),
    })
    .eq("id", requestId)
    .select("id, va_id, amount, unit, reason, status, reviewed_by, review_notes, created_at, reviewed_at")
    .single();

  if (error) return Response.json({ error: error.message }, { status: 500 });
  return Response.json({ request: data });
}
