import { createClient as createServerClient } from "@/lib/supabase/server";
import { createClient as createAdminClient } from "@supabase/supabase-js";
import { makeApprovalToken } from "@/lib/approvalToken";

export const dynamic = "force-dynamic";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;
// Financial alerts go to a DEDICATED private chat (TELEGRAM_BUDGET_CHAT_ID) —
// never the shared team group, which includes non-financial managers (e.g. IT).
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const TELEGRAM_BUDGET_CHAT_ID = process.env.TELEGRAM_BUDGET_CHAT_ID;

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

// Best-effort email (to every admin/manager) + Telegram alert (to the admin
// group) when a VA submits a budget request, with a link to the approval page.
// Never throws — a notification failure must not fail the request itself.
async function notifyAdminsOfRequest(
  admin: ReturnType<typeof makeAdminClient>,
  requestId: number,
  vaId: string,
  amount: number,
  unit: string,
  period: string,
  reason: string | null
) {
  const resendKey = process.env.RESEND_API_KEY;
  const telegramOn = Boolean(TELEGRAM_BOT_TOKEN && TELEGRAM_BUDGET_CHAT_ID);
  if (!resendKey && !telegramOn) return;
  try {
    const { data: va } = await admin.from("profiles").select("full_name, username").eq("id", vaId).single();
    const vaName = va?.full_name || va?.username || "A VA";
    const periodWord = period === "day" ? "daily" : period === "week" ? "weekly" : "monthly";
    const amountStr = unit === "dollars" ? `$${amount.toFixed(2)}` : `${amount}h`;

    // Email — to admins only. Managers (e.g. IT) are blocked from financials,
    // so they must NOT receive budget alerts.
    if (resendKey) {
      const { data: admins } = await admin.from("profiles").select("id").eq("role", "admin");
      const emails: string[] = [];
      for (const a of (admins ?? []) as { id: string }[]) {
        const { data: authData } = await admin.auth.admin.getUserById(a.id);
        if (authData?.user?.email) emails.push(authData.user.email);
      }
      if (emails.length > 0) {
        const approveUrl = `https://minuteflow.click/api/budget-requests/action?id=${requestId}&do=approve&t=${makeApprovalToken("budget", requestId, "approve")}`;
        const declineUrl = `https://minuteflow.click/api/budget-requests/action?id=${requestId}&do=decline&t=${makeApprovalToken("budget", requestId, "decline")}`;
        await fetch("https://api.resend.com/emails", {
          method: "POST",
          headers: { Authorization: `Bearer ${resendKey}`, "Content-Type": "application/json" },
          body: JSON.stringify({
            from: "Toni Colina <noreply@minuteflow.click>",
            to: emails,
            subject: `🔔 Budget request: ${vaName} needs ${amountStr} more (${periodWord})`,
            html: `<div style="font-family:-apple-system,Segoe UI,Roboto,sans-serif;color:#3d3229">
              <h2 style="color:#c2694f">🔔 Budget increase request</h2>
              <p><strong>${vaName}</strong> requested <strong>${amountStr}</strong> more for their <strong>${periodWord}</strong> budget.</p>
              ${reason ? `<p style="background:#f3ede4;padding:10px 12px;border-radius:8px"><em>Reason:</em> ${reason}</p>` : ""}
              <div style="margin:18px 0">
                <a href="${approveUrl}" style="display:inline-block;background:#6b8f71;color:#fff;padding:10px 18px;border-radius:8px;text-decoration:none;font-weight:600;margin:4px 6px 4px 0">✓ Approve</a>
                <a href="${declineUrl}" style="display:inline-block;background:#c2694f;color:#fff;padding:10px 18px;border-radius:8px;text-decoration:none;font-weight:600;margin:4px 0">✋ Decline</a>
              </div>
              <p style="color:#b5a898;font-size:12px">Or review in Admin → VA Requests → Budget Requests</p>
            </div>`,
          }),
        });
      }
    }

    // Telegram — to the shared admin group (same bot the extension uses).
    if (telegramOn) {
      await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          chat_id: TELEGRAM_BUDGET_CHAT_ID,
          text: `🔔 Budget request — ${vaName} needs ${amountStr} more (${periodWord})${reason ? `\nReason: ${reason}` : ""}\n\nApprove: https://minuteflow.click/admin`,
        }),
      });
    }
  } catch (e) {
    console.error("budget-request notify error:", e);
  }
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
    .select("id, va_id, amount, unit, reason, status, reviewed_by, review_notes, created_at, reviewed_at, period")
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
  // Which budget the increase applies to — a temporary bump to that one period.
  const period = ["day", "week", "month"].includes(String(body.period)) ? String(body.period) : "day";

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
      period,
      status: isDirectGrant ? "approved" : "pending",
      reviewed_by: isDirectGrant ? auth.userId : null,
      reviewed_at: isDirectGrant ? now : null,
    })
    .select("id, va_id, amount, unit, reason, status, reviewed_by, review_notes, created_at, reviewed_at, period")
    .single();

  if (error) return Response.json({ error: error.message }, { status: 500 });

  // A VA request needs admin sign-off → notify them. A direct grant is already
  // approved, so no notification.
  if (!isDirectGrant) {
    await notifyAdminsOfRequest(admin, data.id, auth.userId, amount, unit, period, reason);
  }

  return Response.json({ request: data });
}
