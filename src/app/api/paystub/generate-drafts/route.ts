import { createClient } from "@/lib/supabase/server";
import { createClient as createAdminClient } from "@supabase/supabase-js";
import type { NextRequest } from "next/server";
import { runPaystubDraftGeneration } from "@/lib/paystubGeneration";

export const dynamic = "force-dynamic";

/**
 * GET/POST /api/paystub/generate-drafts
 *
 * Admin-triggered version of the paystub-drafts cron — same generation +
 * consolidated review email, but authenticated by the caller's ADMIN SESSION
 * (not CRON_SECRET), so Toni can run it from a browser link while logged in.
 *
 * Period defaults to the current cutoff (1–15 on/after the 16th, else 16–end of
 * the previous month) and can be overridden with ?start=YYYY-MM-DD&end=YYYY-MM-DD.
 */

function pad2(n: number) { return String(n).padStart(2, "0"); }
function daysInMonth(year: number, month1: number) { return new Date(Date.UTC(year, month1, 0)).getUTCDate(); }
function getTimezoneParts(date: Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone, year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(date);
  const m = Object.fromEntries(parts.map((p) => [p.type, p.value]));
  return { year: Number(m.year || "0"), month: Number(m.month || "1"), day: Number(m.day || "1") };
}

async function handle(request: NextRequest) {
  // Admin session check
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

  const url = new URL(request.url);
  const qsStart = url.searchParams.get("start");
  const qsEnd = url.searchParams.get("end");
  if (qsStart && qsEnd && /^\d{4}-\d{2}-\d{2}$/.test(qsStart) && /^\d{4}-\d{2}-\d{2}$/.test(qsEnd)) {
    periodStart = qsStart;
    periodEnd = qsEnd;
  }

  // Optional recipient override for the review email (e.g. testing).
  const qsTo = url.searchParams.get("to");
  const notifyEmail = qsTo && /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(qsTo)
    ? qsTo
    : (settings?.notification_email || settings?.billing_email || null);

  const result = await runPaystubDraftGeneration(admin, {
    periodStart,
    periodEnd,
    notifyEmail,
    orgName: settings?.org_name || null,
  });
  return Response.json({ ...result, sentReviewTo: notifyEmail, note: "Drafts saved. A review email was sent to the address shown in sentReviewTo. Open each review link to approve + send to the VA." });
}

export async function GET(request: NextRequest) { return handle(request); }
export async function POST(request: NextRequest) { return handle(request); }
