import { createClient as createAdminClient } from "@supabase/supabase-js";
import type { NextRequest } from "next/server";
import { runRecurringInvoiceGeneration } from "@/lib/invoiceGeneration";

export const dynamic = "force-dynamic";

/**
 * GET/POST /api/cron/generate-recurring-invoices
 *
 * Runs on the 1st of each month (vercel.json). For every invoice flagged
 * is_recurring, generates the just-completed month's invoice as a DRAFT that
 * needs review — never sent to the client. Hourly recomputes from time_logs;
 * fixed clones last month. Generation + review email live in
 * /lib/invoiceGeneration (shared with the admin manual trigger).
 *
 * Secured by CRON_SECRET.
 */

function serviceClient() {
  return createAdminClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  );
}

function getCronSecret(request: Request) {
  const authHeader = request.headers.get("authorization");
  const expectedSecret = process.env.CRON_SECRET;
  return Boolean(expectedSecret) && authHeader === `Bearer ${expectedSecret}`;
}

async function handleCron(request: NextRequest) {
  if (!getCronSecret(request)) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const supabase = serviceClient();
  const { data: settings } = await supabase
    .from("organization_settings")
    .select("timezone, billing_email, notification_email, org_name")
    .limit(1)
    .single();

  const result = await runRecurringInvoiceGeneration(supabase, {
    notifyEmail: settings?.notification_email || settings?.billing_email || null,
    orgName: settings?.org_name || null,
    timeZone: settings?.timezone || "UTC",
  });
  return Response.json(result);
}

export async function GET(request: NextRequest) { return handleCron(request); }
export async function POST(request: NextRequest) { return handleCron(request); }
