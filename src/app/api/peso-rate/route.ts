import { createClient } from "@supabase/supabase-js";
import { requireFinancialAccess } from "@/lib/financialAccessServer";
import { parsePhpPerUsd } from "@/lib/payroll";

export const dynamic = "force-dynamic";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;

/**
 * POST { php_per_usd } — sets the default Peso Rate (₱ per $1) from the
 * Financial tab.
 *
 * Saved server-side because organization_settings' update policy only admits
 * role = 'admin', so a founder or accounting saving from the browser was
 * silently rejected (zero rows, no error). Gated on financial access instead,
 * same as pay rates.
 *
 * Written to every organization_settings row: readers take whichever row
 * `.limit(1)` returns first, and that order isn't guaranteed, so one row with
 * the rate and one without would make it come and go.
 */
export async function POST(request: Request) {
  const authResult = await requireFinancialAccess();
  if (authResult instanceof Response) return authResult;

  const body = await request.json().catch(() => ({}));
  const rate = parsePhpPerUsd(body?.php_per_usd);
  if (rate == null) {
    return Response.json({ error: "Enter pesos per $1, e.g. 58.50." }, { status: 400 });
  }

  const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const { data, error } = await admin
    .from("organization_settings")
    .update({ php_per_usd: rate, updated_at: new Date().toISOString() })
    .not("id", "is", null)
    .select("id");

  if (error) return Response.json({ error: error.message }, { status: 400 });
  if (!data || data.length === 0) {
    return Response.json({ error: "No organization settings row to save to." }, { status: 404 });
  }
  return Response.json({ success: true, php_per_usd: rate });
}
