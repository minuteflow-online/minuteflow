import { describe, it, expect, vi, afterEach } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { syncInvoicePaymentState } from "./invoiceBalance";

interface FakeOptions {
  invoice?: Record<string, unknown> | null;
  payments?: Array<{ amount: number | string }>;
  paymentsError?: unknown;
  updateError?: unknown;
}

/** Minimal stand-in for the three calls syncInvoicePaymentState makes. */
function fakeClient(opts: FakeOptions) {
  const updates: Array<Record<string, unknown>> = [];
  const client = {
    from(table: string) {
      if (table === "invoices") {
        return {
          select: () => ({
            eq: () => ({ single: async () => ({ data: opts.invoice ?? null, error: null }) }),
          }),
          update: (values: Record<string, unknown>) => ({
            eq: async () => {
              updates.push(values);
              return { error: opts.updateError ?? null };
            },
          }),
        };
      }
      return {
        select: () => ({
          eq: async () => ({
            data: opts.paymentsError ? null : opts.payments ?? [],
            error: opts.paymentsError ?? null,
          }),
        }),
      };
    },
  };
  return { client: client as unknown as SupabaseClient, updates };
}

const invoice = { id: 7, total: 100, previous_balance: 0, status: "sent", paid_date: null };

afterEach(() => vi.restoreAllMocks());

describe("syncInvoicePaymentState", () => {
  it("saves and returns the state derived from the payment rows", async () => {
    const { client, updates } = fakeClient({ invoice, payments: [{ amount: 40 }, { amount: "60" }] });
    const result = await syncInvoicePaymentState(client, 7);
    expect(result?.amount_paid).toBe(100);
    expect(result?.status).toBe("paid");
    expect(result?.paid_date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(updates).toEqual([{ amount_paid: 100, status: "paid", paid_date: result?.paid_date }]);
  });

  it("marks a partly paid invoice as partially_paid", async () => {
    const { client, updates } = fakeClient({ invoice, payments: [{ amount: 25 }] });
    const result = await syncInvoicePaymentState(client, 7);
    expect(result).toEqual({ amount_paid: 25, status: "partially_paid", paid_date: null });
    expect(updates).toHaveLength(1);
  });

  it("returns null and logs when saving the update fails", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const { client } = fakeClient({ invoice, payments: [{ amount: 100 }], updateError: { message: "boom" } });
    expect(await syncInvoicePaymentState(client, 7)).toBeNull();
    expect(spy).toHaveBeenCalledOnce();
  });

  it("returns null and writes nothing when reading payments fails", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const { client, updates } = fakeClient({ invoice, paymentsError: { message: "boom" } });
    expect(await syncInvoicePaymentState(client, 7)).toBeNull();
    expect(updates).toHaveLength(0);
    expect(spy).toHaveBeenCalledOnce();
  });

  it("still returns null when the invoice does not exist", async () => {
    const { client, updates } = fakeClient({ invoice: null });
    expect(await syncInvoicePaymentState(client, 7)).toBeNull();
    expect(updates).toHaveLength(0);
  });
});
