import { describe, it, expect } from "vitest";
import { buildReceiptEmail } from "@/lib/invoiceReceiptEmail";

const base = {
  invoiceNumber: "MF-2026-050",
  toName: "Ting Chiu",
  amountPaid: 250,
  total: 1000,
  balanceRemaining: 750,
  isPaid: false,
  receiptUrl: "https://squareup.com/receipt/preview/abc123",
  currency: "USD",
};

describe("buildReceiptEmail", () => {
  it("shows an ordinary name, number and amounts as they are", () => {
    const html = buildReceiptEmail(base);
    expect(html).toContain("Hi Ting Chiu,");
    expect(html).toContain("<strong>MF-2026-050</strong>");
    expect(html).toContain("$250.00");
    expect(html).toContain("$750.00");
    expect(html).toContain('href="https://squareup.com/receipt/preview/abc123"');
    expect(html).toContain("Payment Recorded");
  });

  it("says paid in full when the invoice is settled", () => {
    const html = buildReceiptEmail({ ...base, isPaid: true, balanceRemaining: 0 });
    expect(html).toContain("Payment Received");
    expect(html).toContain("paid in full");
  });

  it("falls back to 'there' and leaves out the receipt button when missing", () => {
    const html = buildReceiptEmail({ ...base, toName: null, receiptUrl: null });
    expect(html).toContain("Hi there,");
    expect(html).not.toContain("View Square Receipt");
  });

  it("labels a non-USD currency", () => {
    expect(buildReceiptEmail({ ...base, currency: "CAD" })).toContain("$250.00 CAD");
  });

  it("shows markup in the name, number and link as plain text", () => {
    const html = buildReceiptEmail({
      ...base,
      toName: '<img src=x onerror="alert(1)">',
      invoiceNumber: "<script>x</script>",
      receiptUrl: 'https://x.test/"><script>y</script>',
    });
    expect(html).not.toContain("<img src=x");
    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;img src=x onerror=&quot;alert(1)&quot;&gt;");
    expect(html).toContain("&lt;script&gt;x&lt;/script&gt;");
  });
});
