import { createClient as createAdminClient } from "@supabase/supabase-js";
import { verifyApprovalToken } from "@/lib/approvalToken";
import {
  htmlResponse,
  card,
  resultPage,
  esc,
  summaryBlock,
  primaryButton,
  textareaField,
} from "@/lib/approvalPages";

export const dynamic = "force-dynamic";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;

function makeAdminClient() {
  return createAdminClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

type BudgetReq = {
  id: number;
  va_id: string;
  amount: number;
  unit: string;
  reason: string | null;
  status: string;
  period: string;
};

async function loadReq(db: ReturnType<typeof makeAdminClient>, id: string): Promise<BudgetReq | null> {
  const { data } = await db
    .from("budget_requests")
    .select("id, va_id, amount, unit, reason, status, period")
    .eq("id", id)
    .single();
  return (data as BudgetReq | null) ?? null;
}

function amountStr(amount: number, unit: string): string {
  return unit === "dollars" ? `$${Number(amount).toFixed(2)}` : `${amount}h`;
}
function periodWord(p: string): string {
  return p === "week" ? "weekly" : p === "month" ? "monthly" : "daily";
}

// Tell the VA their budget request was decided (best-effort — never throws).
async function emailVa(
  db: ReturnType<typeof makeAdminClient>,
  req: BudgetReq,
  status: "approved" | "denied",
  reason: string | null
) {
  const resendKey = process.env.RESEND_API_KEY;
  if (!resendKey) return;
  try {
    const { data: authData } = await db.auth.admin.getUserById(req.va_id);
    const email = authData?.user?.email;
    if (!email) return;
    const amt = amountStr(req.amount, req.unit);
    const per = periodWord(req.period);
    const decided = status === "approved" ? "Approved" : "Declined";
    const color = status === "approved" ? "#6b8f71" : "#c2694f";
    await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${resendKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        from: "Toni Colina <noreply@minuteflow.click>",
        to: [email],
        subject: `Your budget request was ${decided.toLowerCase()} — ${amt} (${per})`,
        html: `<div style="font-family:-apple-system,Segoe UI,Roboto,sans-serif;color:#3d3229">
          <h2 style="color:${color}">Budget request ${decided}</h2>
          <p>Your request for <strong>${amt}</strong> more (${per} budget) was <strong>${decided.toLowerCase()}</strong>.</p>
          ${reason ? `<p style="background:#f3ede4;padding:10px 12px;border-radius:8px"><em>Note:</em> ${esc(reason)}</p>` : ""}
          <p style="color:#b5a898;font-size:12px">— MinuteFlow</p>
        </div>`,
      }),
    });
  } catch (e) {
    console.error("budget emailVa error:", e);
  }
}

// GET renders a confirmation page (nothing is changed on GET — this keeps email
// link-scanners/prefetchers from silently approving anything). The POST from
// that page's button performs the action.
export async function GET(request: Request) {
  const url = new URL(request.url);
  const id = url.searchParams.get("id") || "";
  const action = url.searchParams.get("do") || "";
  const t = url.searchParams.get("t") || "";

  if ((action !== "approve" && action !== "decline") || !verifyApprovalToken("budget", id, action, t)) {
    return resultPage(false, "Invalid link", "This approval link is invalid or has expired.");
  }

  const db = makeAdminClient();
  const req = await loadReq(db, id);
  if (!req) return resultPage(false, "Not found", "That budget request no longer exists.");

  const { data: va } = await db.from("profiles").select("full_name, username").eq("id", req.va_id).single();
  const vaName = esc(va?.full_name || va?.username || "the VA");

  if (req.status !== "pending") {
    return resultPage(false, "Already handled", `This request was already <strong>${esc(req.status)}</strong>. No change was made.`);
  }

  const amt = esc(amountStr(req.amount, req.unit));
  const per = periodWord(req.period);
  const summary = summaryBlock(
    `<strong>${vaName}</strong> requested <strong>${amt}</strong> more (${per} budget).${req.reason ? `<br><em>Reason:</em> ${esc(req.reason)}` : ""}`
  );
  const hidden = `<input type="hidden" name="id" value="${esc(id)}"><input type="hidden" name="do" value="${esc(action)}"><input type="hidden" name="t" value="${esc(t)}">`;

  if (action === "approve") {
    return htmlResponse(
      card(
        `<h2 style="color:#6b8f71;margin:0 0 12px">Approve this budget request?</h2>${summary}<form method="post">${hidden}${primaryButton("✓ Confirm Approve", "#6b8f71")}</form>`
      )
    );
  }
  return htmlResponse(
    card(
      `<h2 style="color:#c2694f;margin:0 0 12px">Decline this budget request?</h2>${summary}<form method="post">${hidden}${textareaField(
        "reason",
        `Reason (sent to ${vaName})`,
        "Why are you declining?"
      )}${primaryButton("Send Decline", "#c2694f")}</form>`
    )
  );
}

export async function POST(request: Request) {
  const form = await request.formData();
  const id = String(form.get("id") || "");
  const action = String(form.get("do") || "");
  const t = String(form.get("t") || "");
  const reason = String(form.get("reason") || "").trim() || null;

  if ((action !== "approve" && action !== "decline") || !verifyApprovalToken("budget", id, action, t)) {
    return resultPage(false, "Invalid link", "This approval link is invalid or has expired.");
  }

  const db = makeAdminClient();
  const req = await loadReq(db, id);
  if (!req) return resultPage(false, "Not found", "That budget request no longer exists.");
  if (req.status !== "pending") {
    return resultPage(false, "Already handled", `This request was already <strong>${esc(req.status)}</strong>.`);
  }

  const status = action === "approve" ? "approved" : "denied";
  const { error } = await db
    .from("budget_requests")
    .update({ status, review_notes: reason, reviewed_at: new Date().toISOString() })
    .eq("id", id);
  if (error) return resultPage(false, "Something went wrong", esc(error.message));

  await emailVa(db, req, status, reason);

  return status === "approved"
    ? resultPage(true, "Approved ✓", "The budget increase is approved and now counts toward their limit. The VA has been notified.")
    : resultPage(true, "Declined", "The request was declined and the VA has been notified.");
}
