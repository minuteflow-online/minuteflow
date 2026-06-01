import { createClient as createServiceClient } from "@supabase/supabase-js";

export const dynamic = "force-dynamic";

/** GET /api/invoices/public/[token] — public, no auth required */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ token: string }> }
) {
  const { token } = await params;

  if (!token) {
    return Response.json({ error: "Token is required" }, { status: 400 });
  }

  const serviceClient = createServiceClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );

  // Fetch invoice by share_token
  const { data: invoice, error: invError } = await serviceClient
    .from("invoices")
    .select("*")
    .eq("share_token", token)
    .single();

  if (invError || !invoice) {
    return Response.json({ error: "Invoice not found" }, { status: 404 });
  }

  // Fetch line items
  const { data: lineItems } = await serviceClient
    .from("invoice_line_items")
    .select("*")
    .eq("invoice_id", invoice.id)
    .order("sort_order", { ascending: true });

  // Fetch org settings (public info only)
  const { data: orgSettings } = await serviceClient
    .from("organization_settings")
    .select("timezone, registered_business_name, dba")
    .limit(1)
    .single();

  return Response.json({
    invoice,
    lineItems: lineItems ?? [],
    orgSettings: orgSettings ?? null,
  });
}
