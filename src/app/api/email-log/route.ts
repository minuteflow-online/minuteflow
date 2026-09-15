import { createClient } from "@/lib/supabase/server";
import { createClient as createAdminClient } from "@supabase/supabase-js";
import { hasFinancialAccess } from "@/lib/financialAccess";

export const dynamic = "force-dynamic";

function serviceClient() {
  return createAdminClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  );
}

/**
 * email_log has no anon/authenticated grants — same lockdown as
 * email_log_hidden — so it's reached only through this service-role route,
 * gated the same way the Email Log tab itself is gated.
 */
async function requireAdmin() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return { error: Response.json({ error: "Unauthorized" }, { status: 401 }) };
  }
  const { data: profile } = await supabase
    .from("profiles")
    .select("role, department")
    .eq("id", user.id)
    .single();
  if (!hasFinancialAccess(profile)) {
    return { error: Response.json({ error: "Forbidden" }, { status: 403 }) };
  }
  return { user };
}

/**
 * GET /api/email-log
 * Returns the most recent entries logged by sendResendEmail's `log` option —
 * every send type that isn't already tracked by its own table (invoices,
 * paystub_snapshots, broadcasts, invitations stay on their existing path in
 * EmailStatusTab; this covers everything else).
 */
export async function GET() {
  const auth = await requireAdmin();
  if ("error" in auth) return auth.error;

  const { data, error } = await serviceClient()
    .from("email_log")
    .select("id, email_type, label, sublabel, recipient, cc_emails, subject, resend_message_id, sent_at")
    .order("sent_at", { ascending: false })
    .limit(1000);

  if (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
  return Response.json({ records: data ?? [] });
}
