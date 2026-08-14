// Shared recurring-invoice generation, used by both the scheduled cron
// (/api/cron/generate-recurring-invoices) and the admin manual trigger
// (/api/invoices/generate-recurring). Logic moved verbatim from the cron so
// behavior is identical — see that route's header for the rules.

import { notifyAdmin } from "@/lib/notify";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnySupabase = any;

interface InvoiceRow {
  id: number;
  invoice_number: string;
  client_id: number | null;
  account_name: string | null;
  status: string;
  from_name: string;
  from_phone: string | null;
  from_address: string | null;
  from_email: string | null;
  from_logo_url: string | null;
  dba: string | null;
  to_name: string;
  to_contact: string | null;
  to_email: string | null;
  to_phone: string | null;
  to_address: string | null;
  service_type: string | null;
  currency: string;
  notes: string | null;
  payment_link: string | null;
  payment_info: string | null;
  reminder_enabled: boolean | null;
  rate_amount: number | null;
  invoice_type: "timelog" | "custom" | null;
  custom_line_items: string | null;
  subtotal: number | null;
  is_recurring: boolean | null;
  recurring_series_id: string | null;
  period_start: string | null;
  period_end: string | null;
}

interface TimeLogRow {
  id: number;
  task_name: string;
  username: string | null;
  account: string | null;
  category: string | null;
  project: string | null;
  client_memo: string | null;
  duration_ms: number;
  start_time: string;
  client_name: string | null;
}

function getTimezoneParts(date: Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone, year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(date);
  const mapped = Object.fromEntries(parts.map((p) => [p.type, p.value]));
  return { year: Number(mapped.year || "0"), month: Number(mapped.month || "1"), day: Number(mapped.day || "1") };
}

function pad2(n: number) { return String(n).padStart(2, "0"); }
function daysInMonth(year: number, month1: number) { return new Date(Date.UTC(year, month1, 0)).getUTCDate(); }
function formatCurrency(amount: number, currency = "USD") {
  return new Intl.NumberFormat("en-US", { style: "currency", currency }).format(amount);
}

function makeSendCode() {
  const alphabet = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
  let code = "";
  for (let i = 0; i < 6; i++) code += alphabet[Math.floor(Math.random() * alphabet.length)];
  return code;
}

async function nextInvoiceNumber(supabase: AnySupabase, year: number): Promise<string> {
  const { data } = await supabase
    .from("invoices")
    .select("invoice_number")
    .like("invoice_number", `MF-${year}-%`);
  const maxNum = (data ?? []).reduce((max: number, inv: { invoice_number: string }) => {
    const num = parseInt(inv.invoice_number.split("-")[2] || "0", 10);
    return num > max ? num : max;
  }, 0);
  return `MF-${year}-${String(maxNum + 1).padStart(3, "0")}`;
}

export interface InvoiceGenResult {
  generated: number;
  period: { periodStart: string; periodEnd: string };
  results: { series: string; invoice_number?: string; type?: string; total?: number; hours?: number; skipped?: string }[];
}

export async function runRecurringInvoiceGeneration(
  supabase: AnySupabase,
  opts: { notifyEmail: string | null; orgName: string | null; timeZone: string }
): Promise<InvoiceGenResult> {
  const { notifyEmail, orgName, timeZone } = opts;

  const now = new Date();
  const { year, month, day } = getTimezoneParts(now, timeZone);

  // Bill for the just-completed calendar month.
  const prevMonth = month === 1 ? 12 : month - 1;
  const prevYear = month === 1 ? year - 1 : year;
  const periodStart = `${prevYear}-${pad2(prevMonth)}-01`;
  const periodEnd = `${prevYear}-${pad2(prevMonth)}-${pad2(daysInMonth(prevYear, prevMonth))}`;

  const { data: templates } = await supabase
    .from("invoices")
    .select("*")
    .eq("is_recurring", true)
    .not("recurring_series_id", "is", null)
    .not("status", "in", '("cancelled","trash")');

  const results: InvoiceGenResult["results"] = [];

  for (const template of (templates ?? []) as InvoiceRow[]) {
    const seriesId = template.recurring_series_id!;

    const { data: existing } = await supabase
      .from("invoices")
      .select("id")
      .eq("recurring_series_id", seriesId)
      .eq("period_start", periodStart)
      .limit(1);
    if (existing && existing.length > 0) {
      results.push({ series: seriesId, skipped: "already generated for period" });
      continue;
    }

    const { data: latestRows } = await supabase
      .from("invoices")
      .select("*")
      .eq("recurring_series_id", seriesId)
      .order("period_start", { ascending: false, nullsFirst: false })
      .order("created_at", { ascending: false })
      .limit(1);
    const source = ((latestRows && latestRows[0]) as InvoiceRow) || template;

    const isHourly = (source.invoice_type ?? "custom") === "timelog";
    const issueDate = `${year}-${pad2(month)}-${pad2(day)}`;
    const sendCode = makeSendCode();

    let subtotal = 0;
    let totalHours = 0;
    let timelogItems: {
      quantity: number; description: string; va_name: string | null;
      account_name: string | null; category: string | null; project: string | null;
      client_memo: string | null; log_id: number; service_date: string; start_time: string;
    }[] = [];

    if (isHourly) {
      const rate = Number(source.rate_amount) || 0;

      let clientName: string | null = null;
      if (source.client_id != null) {
        const { data: client } = await supabase.from("clients").select("name").eq("id", source.client_id).single();
        clientName = client?.name ?? null;
      }

      const { data: activeInv } = await supabase
        .from("invoices")
        .select("id")
        .in("status", ["sent", "paid", "partially_paid", "overdue", "ready_to_send"]);
      const activeIds = new Set((activeInv ?? []).map((i: { id: number }) => i.id));
      const { data: usedItems } = await supabase
        .from("invoice_line_items")
        .select("log_id, invoice_id")
        .not("log_id", "is", null);
      const usedLogIds = new Set(
        (usedItems ?? [])
          .filter((it: { invoice_id: number }) => activeIds.has(it.invoice_id))
          .map((it: { log_id: number | null }) => it.log_id)
      );

      let q = supabase
        .from("time_logs")
        .select("id, task_name, username, account, category, project, client_memo, duration_ms, start_time, client_name")
        .eq("billable", true)
        .gte("start_time", new Date(periodStart).toISOString())
        .lte("start_time", new Date(periodEnd + "T23:59:59").toISOString())
        .order("start_time", { ascending: true });
      if (clientName) q = q.eq("client_name", clientName);
      else if (source.account_name) q = q.eq("account", source.account_name);

      const { data: logs } = await q;
      const avail = ((logs ?? []) as TimeLogRow[]).filter((l) => !usedLogIds.has(l.id));

      timelogItems = avail.map((log) => {
        const hours = Math.round((log.duration_ms / 3600000) * 100) / 100;
        totalHours += hours;
        return {
          log_id: log.id,
          description: log.task_name,
          va_name: log.username,
          account_name: log.account || null,
          category: log.category || null,
          project: log.project || null,
          client_memo: log.client_memo || null,
          quantity: hours,
          service_date: new Date(log.start_time).toISOString().split("T")[0],
          start_time: log.start_time,
        };
      });
      totalHours = Math.round(totalHours * 100) / 100;
      subtotal = Math.round(totalHours * rate * 100) / 100;
    } else {
      subtotal = Number(source.subtotal) || 0;
    }

    const finalTotal = Math.round(subtotal * 100) / 100;

    let created: { id: number; invoice_number: string } | null = null;
    for (let attempt = 0; attempt < 5; attempt++) {
      const invoiceNumber = await nextInvoiceNumber(supabase, year);
      const payload = {
        invoice_number: invoiceNumber,
        client_id: source.client_id,
        account_name: source.account_name,
        status: "draft" as const,
        review_status: "pending_review",
        send_code: sendCode,
        from_name: source.from_name,
        from_phone: source.from_phone,
        from_address: source.from_address,
        from_email: source.from_email,
        from_logo_url: source.from_logo_url,
        dba: source.dba,
        to_name: source.to_name,
        to_contact: source.to_contact,
        to_email: source.to_email,
        to_phone: source.to_phone,
        to_address: source.to_address,
        service_type: source.service_type,
        issue_date: issueDate,
        subtotal,
        tax_rate: 0,
        tax_amount: 0,
        total: finalTotal,
        adjustment_amount: 0,
        currency: source.currency || "USD",
        notes: source.notes,
        payment_link: source.payment_link,
        payment_info: source.payment_info,
        reminder_enabled: source.reminder_enabled ?? false,
        rate_amount: source.rate_amount,
        invoice_type: source.invoice_type ?? "custom",
        custom_line_items: isHourly ? null : source.custom_line_items,
        share_token: crypto.randomUUID(),
        period_start: periodStart,
        period_end: periodEnd,
        is_recurring: false,
        recurring_series_id: seriesId,
      };
      const { data, error } = await supabase.from("invoices").insert(payload).select("id, invoice_number").single();
      if (!error && data) { created = data as { id: number; invoice_number: string }; break; }
      if (error?.code === "23505") continue;
      results.push({ series: seriesId, skipped: `insert failed: ${error?.message}` });
      break;
    }

    if (!created) continue;

    if (isHourly && timelogItems.length > 0) {
      await supabase.from("invoice_line_items").insert(
        timelogItems.map((li, idx) => ({
          invoice_id: created!.id,
          log_id: li.log_id,
          description: li.description,
          va_name: li.va_name,
          account_name: li.account_name,
          category: li.category,
          project: li.project,
          client_memo: li.client_memo,
          quantity: li.quantity,
          unit_price: 0,
          amount: 0,
          service_date: li.service_date,
          start_time: li.start_time,
          sort_order: idx,
        }))
      );
    }

    results.push({
      series: seriesId,
      invoice_number: created.invoice_number,
      type: isHourly ? "timelog" : "custom",
      total: finalTotal,
      ...(isHourly ? { hours: totalHours } : {}),
    });

    if (notifyEmail) {
      const reviewUrl = `https://minuteflow.click/admin/invoice-review/${created.id}`;
      const hoursLine = isHourly ? `<div style="font-size:13px;color:#3d2b1f;">Total hours: <strong>${totalHours.toFixed(2)}h</strong></div>` : "";
      const askLine = isHourly ? "" : `<div style="font-size:13px;color:#3d2b1f;margin-top:6px;">Want to change or add anything before it goes out? Open the review page below.</div>`;
      await notifyAdmin({
        to: notifyEmail,
        fromName: source.from_name || orgName || "MinuteFlow",
        subject: `Invoice draft ${created.invoice_number} ready for review — ${formatCurrency(finalTotal, source.currency || "USD")}${isHourly ? ` · ${totalHours.toFixed(2)}h` : ""}`,
        text: `Draft ${created.invoice_number} for ${source.to_name}: ${formatCurrency(finalTotal, source.currency || "USD")}. Send code: ${sendCode}. Review: ${reviewUrl}`,
        html: `<div style="font-family:-apple-system,Segoe UI,Roboto,sans-serif;max-width:520px;margin:0 auto;padding:24px;">
          <div style="font-size:16px;font-weight:800;color:#2d1a00;margin-bottom:8px;">Invoice draft ready for review</div>
          <div style="font-size:13px;color:#3d2b1f;">Invoice <strong>${created.invoice_number}</strong> (${isHourly ? "hourly" : "fixed"}) — draft, not sent to the client.</div>
          <div style="font-size:13px;color:#3d2b1f;">Bill to: <strong>${source.to_name}</strong></div>
          <div style="font-size:13px;color:#3d2b1f;">Period: ${periodStart} → ${periodEnd}</div>
          <div style="font-size:13px;color:#3d2b1f;">Total: <strong>${formatCurrency(finalTotal, source.currency || "USD")}</strong></div>
          ${hoursLine}${askLine}
          <div style="margin:16px 0;padding:12px 16px;background:#faf6f0;border:1px solid #e8e0d4;border-radius:8px;">
            <div style="font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:0.5px;color:#9e9080;">Send code</div>
            <div style="font-size:22px;font-weight:800;letter-spacing:3px;color:#c0704e;">${sendCode}</div>
            <div style="font-size:11px;color:#9e9080;">You'll type this on the review page to unlock Send.</div>
          </div>
          <a href="${reviewUrl}" style="display:inline-block;background:#2d3a4a;color:#fff;font-size:14px;font-weight:700;padding:12px 24px;border-radius:8px;text-decoration:none;">Review invoice →</a>
        </div>`,
      });
    }
  }

  return { generated: results.filter((r) => r.invoice_number).length, period: { periodStart, periodEnd }, results };
}
