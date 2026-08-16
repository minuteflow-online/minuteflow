import { createClient as createServerClient } from "@/lib/supabase/server";
import { createClient as createAdminClient } from "@supabase/supabase-js";

export const dynamic = "force-dynamic";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;

// GET /api/budget-requests/test-notify
// Admin-only. Sends a SAMPLE budget-request notification email using the exact
// production template + recipient logic (role="admin" only — managers/IT are
// excluded), so an admin can confirm delivery lands in their inbox. Creates no
// budget_requests row. Returns the list of addresses it sent to.
export async function GET() {
  const supabase = await createServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const { data: profile } = await supabase.from("profiles").select("role").eq("id", user.id).single();
  if (profile?.role !== "admin") {
    return Response.json({ error: "Admins only." }, { status: 403 });
  }

  const resendKey = process.env.RESEND_API_KEY;
  if (!resendKey) {
    return Response.json({ error: "RESEND_API_KEY is not configured in this environment." }, { status: 500 });
  }

  const admin = createAdminClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  // Mirror production: email admins only (managers/IT are blocked from financials).
  const { data: admins } = await admin.from("profiles").select("id").eq("role", "admin");
  const emails: string[] = [];
  for (const a of (admins ?? []) as { id: string }[]) {
    const { data: authData } = await admin.auth.admin.getUserById(a.id);
    if (authData?.user?.email) emails.push(authData.user.email);
  }
  if (emails.length === 0) {
    return Response.json({ error: "No admin emails found to send to." }, { status: 500 });
  }

  const vaName = "Test VA";
  const amountStr = "2h";
  const periodWord = "daily";
  const reason = "This is a test of the budget-request notification email.";

  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${resendKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      from: "Toni Colina <noreply@minuteflow.click>",
      to: emails,
      subject: `🔔 [TEST] Budget request: ${vaName} needs ${amountStr} more (${periodWord})`,
      html: `<div style="font-family:-apple-system,Segoe UI,Roboto,sans-serif;color:#3d3229">
        <p style="background:#f5ecd0;color:#b8860b;padding:8px 12px;border-radius:8px;font-weight:600;font-size:13px">TEST EMAIL — this is what a real budget request alert looks like.</p>
        <h2 style="color:#c2694f">🔔 Budget increase request</h2>
        <p><strong>${vaName}</strong> requested <strong>${amountStr}</strong> more for their <strong>${periodWord}</strong> budget.</p>
        <p style="background:#f3ede4;padding:10px 12px;border-radius:8px"><em>Reason:</em> ${reason}</p>
        <p style="margin-top:18px"><a href="https://minuteflow.click/admin" style="background:#6b8f71;color:#fff;padding:10px 18px;border-radius:8px;text-decoration:none;font-weight:600">Review &amp; approve</a></p>
        <p style="color:#b5a898;font-size:12px">Admin → VA Requests → Budget Requests</p>
      </div>`,
    }),
  });

  const ok = res.ok;
  const detail = await res.text().catch(() => "");
  return Response.json({ sent: ok, to: emails, resendStatus: res.status, detail: ok ? undefined : detail });
}
