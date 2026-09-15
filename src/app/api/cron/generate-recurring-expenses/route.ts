import { createClient as createAdminClient } from "@supabase/supabase-js";
import type { NextRequest } from "next/server";
import { runRecurringExpenseGeneration } from "@/lib/expenseGeneration";

export const dynamic = "force-dynamic";

/**
 * GET/POST /api/cron/generate-recurring-expenses
 *
 * Runs on the 1st of each month (vercel.json). For every financial_expenses
 * row flagged is_recurring, clones it forward to this month once the latest
 * occurrence in that series is from a prior month — so a second run in the
 * same month is a no-op. Generation logic lives in /lib/expenseGeneration
 * (shared with a future admin manual trigger, mirroring the recurring-
 * invoices pattern).
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
  const result = await runRecurringExpenseGeneration(supabase);
  return Response.json(result);
}

export async function GET(request: NextRequest) { return handleCron(request); }
export async function POST(request: NextRequest) { return handleCron(request); }
