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
  timeField,
} from "@/lib/approvalPages";

export const dynamic = "force-dynamic";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;

const TYPE_LABELS: Record<string, string> = {
  time_off: "Time Off",
  schedule_change: "Change Shift",
  short_day: "Short Day",
  pay_question: "Pay Question",
  general: "General Request",
};

function makeAdminClient() {
  return createAdminClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

type VaReq = {
  id: number;
  user_id: string;
  type: string;
  subject: string | null;
  message: string | null;
  start_date: string | null;
  end_date: string | null;
  start_time: string | null;
  end_time: string | null;
  status: string;
};

async function loadReq(db: ReturnType<typeof makeAdminClient>, id: string): Promise<VaReq | null> {
  const { data } = await db
    .from("va_requests")
    .select("id, user_id, type, subject, message, start_date, end_date, start_time, end_time, status")
    .eq("id", id)
    .single();
  return (data as VaReq | null) ?? null;
}

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

// Notify the VA of the decision (best-effort — never throws).
async function emailVa(
  db: ReturnType<typeof makeAdminClient>,
  req: VaReq,
  outcome: "approved" | "denied" | "proposed",
  note: string | null,
  proposed?: { start: string; end: string }
) {
  const resendKey = process.env.RESEND_API_KEY;
  if (!resendKey) return;
  try {
    const { data: authData } = await db.auth.admin.getUserById(req.user_id);
    const email = authData?.user?.email;
    if (!email) return;
    const typeLabel = TYPE_LABELS[req.type] || req.type;
    const heading =
      outcome === "approved" ? "Approved" : outcome === "denied" ? "Declined" : "New time proposed";
    const color = outcome === "approved" ? "#6b8f71" : outcome === "denied" ? "#c2694f" : "#b8860b";
    const proposedLine =
      outcome === "proposed" && proposed
        ? `<p><strong>Proposed new time:</strong> ${esc(fmt12(proposed.start))} – ${esc(fmt12(proposed.end))}</p>`
        : "";
    await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${resendKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        from: "Toni Colina <noreply@minuteflow.click>",
        to: [email],
        subject: `Your ${typeLabel} request — ${heading}`,
        html: `<div style="font-family:-apple-system,Segoe UI,Roboto,sans-serif;color:#3d3229">
          <h2 style="color:${color}">${typeLabel} — ${heading}</h2>
          ${req.subject ? `<p><strong>Subject:</strong> ${esc(req.subject)}</p>` : ""}
          ${proposedLine}
          ${note ? `<p style="background:#f3ede4;padding:10px 12px;border-radius:8px"><em>Note:</em> ${esc(note)}</p>` : ""}
          <p style="color:#b5a898;font-size:12px">— MinuteFlow</p>
        </div>`,
      }),
    });
  } catch (e) {
    console.error("va-request emailVa error:", e);
  }
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const id = url.searchParams.get("id") || "";
  const action = url.searchParams.get("do") || "";
  const t = url.searchParams.get("t") || "";

  const valid = action === "approve" || action === "decline" || action === "propose";
  if (!valid || !verifyApprovalToken("shift", id, action, t)) {
    return resultPage(false, "Invalid link", "This approval link is invalid or has expired.");
  }

  const db = makeAdminClient();
  const req = await loadReq(db, id);
  if (!req) return resultPage(false, "Not found", "That request no longer exists.");

  const { data: prof } = await db.from("profiles").select("full_name, username").eq("id", req.user_id).single();
  const vaName = esc(prof?.full_name || prof?.username || "the VA");

  if (req.status !== "pending") {
    return resultPage(false, "Already handled", `This request was already <strong>${esc(req.status)}</strong>. No change was made.`);
  }

  const typeLabel = esc(TYPE_LABELS[req.type] || req.type);
  const dateRange = req.start_date
    ? `${fmtDate(req.start_date)}${req.end_date && req.end_date !== req.start_date ? ` – ${fmtDate(req.end_date)}` : ""}`
    : null;
  const timeRange = req.start_time ? `${fmt12(req.start_time)} – ${fmt12(req.end_time)}` : null;
  const summary = summaryBlock(
    `<strong>${vaName}</strong> — ${typeLabel}${req.subject ? `<br><strong>${esc(req.subject)}</strong>` : ""}` +
      `${dateRange ? `<br><em>Dates:</em> ${esc(dateRange)}` : ""}` +
      `${timeRange ? `<br><em>Requested time:</em> ${esc(timeRange)}` : ""}` +
      `${req.message ? `<br><span style="color:#6b5b4b">${esc(req.message).replace(/\n/g, "<br>")}</span>` : ""}`
  );
  const hidden = `<input type="hidden" name="id" value="${esc(id)}"><input type="hidden" name="do" value="${esc(action)}"><input type="hidden" name="t" value="${esc(t)}">`;

  if (action === "approve") {
    return htmlResponse(
      card(`<h2 style="color:#6b8f71;margin:0 0 12px">Approve this request?</h2>${summary}<form method="post">${hidden}${primaryButton("✓ Confirm Approve", "#6b8f71")}</form>`)
    );
  }
  if (action === "decline") {
    return htmlResponse(
      card(`<h2 style="color:#c2694f;margin:0 0 12px">Decline this request?</h2>${summary}<form method="post">${hidden}${textareaField("reason", `Reason (sent to ${vaName})`, "Why are you declining?")}${primaryButton("Send Decline", "#c2694f")}</form>`)
    );
  }
  // propose
  return htmlResponse(
    card(
      `<h2 style="color:#b8860b;margin:0 0 12px">Propose a new time</h2>${summary}<form method="post">${hidden}<div style="display:flex;gap:10px;margin:0 0 14px">${timeField("start", "New start")}${timeField("end", "New end")}</div>${textareaField("reason", `Note (sent to ${vaName})`, "Why this time?")}${primaryButton("Send Proposal", "#b8860b")}</form>`
    )
  );
}

export async function POST(request: Request) {
  // This backs an emailed approval link, so a replayed or malformed POST is a
  // realistic hit — it must render the same styled page as every other failure
  // here, not throw a 500 at whoever clicked the link.
  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return resultPage(false, "Invalid submission", "That form could not be read. Open the link from your email again and resubmit.");
  }
  const id = String(form.get("id") || "");
  const action = String(form.get("do") || "");
  const t = String(form.get("t") || "");
  const reason = String(form.get("reason") || "").trim() || null;
  const newStart = String(form.get("start") || "").trim();
  const newEnd = String(form.get("end") || "").trim();

  const valid = action === "approve" || action === "decline" || action === "propose";
  if (!valid || !verifyApprovalToken("shift", id, action, t)) {
    return resultPage(false, "Invalid link", "This approval link is invalid or has expired.");
  }

  const db = makeAdminClient();
  const req = await loadReq(db, id);
  if (!req) return resultPage(false, "Not found", "That request no longer exists.");
  if (req.status !== "pending") {
    return resultPage(false, "Already handled", `This request was already <strong>${esc(req.status)}</strong>.`);
  }

  if (action === "propose") {
    if (!newStart || !newEnd) {
      return resultPage(false, "Missing time", "Please go back and enter both a new start and end time.");
    }
    const noteText = `Proposed new time: ${fmt12(newStart)} – ${fmt12(newEnd)}${reason ? ` — ${reason}` : ""}`;
    // "noted" = an open counter-proposal awaiting the VA (not yet approved/denied).
    const { error } = await db
      .from("va_requests")
      .update({ status: "noted", admin_notes: noteText, reviewed_at: new Date().toISOString() })
      .eq("id", id);
    if (error) return resultPage(false, "Something went wrong", esc(error.message));
    await emailVa(db, req, "proposed", reason, { start: newStart, end: newEnd });
    return resultPage(true, "Proposal sent ✓", "Your proposed new time was sent to the VA. They'll see it on their request and by email.");
  }

  const status = action === "approve" ? "approved" : "denied";
  const { error } = await db
    .from("va_requests")
    .update({ status, admin_notes: reason, reviewed_at: new Date().toISOString() })
    .eq("id", id);
  if (error) return resultPage(false, "Something went wrong", esc(error.message));

  await emailVa(db, req, status, reason);

  return status === "approved"
    ? resultPage(true, "Approved ✓", "The request is approved and the VA has been notified.")
    : resultPage(true, "Declined", "The request was declined and the VA has been notified.");
}
