// Shared paystub-draft generation, used by both the scheduled cron
// (/api/cron/generate-paystubs) and the admin manual trigger
// (/api/paystub/generate-drafts). Computes each active VA's pay for a period,
// saves DRAFT snapshots (VA not emailed), and emails the admin one consolidated
// review with per-VA hours + gross + review links.

import { computePaystubData } from "@/lib/paystub";
import { notifyAdmin } from "@/lib/notify";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnySupabase = any;

function fmtMoney(n: number) { return n.toLocaleString("en-US", { style: "currency", currency: "USD" }); }
function fmtDateShort(iso: string) {
  return new Date(iso + "T12:00:00Z").toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
}

export interface PaystubGenResult {
  generated: number;
  period: { periodStart: string; periodEnd: string; label: string };
  drafts: { name: string; hours: number; gross: number }[];
  skipped: { name: string; reason: string }[];
}

export async function runPaystubDraftGeneration(
  admin: AnySupabase,
  opts: { periodStart: string; periodEnd: string; notifyEmail: string | null; orgName: string | null }
): Promise<PaystubGenResult> {
  const { periodStart, periodEnd, notifyEmail, orgName } = opts;
  const periodLabel = `${fmtDateShort(periodStart)} – ${fmtDateShort(periodEnd)}`;

  const { data: vas } = await admin
    .from("profiles")
    .select("id, full_name, is_active, role")
    .eq("is_active", true);

  const drafts: { user_id: string; name: string; hours: number; gross: number; snapshot_id: string }[] = [];
  const skipped: { name: string; reason: string }[] = [];

  for (const va of (vas ?? []) as { id: string; full_name: string; role: string | null }[]) {
    const { data: existing } = await admin
      .from("paystub_snapshots")
      .select("id")
      .eq("user_id", va.id)
      .eq("period_start", periodStart)
      .eq("period_end", periodEnd)
      .limit(1);
    if (existing && existing.length > 0) { skipped.push({ name: va.full_name, reason: "already exists" }); continue; }

    const calc = await computePaystubData(admin, va.id, periodStart, periodEnd);
    if (!calc || calc.totalGrossPay <= 0) { skipped.push({ name: va.full_name, reason: "no pay this period" }); continue; }

    const { data: snap, error: snapError } = await admin
      .from("paystub_snapshots")
      .insert({
        user_id: va.id,
        full_name: va.full_name,
        period_start: periodStart,
        period_end: periodEnd,
        pay_period_label: periodLabel,
        total_hours_ms: calc.totalMs,
        pay_rate: calc.payRate,
        gross_pay: calc.totalGrossPay,
        amount_paid: 0,
        by_date: calc.byDateWithRates,
        company_name: orgName || "MinuteFlow",
        status: "draft",
      })
      .select("id")
      .single();

    if (snapError || !snap) { skipped.push({ name: va.full_name, reason: `insert failed: ${snapError?.message}` }); continue; }

    drafts.push({ user_id: va.id, name: va.full_name, hours: calc.totalHours, gross: calc.totalGrossPay, snapshot_id: snap.id as string });
  }

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
      fromName: orgName || "MinuteFlow",
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

  return {
    generated: drafts.length,
    period: { periodStart, periodEnd, label: periodLabel },
    drafts: drafts.map((d) => ({ name: d.name, hours: d.hours, gross: d.gross })),
    skipped,
  };
}
