import { createClient as createAdminClient } from "@supabase/supabase-js";
import type { NextRequest } from "next/server";
import { runPaystubDraftGeneration } from "@/lib/paystubGeneration";

export const dynamic = "force-dynamic";

/**
 * GET/POST /api/cron/generate-paystubs
 *
 * Twice-monthly paystub drafts (vercel.json → 5th & 20th):
 *  - On/after the 16th (the 20th run) → cutoff 1–15 of the CURRENT month.
 *  - Before the 16th (the 5th run)   → cutoff 16–end of the PREVIOUS month.
 *
 * Optional manual-run override (still CRON_SECRET-gated):
 *   ?start=YYYY-MM-DD&end=YYYY-MM-DD
 *
 * Generation + the consolidated admin review email live in
 * /lib/paystubGeneration (shared with the admin manual trigger). Secured by
 * CRON_SECRET.
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

function getTimezoneParts(date: Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone, year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(date);
  const m = Object.fromEntries(parts.map((p) => [p.type, p.value]));
  return { year: Number(m.year || "0"), month: Number(m.month || "1"), day: Number(m.day || "1") };
}

function pad2(n: number) { return String(n).padStart(2, "0"); }
function daysInMonth(year: number, month1: number) { return new Date(Date.UTC(year, month1, 0)).getUTCDate(); }

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
  const timeZone = settings?.timezone || "UTC";

  const { year, month, day } = getTimezoneParts(new Date(), timeZone);

  let periodStart: string;
  let periodEnd: string;
  if (day >= 16) {
    periodStart = `${year}-${pad2(month)}-01`;
    periodEnd = `${year}-${pad2(month)}-15`;
  } else {
    const pm = month === 1 ? 12 : month - 1;
    const py = month === 1 ? year - 1 : year;
    periodStart = `${py}-${pad2(pm)}-16`;
    periodEnd = `${py}-${pad2(pm)}-${pad2(daysInMonth(py, pm))}`;
  }

  // Manual-run override for off-schedule / test runs.
  const url = new URL(request.url);
  const qsStart = url.searchParams.get("start");
  const qsEnd = url.searchParams.get("end");
  if (qsStart && qsEnd && /^\d{4}-\d{2}-\d{2}$/.test(qsStart) && /^\d{4}-\d{2}-\d{2}$/.test(qsEnd)) {
    periodStart = qsStart;
    periodEnd = qsEnd;
  }

  const result = await runPaystubDraftGeneration(supabase, {
    periodStart,
    periodEnd,
    notifyEmail: settings?.notification_email || settings?.billing_email || null,
    orgName: settings?.org_name || null,
  });
  return Response.json(result);
}

export async function GET(request: NextRequest) { return handleCron(request); }
export async function POST(request: NextRequest) { return handleCron(request); }
