import { createClient as createAdminClient } from "@supabase/supabase-js";
import type { NextRequest } from "next/server";
import { computePaystubData } from "@/lib/paystub";
import { notifyAdmin } from "@/lib/notify";

export const dynamic = "force-dynamic";

/**
 * GET/POST /api/cron/generate-paystubs
 *
 * Twice-monthly paystub drafts (vercel.json → 5th & 20th):
 *  - On/after the 16th (the 20th run) → cutoff 1–15 of the CURRENT month.
 *  - Before the 16th (the 5th run)   → cutoff 16–end of the PREVIOUS month.
 *
 * For each active VA it computes hours + pay (shared /lib/paystub), saves a
 * DRAFT `paystub_snapshots` row (status='draft', VA NOT emailed), and emails
 * Toni one consolidated review with each VA's amount + hours + a review link.
 * Toni approves each on its review page, which sends the VA copy.
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

function getTimezoneParts(date: Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone, year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(date);
  const m = Object.fromEntries(parts.map((p) => [p.type, p.value]));
  return { year: Number(m.year || "0"), month: Number(m.month || "1"), day: Number(m.day || "1") };
}

function pad2(n: number) { return String(n).padStart(2, "0"); }
function daysInMonth(year: number, month1: number) { return new Date(Date.UTC(year, month1, 0)).getUTCDate(); }
function fmtMoney(n: number) { return n.toLocaleString("en-US", { style: "currency", currency: "USD" }); }
function fmtDateShort(iso: string) {
  return new Date(iso + "T12:00:00Z").toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
}

async function handleCron(request: NextRequest) {
  if (!getCronSecret(request)) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const supabase = serviceClient();
  const { data: settings } = await supabase
    .from("organization_settings")
    .select("timezone, billing_email, org_name")
    .limit(1)
    .single();
  const timeZone = settings?.timezone || "UTC";
  const notifyEmail = settings?.billing_email || null;

  const { year, month, day } = getTimezoneParts(new Date(), timeZone);

  // Pick the cutoff for this run.
  let periodStart: string;
  let periodEnd: string;
  if (day >= 16) {
    // 20th run → first half of the current month
    periodStart = `${year}-${pad2(month)}-01`;
    periodEnd = `${year}-${pad2(month)}-15`;
  } else {
    // 5th run → second half of the previous month
    const pm = month === 1 ? 12 : month - 1;
    const py = month === 1 ? year - 1 : year;
    periodStart = `${py}-${pad2(pm)}-16`;
    periodEnd = `${py}-${pad2(pm)}-${pad2(daysInMonth(py, pm))}`;
  }

  // Manual-run override for testing / off-schedule runs: ?start=YYYY-MM-DD&end=YYYY-MM-DD
  // (still CRON_SECRET-gated above). Lets an admin preview a specific period.
  const url = new URL(request.url);
  const qsStart = url.searchParams.get("start");
  const qsEnd = url.searchParams.get("end");
  if (qsStart && qsEnd && /^\d{4}-\d{2}-\d{2}$/.test(qsStart) && /^\d{4}-\d{2}-\d{2}$/.test(qsEnd)) {
    periodStart = qsStart;
    periodEnd = qsEnd;
  }

  const periodLabel = `${fmtDateShort(periodStart)} – ${fmtDateShort(periodEnd)}`;

  const { data: vas, error: vaError } = await supabase
    .from("profiles")
    .select("id, full_name, is_active, role")
    .eq("is_active", true);
  if (vaError) return Response.json({ error: vaError.message }, { status: 500 });

  const drafts: { user_id: string; name: string; hours: number; gross: number; snapshot_id: string }[] = [];
  const skipped: { name: string; reason: string }[] = [];

  for (const va of (vas ?? []) as { id: string; full_name: string; role: string | null }[]) {
    // Dedup — a paystub (draft or sent) for this VA + period already exists?
    const { data: existing } = await supabase
      .from("paystub_snapshots")
      .select("id")
      .eq("user_id", va.id)
      .eq("period_start", periodStart)
      .eq("period_end", periodEnd)
      .limit(1);
    if (existing && existing.length > 0) { skipped.push({ name: va.full_name, reason: "already exists" }); continue; }

    const calc = await computePaystubData(supabase, va.id, periodStart, periodEnd);
    if (!calc || calc.totalGrossPay <= 0) { skipped.push({ name: va.full_name, reason: "no pay this period" }); continue; }

    const { data: snap, error: snapError } = await supabase
      .from("paystub_snapshots")
      .insert({
        user_id: va.id,
        full_name: va.full_name,
        period_start: periodStart,
        period_end: periodEnd,
        pay_period_label: periodLabel,
        total_hours_ms: calc.totalMs,
        pay_rate: calc.payRate,
        gross_pay: calc.totalGrossPay, // draft shows the full expected amount
        amount_paid: 0,
        by_date: calc.byDateWithRates,
        company_name: settings?.org_name || "MinuteFlow",
        status: "draft",
      })
      .select("id")
      .single();

    if (snapError || !snap) { skipped.push({ name: va.full_name, reason: `insert failed: ${snapError?.message}` }); continue; }

    drafts.push({
      user_id: va.id,
      name: va.full_name,
      hours: calc.totalHours,
      gross: calc.totalGrossPay,
      snapshot_id: snap.id as string,
    });
  }

  // One consolidated review email to Toni
  if (notifyEmail && drafts.length > 0) {
    const rows = drafts.map((d) => `
      <tr>
        <td style="padding:8px 12px;border-bottom:1px solid #e8e0d4;font-size:13px;color:#3d2b1f;">${d.name}</td>
        <td style="padding:8px 12px;border-bottom:1px solid #e8e0d4;font-size:13px;color:#6b5e52;text-align:right;">${d.hours.toFixed(2)}h</td>
        <td style="padding:8px 12px;border-bottom:1px solid #e8e0d4;font-size:13px;color:#3d2b1f;text-align:right;font-weight:600;">${fmtMoney(d.gross)}</td>
        <td style="padding:8px 12px;border-bottom:1px solid #e8e0d4;text-align:right;"><a href="https://minuteflow.click/admin/paystub-review/${d.snapshot_id}" style="font-size:12px;color:#2d3a4a;font-weight:600;">Review →</a></td>
      </tr>`).join("");
    const totalGross = drafts.reduce((s, d) => s + d.gross, 0);
    await notifyAdmin({
      to: notifyEmail,
      fromName: settings?.org_name || "MinuteFlow",
      subject: `Paystub drafts for ${periodLabel} — ${drafts.length} VAs, ${fmtMoney(totalGross)}`,
      text: `${drafts.length} paystub drafts for ${periodLabel}. Review + approve each in MinuteFlow.`,
      html: `<div style="font-family:-apple-system,Segoe UI,Roboto,sans-serif;max-width:560px;margin:0 auto;padding:24px;">
        <div style="font-size:16px;font-weight:800;color:#2d1a00;margin-bottom:4px;">Paystub drafts ready for review</div>
        <div style="font-size:13px;color:#6b5e52;margin-bottom:16px;">Pay period ${periodLabel} — nothing has been sent to the VAs yet.</div>
        <table style="width:100%;border-collapse:collapse;border:1px solid #e8e0d4;border-radius:8px;overflow:hidden;">
          <thead><tr style="background:#faf6f0;">
            <th style="padding:8px 12px;text-align:left;font-size:10px;font-weight:600;text-transform:uppercase;letter-spacing:0.5px;color:#9e9080;border-bottom:1px solid #e8e0d4;">VA</th>
            <th style="padding:8px 12px;text-align:right;font-size:10px;font-weight:600;text-transform:uppercase;letter-spacing:0.5px;color:#9e9080;border-bottom:1px solid #e8e0d4;">Hours</th>
            <th style="padding:8px 12px;text-align:right;font-size:10px;font-weight:600;text-transform:uppercase;letter-spacing:0.5px;color:#9e9080;border-bottom:1px solid #e8e0d4;">Gross</th>
            <th style="border-bottom:1px solid #e8e0d4;"></th>
          </tr></thead>
          <tbody>${rows}</tbody>
        </table>
        <div style="font-size:12px;color:#9e9080;margin-top:12px;">Open each to see the daily breakdown, enter the payment confirmation #, and approve — that sends the VA their paystub.</div>
      </div>`,
    });
  }

  return Response.json({
    generated: drafts.length,
    period: { periodStart, periodEnd, label: periodLabel },
    drafts: drafts.map((d) => ({ name: d.name, hours: d.hours, gross: d.gross })),
    skipped,
  });
}

export async function GET(request: NextRequest) { return handleCron(request); }
export async function POST(request: NextRequest) { return handleCron(request); }
