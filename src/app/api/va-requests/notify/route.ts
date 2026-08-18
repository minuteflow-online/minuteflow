import { createClient as createServerClient } from "@/lib/supabase/server";
import { createClient as createAdminClient } from "@supabase/supabase-js";
import { makeApprovalToken } from "@/lib/approvalToken";
import { esc } from "@/lib/approvalPages";
import { sendTelegram, telegramEnabled, esc as tgEsc } from "@/lib/telegram";

export const dynamic = "force-dynamic";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const BASE = "https://minuteflow.click";

const TYPE_LABELS: Record<string, string> = {
  time_off: "Time Off",
  schedule_change: "Change Shift",
  short_day: "Short Day",
  pay_question: "Pay Question",
  general: "General Request",
};

function fmtDate(d: string | null): string | null {
  if (!d) return null;
  return new Date(d + "T12:00:00Z").toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}
function fmt12(t: string | null): string {
  if (!t) return "";
  const [h, m] = t.split(":").map(Number);
  const ap = h >= 12 ? "PM" : "AM";
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:${String(m).padStart(2, "0")} ${ap}`;
}

function actionButton(label: string, href: string, color: string): string {
  return `<a href="${href}" style="display:inline-block;background:${color};color:#fff;padding:10px 16px;border-radius:8px;text-decoration:none;font-weight:600;margin:4px 6px 4px 0">${label}</a>`;
}

// POST { id } — called by the portal right after a VA submits a request. Emails
// admins (only) with one-tap Approve / Decline / Propose-new-time links. The
// caller must be the VA who owns the request. Best-effort: any failure returns
// ok:false but never blocks the submission (the portal ignores the result).
export async function POST(request: Request) {
  const supabase = await createServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const body = await request.json().catch(() => ({}));
  const id = String(body.id ?? "").trim();
  if (!id) return Response.json({ error: "id required" }, { status: 400 });

  const admin = createAdminClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const { data: req } = await admin
    .from("va_requests")
    .select("id, user_id, type, subject, message, start_date, end_date, start_time, end_time")
    .eq("id", id)
    .single();
  if (!req) return Response.json({ error: "Not found" }, { status: 404 });
  // A VA may only trigger the alert for their own request.
  if (req.user_id !== user.id) return Response.json({ error: "Forbidden" }, { status: 403 });

  const resendKey = process.env.RESEND_API_KEY;
  const tgOn = telegramEnabled("submissions");
  // Either channel suffices. This previously bailed when Resend was unset,
  // which would have silently disabled the Telegram alert as well.
  if (!resendKey && !tgOn) return Response.json({ ok: false, reason: "no notification channel configured" });

  const { data: prof } = await admin.from("profiles").select("full_name, username").eq("id", req.user_id).single();
  const vaName = prof?.full_name || prof?.username || "A VA";
  const typeLabel = TYPE_LABELS[req.type] || req.type;

  const dateRange = req.start_date
    ? `${fmtDate(req.start_date)}${req.end_date && req.end_date !== req.start_date ? ` – ${fmtDate(req.end_date)}` : ""}`
    : null;
  const timeRange = req.start_time ? `${fmt12(req.start_time)} – ${fmt12(req.end_time)}` : null;

  const link = (action: string) =>
    `${BASE}/api/va-requests/action?id=${req.id}&do=${action}&t=${makeApprovalToken("shift", req.id, action)}`;

  // Email — admins only. Managers (e.g. IT) are excluded from these approvals.
  const emails: string[] = [];
  if (resendKey) {
    const { data: admins } = await admin.from("profiles").select("id").eq("role", "admin");
    for (const a of (admins ?? []) as { id: string }[]) {
      const { data: authData } = await admin.auth.admin.getUserById(a.id);
      if (authData?.user?.email) emails.push(authData.user.email);
    }

    if (emails.length > 0) {
      // "Propose a new time" only makes sense for a shift change.
      const proposeBtn = req.type === "schedule_change" ? actionButton("🕑 Propose new time", link("propose"), "#b8860b") : "";
      await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: { Authorization: `Bearer ${resendKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          from: "Toni Colina <noreply@minuteflow.click>",
          to: emails,
          subject: `🔔 ${typeLabel} request from ${vaName}`,
          html: `<div style="font-family:-apple-system,Segoe UI,Roboto,sans-serif;color:#3d3229">
            <h2 style="color:#c2694f">🔔 ${esc(typeLabel)} request</h2>
            <p><strong>${esc(vaName)}</strong> submitted a <strong>${esc(typeLabel)}</strong> request.</p>
            ${req.subject ? `<p><strong>Subject:</strong> ${esc(req.subject)}</p>` : ""}
            ${dateRange ? `<p><strong>Dates:</strong> ${esc(dateRange)}</p>` : ""}
            ${timeRange ? `<p><strong>Requested time:</strong> ${esc(timeRange)}</p>` : ""}
            ${req.message ? `<p style="background:#f3ede4;padding:10px 12px;border-radius:8px">${esc(req.message).replace(/\n/g, "<br>")}</p>` : ""}
            <div style="margin:18px 0">
              ${actionButton("✓ Approve", link("approve"), "#6b8f71")}
              ${actionButton("✋ Decline", link("decline"), "#c2694f")}
              ${proposeBtn}
            </div>
            <p style="color:#b5a898;font-size:12px">Or review in Admin → VA Requests.</p>
          </div>`,
        }),
      });
    }
  }

  // Telegram — carries the same one-tap approval links, so a request can be
  // actioned from the phone without opening the admin panel.
  if (tgOn) {
    const lines = [`🔔 <b>${tgEsc(typeLabel)} request</b> from ${tgEsc(vaName)}`];
    if (req.subject) lines.push(`Subject: ${tgEsc(req.subject)}`);
    if (dateRange) lines.push(`Dates: ${tgEsc(dateRange)}`);
    if (timeRange) lines.push(`Requested time: ${tgEsc(timeRange)}`);
    if (req.message) lines.push("", tgEsc(req.message));
    lines.push("", `<a href="${link("approve")}">✓ Approve</a>  •  <a href="${link("decline")}">✋ Decline</a>`);
    if (req.type === "schedule_change") lines.push(`<a href="${link("propose")}">🕑 Propose new time</a>`);
    await sendTelegram("submissions", lines.join("\n"));
  }

  return Response.json({ ok: true, to: emails });
}
