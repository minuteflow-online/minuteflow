import { createClient } from "@/lib/supabase/server";
import { createClient as createAdminClient } from "@supabase/supabase-js";

export const dynamic = "force-dynamic";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;

const REQUEST_TYPE_LABELS: Record<string, string> = {
  time_off: "Time Off",
  schedule_change: "Schedule Change",
  pay_question: "Pay Question",
  general: "General Request",
};

function fmtReqDate(dateStr: string | null) {
  if (!dateStr) return null;
  return new Date(dateStr + "T12:00:00Z").toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

/** GET: All requests (admin) or own requests (VA) */
export async function GET() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const { data: profile } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .single();

  let query = supabase
    .from("va_requests")
    .select("*")
    .order("created_at", { ascending: false });

  if (profile?.role !== "admin") {
    query = query.eq("user_id", user.id);
  }

  const { data, error } = await query;
  if (error) return Response.json({ error: error.message }, { status: 500 });

  if (profile?.role === "admin" && data && data.length > 0) {
    const { data: profiles } = await supabase
      .from("profiles")
      .select("id, full_name");
    const profileMap: Record<string, string> = {};
    (profiles || []).forEach((p: { id: string; full_name: string }) => {
      profileMap[p.id] = p.full_name;
    });
    const enriched = data.map((r) => ({
      ...r,
      requester_name: profileMap[r.user_id] || "Unknown",
    }));
    return Response.json({ requests: enriched });
  }

  return Response.json({ requests: data ?? [] });
}

/** PATCH: Admin approve/deny a request — updates status and emails the VA */
export async function PATCH(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const { data: profile } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .single();
  if (profile?.role !== "admin") return Response.json({ error: "Forbidden" }, { status: 403 });

  const { searchParams } = new URL(request.url);
  const id = searchParams.get("id");
  if (!id) return Response.json({ error: "id required" }, { status: 400 });

  const body = await request.json();
  const { status, admin_notes } = body;
  if (!status || !["approved", "denied", "noted"].includes(status)) {
    return Response.json({ error: "status must be approved, denied, or noted" }, { status: 400 });
  }

  const { data: updated, error } = await supabase
    .from("va_requests")
    .update({
      status,
      admin_notes: admin_notes || null,
      reviewed_by: user.id,
      reviewed_at: new Date().toISOString(),
    })
    .eq("id", id)
    .select()
    .single();

  if (error) return Response.json({ error: error.message }, { status: 500 });

  // Send email notification (best-effort — status update above already succeeded)
  let emailSent = false;
  let emailError: string | null = null;
  const resendKey = process.env.RESEND_API_KEY;

  if (resendKey && (status === "approved" || status === "denied")) {
    const adminClient = createAdminClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    const { data: authData } = await adminClient.auth.admin.getUserById(updated.user_id);
    const vaEmail = authData?.user?.email;

    if (vaEmail) {
      const typeLabel = REQUEST_TYPE_LABELS[updated.type] || updated.type;
      const decisionLabel = status === "approved" ? "Approved" : "Denied";
      const dateRange = updated.start_date
        ? `${fmtReqDate(updated.start_date)}${updated.end_date && updated.end_date !== updated.start_date ? ` – ${fmtReqDate(updated.end_date)}` : ""}`
        : null;

      const html = `
        <div style="font-family: sans-serif; max-width: 480px; margin: 0 auto;">
          <h2 style="color: ${status === "approved" ? "#6b8f71" : "#c2694f"};">Request ${decisionLabel}</h2>
          <p><strong>Type:</strong> ${typeLabel}</p>
          <p><strong>Subject:</strong> ${updated.subject}</p>
          ${dateRange ? `<p><strong>Dates:</strong> ${dateRange}</p>` : ""}
          ${admin_notes ? `<p><strong>Admin note:</strong> ${admin_notes}</p>` : ""}
          <p style="color: #8b7b6b; font-size: 12px; margin-top: 24px;">This is an automated notification from MinuteFlow.</p>
        </div>
      `;

      const resendRes = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${resendKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          from: "Toni Colina <noreply@minuteflow.click>",
          to: [vaEmail],
          subject: `Your Request Was ${decisionLabel} — ${typeLabel}`,
          html,
        }),
      });

      if (resendRes.ok) {
        emailSent = true;
      } else {
        emailError = await resendRes.text();
        console.error("Resend error (va-requests):", emailError);
      }
    } else {
      emailError = "VA email not found";
    }
  }

  return Response.json({ request: updated, emailSent, emailError });
}
