import { createClient } from "@supabase/supabase-js";
import { createClient as createServerClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const RESEND_API_KEY = process.env.RESEND_API_KEY!;

function createServiceClient() {
  return createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

/**
 * POST /api/capture-alerts
 * Called when a VA's screen share stream drops.
 * Creates a capture_alerts row and sends an email notification to the VA.
 */
export async function POST() {
  const supabase = await createServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const serviceClient = createServiceClient();

  // Get VA profile (full_name)
  const { data: profile } = await serviceClient
    .from("profiles")
    .select("full_name, username")
    .eq("id", user.id)
    .single();

  // Get VA email from auth
  const { data: authUser } = await serviceClient.auth.admin.getUserById(user.id);
  const vaEmail = authUser?.user?.email;

  // Insert capture alert
  const { data: alert, error: insertError } = await serviceClient
    .from("capture_alerts")
    .insert({
      user_id: user.id,
      alerted_at: new Date().toISOString(),
      session_date: new Date().toISOString().split("T")[0],
    })
    .select("id")
    .single();

  if (insertError || !alert) {
    console.error("Failed to insert capture_alert:", insertError);
    return Response.json({ error: "Failed to log alert" }, { status: 500 });
  }

  // Send email to VA
  let emailSent = false;
  if (vaEmail) {
    const alertTime = new Date().toLocaleTimeString("en-US", {
      hour: "numeric",
      minute: "2-digit",
      hour12: true,
    });

    const html = `
      <div style="font-family: sans-serif; max-width: 480px; margin: 0 auto; padding: 32px 24px; background: #fdf8f3; border-radius: 12px;">
        <div style="text-align: center; margin-bottom: 24px;">
          <span style="font-size: 40px;">⚠️</span>
        </div>
        <h2 style="font-family: Georgia, serif; font-size: 20px; color: #2d1f0e; margin: 0 0 12px 0; text-align: center;">
          Screen Share Stopped
        </h2>
        <p style="color: #6b5744; font-size: 14px; line-height: 1.6; margin: 0 0 16px 0;">
          Hi ${profile?.full_name || "there"},
        </p>
        <p style="color: #6b5744; font-size: 14px; line-height: 1.6; margin: 0 0 16px 0;">
          Your screen capture stopped at <strong>${alertTime}</strong>. Your activity cannot be tracked until you reshare.
        </p>
        <p style="color: #6b5744; font-size: 14px; line-height: 1.6; margin: 0 0 24px 0;">
          Please go back to MinuteFlow and click <strong>"Reshare Now"</strong> in the banner at the top of the page.
        </p>
        <div style="text-align: center;">
          <a href="https://minuteflow.click/dashboard" style="display: inline-block; background: #c7593a; color: white; text-decoration: none; font-size: 14px; font-weight: 600; padding: 12px 28px; border-radius: 8px;">
            Go to MinuteFlow
          </a>
        </div>
        <p style="color: #b09680; font-size: 12px; margin: 24px 0 0 0; text-align: center;">
          MinuteFlow · Time Tracking for Virtual Assistants
        </p>
      </div>
    `;

    try {
      const resendRes = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${RESEND_API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          from: "MinuteFlow <noreply@minuteflow.click>",
          to: [vaEmail],
          subject: `⚠️ Your screen share stopped at ${alertTime}`,
          html,
        }),
      });

      if (resendRes.ok) {
        emailSent = true;
        await serviceClient
          .from("capture_alerts")
          .update({
            email_sent: true,
            email_sent_at: new Date().toISOString(),
          })
          .eq("id", alert.id);
      }
    } catch (err) {
      console.error("Failed to send capture alert email:", err);
    }
  }

  return Response.json({ id: alert.id, emailSent });
}

/**
 * PATCH /api/capture-alerts
 * Called when the VA clicks "Reshare Now" or "Dismiss" on the banner.
 * Body: { id: number, action: 'reshared' | 'dismissed' }
 */
export async function PATCH(request: Request) {
  const supabase = await createServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await request.json();
  const { id, action } = body as { id: number; action: "reshared" | "dismissed" };

  if (!id || !action || !["reshared", "dismissed"].includes(action)) {
    return Response.json({ error: "Invalid request" }, { status: 400 });
  }

  const serviceClient = createServiceClient();

  // Verify ownership
  const { data: existing } = await serviceClient
    .from("capture_alerts")
    .select("user_id")
    .eq("id", id)
    .single();

  if (!existing || existing.user_id !== user.id) {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }

  const { error } = await serviceClient
    .from("capture_alerts")
    .update({
      action,
      action_at: new Date().toISOString(),
    })
    .eq("id", id);

  if (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }

  return Response.json({ ok: true });
}
