// The payment receipt email sent after an online invoice payment. Lives in its own
// file so the text escaping can be tested without taking a payment.
import { esc } from "@/lib/approvalPages";

export interface ReceiptEmailParams {
  invoiceNumber: string;
  toName: string | null;
  amountPaid: number;
  total: number;
  balanceRemaining: number;
  isPaid: boolean;
  receiptUrl: string | null;
  currency: string;
}

export function buildReceiptEmail(p: ReceiptEmailParams): string {
  const fmt = (n: number) => `$${n.toFixed(2)}`;
  const currencyLabel = p.currency !== "USD" ? ` ${p.currency}` : "";
  return `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"></head>
<body style="margin:0;padding:0;background-color:#f5f0e8;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
  <div style="max-width:560px;margin:0 auto;padding:32px 16px;">
    <div style="background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,0.08);">
      <div style="background:#1a1a2e;padding:28px 32px;text-align:center;">
        <p style="margin:0;font-size:13px;color:#9ca3af;letter-spacing:0.05em;text-transform:uppercase;">MinuteFlow</p>
        <h1 style="margin:8px 0 0;font-size:24px;color:#fff;font-weight:700;">Payment ${p.isPaid ? "Received" : "Recorded"}</h1>
      </div>
      <div style="padding:32px;">
        <p style="margin:0 0 24px;font-size:15px;color:#374151;">Hi ${p.toName ? esc(p.toName) : "there"},</p>
        <p style="margin:0 0 24px;font-size:15px;color:#374151;">
          We have received your payment of <strong>${fmt(p.amountPaid)}${esc(currencyLabel)}</strong> for Invoice <strong>${esc(p.invoiceNumber)}</strong>.
          ${p.isPaid ? "This invoice is now <strong>paid in full</strong>. Thank you!" : `Your remaining balance is <strong>${fmt(p.balanceRemaining)}${esc(currencyLabel)}</strong>.`}
        </p>
        <div style="background:#f9fafb;border:1px solid #e5e7eb;border-radius:8px;padding:16px 20px;margin-bottom:24px;">
          <table style="width:100%;border-collapse:collapse;">
            <tr>
              <td style="padding:6px 0;font-size:14px;color:#6b7280;">Invoice</td>
              <td style="padding:6px 0;font-size:14px;color:#111827;text-align:right;">${esc(p.invoiceNumber)}</td>
            </tr>
            <tr>
              <td style="padding:6px 0;font-size:14px;color:#6b7280;">Payment Amount</td>
              <td style="padding:6px 0;font-size:14px;color:#111827;text-align:right;">${fmt(p.amountPaid)}${esc(currencyLabel)}</td>
            </tr>
            <tr>
              <td style="padding:6px 0;font-size:14px;color:#6b7280;">Invoice Total</td>
              <td style="padding:6px 0;font-size:14px;color:#111827;text-align:right;">${fmt(p.total)}${esc(currencyLabel)}</td>
            </tr>
            ${!p.isPaid ? `<tr>
              <td style="padding:6px 0;font-size:14px;color:#6b7280;">Balance Remaining</td>
              <td style="padding:6px 0;font-size:14px;color:#d97706;font-weight:600;text-align:right;">${fmt(p.balanceRemaining)}${esc(currencyLabel)}</td>
            </tr>` : `<tr>
              <td style="padding:6px 0;font-size:14px;color:#6b7280;">Status</td>
              <td style="padding:6px 0;font-size:14px;color:#16a34a;font-weight:600;text-align:right;">Paid in Full</td>
            </tr>`}
          </table>
        </div>
        ${p.receiptUrl ? `<div style="text-align:center;margin-bottom:24px;">
          <a href="${esc(p.receiptUrl)}" style="display:inline-block;background:#1a1a2e;color:#fff;text-decoration:none;padding:12px 28px;border-radius:8px;font-size:14px;font-weight:600;">View Square Receipt</a>
        </div>` : ""}
        <p style="margin:0;font-size:13px;color:#9ca3af;text-align:center;">Questions? Reply to this email or contact your account manager.</p>
      </div>
    </div>
  </div>
</body>
</html>`;
}
