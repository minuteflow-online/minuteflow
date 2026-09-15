import type { SupabaseClient } from "@supabase/supabase-js";

/* Invoice payment state and month-to-month carry-forward.
 *
 * `amount_paid` used to be maintained by adding to (and subtracting from) its
 * own stored value in five separate places — record payment, delete payment,
 * mark paid, mark unpaid, and the Square route. Any delete, or a "Mark as
 * Fully Paid" landing on top of a real payment, left the column disagreeing
 * with `invoice_payments`: MF-2026-042 ended up reading $467.20 against a
 * single $1,500 payment and showed $565.60 "outstanding" on an invoice the
 * client had overpaid.
 *
 * Everything here derives from the payment rows instead. `amount_paid` is a
 * cache of SUM(invoice_payments.amount), never an accumulator.
 */

/** Anything below this is rounding noise, not money. */
const CENT = 0.01;

export type InvoiceStatus =
  | "draft" | "sent" | "paid" | "partially_paid" | "overdue"
  | "cancelled" | "trash" | "ready_to_send" | "archived";

/** Statuses that represent a real bill: only these can carry a balance forward. */
const BILLED_STATUSES: InvoiceStatus[] = ["sent", "partially_paid", "overdue", "paid"];

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function today(): string {
  return new Date().toISOString().split("T")[0];
}

export interface BalanceShape {
  total: number | string;
  previous_balance?: number | string | null;
  amount_paid?: number | string | null;
}

/** What the client owes on this invoice: its own total plus anything carried in. */
export function grandTotal(invoice: BalanceShape): number {
  return round2(Number(invoice.total) + Number(invoice.previous_balance || 0));
}

/**
 * Positive = still owed, negative = overpaid (a credit).
 * Callers that only want one direction should use amountOwed/creditAmount,
 * so a credit is never rendered as a negative "balance due".
 */
export function openBalance(invoice: BalanceShape): number {
  return round2(grandTotal(invoice) - Number(invoice.amount_paid || 0));
}

/** Money still due, floored at zero — an overpaid invoice owes nothing. */
export function amountOwed(invoice: BalanceShape): number {
  const balance = openBalance(invoice);
  return balance > CENT ? balance : 0;
}

/** Overpayment as a positive number, or 0 when the invoice isn't overpaid. */
export function creditAmount(invoice: BalanceShape): number {
  const balance = openBalance(invoice);
  return balance < -CENT ? round2(-balance) : 0;
}

/**
 * Status implied by the money on the invoice.
 *
 * Overpayment reads as "paid" — paying more than the bill has never meant the
 * invoice is partially settled. When every payment is removed the invoice
 * falls back to unpaid rather than staying stuck on paid/partially_paid.
 */
export function derivePaymentStatus(
  amountPaid: number,
  grand: number,
  currentStatus: InvoiceStatus
): InvoiceStatus {
  if (grand > CENT && amountPaid >= grand - CENT) return "paid";
  if (amountPaid > CENT) return "partially_paid";
  if (currentStatus === "paid" || currentStatus === "partially_paid") return "sent";
  return currentStatus;
}

/**
 * Recompute `amount_paid` and `status` from the invoice's payment rows.
 *
 * Call this after any change to invoice_payments rather than adjusting
 * amount_paid at the call site — that arithmetic is what drifted.
 */
export async function syncInvoicePaymentState(
  client: SupabaseClient,
  invoiceId: number
): Promise<{ amount_paid: number; status: InvoiceStatus; paid_date: string | null } | null> {
  const { data: invoice } = await client
    .from("invoices")
    .select("id, total, previous_balance, status, paid_date")
    .eq("id", invoiceId)
    .single();
  if (!invoice) return null;

  const { data: payments } = await client
    .from("invoice_payments")
    .select("amount")
    .eq("invoice_id", invoiceId);

  const amountPaid = round2(
    (payments ?? []).reduce((sum: number, p: { amount: number | string }) => sum + Number(p.amount), 0)
  );
  const status = derivePaymentStatus(amountPaid, grandTotal(invoice), invoice.status as InvoiceStatus);

  // Keep the original paid_date when an invoice stays paid, so a later resync
  // doesn't quietly restate when the client actually settled.
  const paidDate = status === "paid" ? (invoice.paid_date ?? today()) : null;

  await client
    .from("invoices")
    .update({ amount_paid: amountPaid, status, paid_date: paidDate })
    .eq("id", invoiceId);

  return { amount_paid: amountPaid, status, paid_date: paidDate };
}

/* ── Carry-forward ──────────────────────────────────────────── */

export interface CarryCandidate {
  invoice_id: number;
  invoice_number: string;
  issue_date: string;
  period_end: string | null;
  /** Positive = client still owes it, negative = credit owed back to them. */
  amount: number;
  excluded: boolean;
}

export interface CarryTarget {
  clientId?: number | null;
  accountName?: string | null;
}

/**
 * Prior invoices for this client/account that still have money open on them
 * and haven't already been rolled into a later invoice.
 *
 * Both directions come back: a shortfall carries forward as a positive
 * previous_balance, an overpayment as a negative one (a credit). Drafts and
 * dead invoices are ignored — only something actually billed can carry.
 */
export async function fetchCarryCandidates(
  client: SupabaseClient,
  target: CarryTarget,
  excludeInvoiceId?: number
): Promise<CarryCandidate[]> {
  const columns =
    "id, invoice_number, issue_date, period_end, total, previous_balance, amount_paid, status";

  const run = async (withCarryColumn: boolean) => {
    let query = client
      .from("invoices")
      .select(withCarryColumn ? `${columns}, carried_into_invoice_id` : columns)
      .in("status", BILLED_STATUSES);

    if (withCarryColumn) query = query.is("carried_into_invoice_id", null);
    if (target.clientId != null) query = query.eq("client_id", target.clientId);
    else if (target.accountName) query = query.eq("account_name", target.accountName);
    else return { data: [], error: null };

    if (excludeInvoiceId != null) query = query.neq("id", excludeInvoiceId);
    return query.order("issue_date", { ascending: true });
  };

  // carried_into_invoice_id is additive and may not exist yet on an environment
  // that hasn't run the migration; fall back rather than breaking the builder.
  let { data, error } = await run(true);
  if (error) ({ data, error } = await run(false));
  if (error || !data) return [];

  return (data as unknown as Array<BalanceShape & {
    id: number; invoice_number: string; issue_date: string; period_end: string | null; status: string;
  }>)
    // An invoice marked paid is settled by decision, even where the payments
    // don't add up to the full amount — a shortfall there was written off, not
    // left owing, and must never be re-billed. A credit on one still carries.
    .filter((inv) => {
      const balance = openBalance(inv);
      if (Math.abs(balance) <= CENT) return false;
      return !(inv.status === "paid" && balance > 0);
    })
    .map((inv) => ({
      invoice_id: inv.id,
      invoice_number: inv.invoice_number,
      issue_date: inv.issue_date,
      period_end: inv.period_end,
      amount: openBalance(inv),
      excluded: false,
    }));
}

/** Net of the candidates the user left ticked: positive owed, negative credit. */
export function carryTotal(candidates: CarryCandidate[]): number {
  return round2(
    candidates.filter((c) => !c.excluded).reduce((sum, c) => sum + c.amount, 0)
  );
}

/**
 * Plain-English note for the previous-balance line, e.g.
 * "$467.20 credit from MF-2026-042; $70.60 unpaid from MF-2026-046".
 */
export function carryNote(candidates: CarryCandidate[]): string {
  return candidates
    .filter((c) => !c.excluded)
    .map((c) =>
      c.amount < 0
        ? `$${Math.abs(c.amount).toFixed(2)} credit from ${c.invoice_number}`
        : `$${c.amount.toFixed(2)} unpaid from ${c.invoice_number}`
    )
    .join("; ");
}

/**
 * Stamp the invoices whose balance a new invoice absorbed, so the same money
 * can't be carried a second time next month. Unticked candidates are left
 * alone and stay available to carry later.
 */
export async function markCarried(
  client: SupabaseClient,
  candidates: CarryCandidate[],
  intoInvoiceId: number
): Promise<void> {
  const ids = candidates.filter((c) => !c.excluded).map((c) => c.invoice_id);
  if (ids.length === 0) return;
  await client
    .from("invoices")
    .update({ carried_into_invoice_id: intoInvoiceId })
    .in("id", ids);
}
