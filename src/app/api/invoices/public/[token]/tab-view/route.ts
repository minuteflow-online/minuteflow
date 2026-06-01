import { createClient as createServiceClient } from "@supabase/supabase-js";

export const dynamic = "force-dynamic";

/** POST /api/invoices/public/[token]/tab-view — log time spent on a tab */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ token: string }> }
) {
  try {
    const { token } = await params;
    if (!token) return Response.json({ error: "Token required" }, { status: 400 });

    const body = await request.json().catch(() => null);
    if (!body) return Response.json({ error: "Invalid body" }, { status: 400 });

    const { tab_name = "time_allocation", duration_seconds = 0 } = body;
    const durationSec = Math.max(0, Math.round(Number(duration_seconds)));

    // Only log if they actually spent time there
    if (durationSec < 1) return Response.json({ ok: true });

    const serviceClient = createServiceClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    );

    // Find invoice by token
    const { data: invoice, error } = await serviceClient
      .from("invoices")
      .select("id")
      .eq("share_token", token)
      .single();

    if (error || !invoice) return Response.json({ error: "Invoice not found" }, { status: 404 });

    await serviceClient.from("invoice_tab_views").insert({
      invoice_id: invoice.id,
      tab_name,
      duration_seconds: durationSec,
    });

    return Response.json({ ok: true });
  } catch {
    return Response.json({ error: "Internal error" }, { status: 500 });
  }
}
