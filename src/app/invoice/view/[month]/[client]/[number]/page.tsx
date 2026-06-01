import { createClient } from "@supabase/supabase-js";
import { redirect, notFound } from "next/navigation";

/* ── Month name → number map ─────────────────────────────── */
const MONTH_NUMS: Record<string, number> = {
  january: 1, february: 2, march: 3, april: 4, may: 5, june: 6,
  july: 7, august: 8, september: 9, october: 10, november: 11, december: 12,
};

function slugify(str: string): string {
  return str
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

/** Resolve a custom invoice URL to its share_token and redirect.
 *
 *  URL format: /invoice/view/june2025/toni-colina/001
 *  - month:  lower-case month name + 4-digit year (e.g. "june2025")
 *  - client: slugified account_name (or to_name if account_name is null)
 *  - number: invoice_number as-is (will be compared case-insensitively)
 */
export default async function SlugInvoicePage({
  params,
}: {
  params: Promise<{ month: string; client: string; number: string }>;
}) {
  const { month, client, number } = await params;

  /* Parse month slug: "june2025" → { monthNum: 6, year: 2025 } */
  const monthMatch = month.match(/^([a-z]+)(\d{4})$/i);
  if (!monthMatch) return notFound();

  const monthNum = MONTH_NUMS[monthMatch[1].toLowerCase()];
  const year = parseInt(monthMatch[2], 10);
  if (!monthNum) return notFound();

  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );

  /* Pull all invoices that match the invoice number and have a share_token.
   * We can't slug-filter in SQL easily, so we filter client-side. */
  const { data: invoices } = await supabase
    .from("invoices")
    .select("id, share_token, account_name, to_name, invoice_number, issue_date")
    .ilike("invoice_number", number)
    .not("share_token", "is", null);

  if (!invoices?.length) return notFound();

  /* Filter by month + year + client slug */
  const match = invoices.find((inv) => {
    // Parse issue_date at noon UTC to avoid TZ shift issues
    const d = new Date(inv.issue_date + "T12:00:00Z");
    if (d.getUTCMonth() + 1 !== monthNum || d.getUTCFullYear() !== year) return false;

    const nameForSlug = inv.account_name || inv.to_name || "";
    return slugify(nameForSlug) === client;
  });

  if (!match?.share_token) return notFound();

  redirect(`/invoice/view/${match.share_token}`);
}
