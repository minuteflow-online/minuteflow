import { createClient } from "@/lib/supabase/server";
import { createClient as createAdminClient } from "@supabase/supabase-js";
import type { NextRequest } from "next/server";
import { runRecurringInvoiceGeneration } from "@/lib/invoiceGeneration";

export const dynamic = "force-dynamic";

/**
 * GET/POST /api/invoices/generate-recurring
 *
 * Admin-triggered version of the recurring-invoice cron — same generation +
 * review email, authenticated by the caller's ADMIN SESSION so Toni can run it
 * from a browser link while logged in. Optional ?to=email overrides the review
 * recipient (for testing).
 */

async function handle(request: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const { data: caller } = await supabase.from("profiles").select("role").eq("id", user.id).single();
  if (caller?.role !== "admin") return Response.json({ error: "Forbidden" }, { status: 403 });

  const admin = createAdminClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  );

  const { data: settings } = await admin
    .from("organization_settings")
    .select("timezone, billing_email, notification_email, org_name")
    .limit(1)
    .single();

  const url = new URL(request.url);
  const qsTo = url.searchParams.get("to");
  const notifyEmail = qsTo && /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(qsTo)
    ? qsTo
    : (settings?.notification_email || settings?.billing_email || null);

  const result = await runRecurringInvoiceGeneration(admin, {
    notifyEmail,
    orgName: settings?.org_name || null,
    timeZone: settings?.timezone || "UTC",
  });
  return Response.json({ ...result, sentReviewTo: notifyEmail, note: "Draft(s) saved. A review email was sent to the address in sentReviewTo. Open the review link to send." });
}

export async function GET(request: NextRequest) { return handle(request); }
export async function POST(request: NextRequest) { return handle(request); }
