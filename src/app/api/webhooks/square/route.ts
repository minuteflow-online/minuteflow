import { createClient as createServiceClient } from "@supabase/supabase-js";
import crypto from "crypto";

export const dynamic = "force-dynamic";

/**
 * POST /api/webhooks/square
 * Handles Square webhook events (payment.completed, payment.updated).
 * Square sends a signature in the `x-square-hmacsha256-signature` header.
 */
export async function POST(request: Request) {
  const body = await request.text();
  const signature = request.headers.get("x-square-hmacsha256-signature");

  // Signature verification (requires SQUARE_WEBHOOK_SIGNATURE_KEY env var)
  const webhookKey = process.env.SQUARE_WEBHOOK_SIGNATURE_KEY;
  if (webhookKey && signature) {
    const url = process.env.NEXT_PUBLIC_APP_URL
      ? `${process.env.NEXT_PUBLIC_APP_URL}/api/webhooks/square`
      : "";
    const expectedSig = crypto
      .createHmac("sha256", webhookKey)
      .update(url + body)
      .digest("base64");
    if (expectedSig !== signature) {
      return Response.json({ error: "Invalid signature" }, { status: 401 });
    }
  }

  let event: { type?: string; data?: { object?: { payment?: Record<string, unknown> } } };
  try {
    event = JSON.parse(body);
  } catch {
    return Response.json({ error: "Invalid JSON" }, { status: 400 });
  }

  // We only care about completed/updated payments
  if (event.type !== "payment.completed" && event.type !== "payment.updated") {
    return Response.json({ received: true });
  }

  const payment = event.data?.object?.payment;
  if (!payment || !payment.id || payment.status !== "COMPLETED") {
    return Response.json({ received: true });
  }

  const squarePaymentId = payment.id as string;

  // Check if this payment was already recorded (by our own POST handler)
  const serviceClient = createServiceClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );

  const { data: existing } = await serviceClient
    .from("invoice_payments")
    .select("id")
    .eq("square_payment_id", squarePaymentId)
    .single();

  if (existing) {
    // Already recorded — just update the receipt URL if available
    if (payment.receipt_url) {
      await serviceClient
        .from("invoice_payments")
        .update({ square_receipt_url: payment.receipt_url as string })
        .eq("square_payment_id", squarePaymentId);
    }
    return Response.json({ received: true });
  }

  // Payment not found — this might be a payment created outside MinuteFlow
  // We log it but don't auto-match since we can't reliably tie it to an invoice
  console.log("Square webhook: unmatched payment", squarePaymentId);

  return Response.json({ received: true });
}
