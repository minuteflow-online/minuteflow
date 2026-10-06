"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { normalizePayCurrency, type PayCurrency } from "@/lib/payroll";

/**
 * A user's pay currency (profiles.pay_currency), for widgets that show that
 * person's own task rates — work assigned to a peso-paid VA reads ₱, not $.
 * USD until loaded or when unset, same as every row before currencies existed.
 */
export function usePayCurrency(userId?: string | null): PayCurrency {
  const [currency, setCurrency] = useState<PayCurrency>("USD");

  useEffect(() => {
    if (!userId) return;
    let cancelled = false;
    createClient()
      .from("profiles")
      .select("pay_currency")
      .eq("id", userId)
      .maybeSingle()
      .then(({ data }) => {
        if (!cancelled) setCurrency(normalizePayCurrency(data?.pay_currency));
      });
    return () => {
      cancelled = true;
    };
  }, [userId]);

  return currency;
}
