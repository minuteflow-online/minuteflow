import { createClient as createAdminClient } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import { randomBytes } from "crypto";

export const dynamic = "force-dynamic";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL || "https://minuteflow.click";
const RESEND_API_KEY = process.env.RESEND_API_KEY!;

function makeAdminClient() {
  return createAdminClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

/** Verify the caller is an authenticated admin */
async function verifyAdmin(): Promise<{ userId: string } | Response> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const { data: profile } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .single();

  if (!profile || profile.role !== "admin") {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }
  return { userId: user.id };
}

/**
 * POST /api/invitations
 * Body: { email: string }
 * Admin only — generates invite code, saves to DB, sends email via Resend.
 */
export async function POST(request: Request) {
  const authResult = await verifyAdmin();
  if (authResult instanceof Response) return authResult;

  const body = await request.json();
  const { email } = body as { email: string };

  if (!email || !email.includes("@")) {
    return Response.json({ error: "Valid email is required" }, { status: 400 });
  }

  const adminClient = makeAdminClient();

  // Check if there's already an active (unused, not expired) invite for this email
  const now = new Date().toISOString();
  const { data: existing } = await adminClient
    .from("invitations")
    .select("id, expires_at, used_at")
    .eq("email", email.toLowerCase())
    .is("used_at", null)
    .gt("expires_at", now)
    .limit(1)
    .single();

  if (existing) {
    return Response.json(
      { error: "An active invite already exists for this email. It expires in 72 hours." },
      { status: 409 }
    );
  }

  // Check if this email already has a Supabase account
  const { data: authUsers } = await adminClient.auth.admin.listUsers();
  const alreadyRegistered = authUsers?.users?.some(
    (u) => u.email?.toLowerCase() === email.toLowerCase()
  );
  if (alreadyRegistered) {
    return Response.json(
      { error: "A user with this email already exists." },
      { status: 409 }
    );
  }

  // Generate secure random code (24 hex chars)
  const code = randomBytes(12).toString("hex");
  const expiresAt = new Date(Date.now() + 72 * 60 * 60 * 1000).toISOString();

  const { error: insertError } = await adminClient.from("invitations").insert({
    email: email.toLowerCase(),
    code,
    invited_by: (authResult as { userId: string }).userId,
    expires_at: expiresAt,
  });

  if (insertError) {
    return Response.json({ error: insertError.message }, { status: 500 });
  }

  // Send invite email via Resend
  const inviteUrl = `${SITE_URL}/invite?code=${code}`;
  const html = buildInviteEmail({ email, inviteUrl });

  const resendRes = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${RESEND_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: "MinuteFlow <noreply@minuteflow.click>",
      to: [email.toLowerCase()],
      subject: "You're invited to MinuteFlow",
      html,
    }),
  });

  if (!resendRes.ok) {
    const resendErr = await resendRes.text();
    console.error("Resend error:", resendErr);
    // Don't fail the whole request — invite is saved, email just failed
    return Response.json({
      success: true,
      warning: "Invite created but email failed to send. Copy the link manually.",
      inviteUrl,
    });
  }

  return Response.json({ success: true, message: `Invite sent to ${email}` });
}

/**
 * GET /api/invitations?code=XXX
 * Public — validates an invite code. Returns { valid, email } or { valid: false, reason }.
 */
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const code = searchParams.get("code");

  if (!code) {
    return Response.json({ valid: false, reason: "No code provided" });
  }

  const adminClient = makeAdminClient();
  const now = new Date().toISOString();

  const { data: invite, error } = await adminClient
    .from("invitations")
    .select("id, email, expires_at, used_at")
    .eq("code", code)
    .single();

  if (error || !invite) {
    return Response.json({ valid: false, reason: "Invalid invite code" });
  }

  if (invite.used_at) {
    return Response.json({ valid: false, reason: "This invite has already been used" });
  }

  if (invite.expires_at < now) {
    return Response.json({ valid: false, reason: "This invite has expired" });
  }

  return Response.json({ valid: true, email: invite.email });
}

/* ── Email HTML Builder ───────────────────────────────────── */

function buildInviteEmail({ email, inviteUrl }: { email: string; inviteUrl: string }): string {
  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
</head>
<body style="margin: 0; padding: 0; background-color: #faf6f0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;">
  <div style="max-width: 520px; margin: 0 auto; padding: 40px 16px;">
    <div style="background: #fff; border-radius: 12px; border: 1px solid #e8e0d4; overflow: hidden;">

      <!-- Header -->
      <div style="padding: 32px 36px 24px; border-bottom: 1px solid #e8e0d4;">
        <div style="font-size: 11px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.8px; color: #9e9080; margin-bottom: 6px;">MinuteFlow</div>
        <div style="font-size: 24px; font-weight: 700; color: #c0704e;">You're invited!</div>
        <div style="font-size: 13px; color: #6b5e52; margin-top: 4px;">Join the team on MinuteFlow</div>
      </div>

      <!-- Body -->
      <div style="padding: 28px 36px;">
        <p style="font-size: 14px; color: #3d2b1f; line-height: 1.6; margin: 0 0 20px;">
          Hi there! You've been invited to create your MinuteFlow account.
          Click the button below to set up your account — this link is valid for <strong>72 hours</strong>.
        </p>

        <div style="text-align: center; margin: 28px 0;">
          <a href="${inviteUrl}"
             style="display: inline-block; background: #c0704e; color: #fff; text-decoration: none; font-size: 14px; font-weight: 600; padding: 14px 32px; border-radius: 8px;">
            Create My Account
          </a>
        </div>

        <p style="font-size: 12px; color: #9e9080; line-height: 1.5; margin: 20px 0 0;">
          This invite was sent to <strong>${email}</strong>. If you weren't expecting this, you can safely ignore it.
          The link will only work with this email address.
        </p>
      </div>

      <!-- Footer -->
      <div style="padding: 16px 36px; background: #faf6f0; border-top: 1px solid #e8e0d4; text-align: center;">
        <div style="font-size: 11px; color: #9e9080;">MinuteFlow · Time tracking for virtual assistants</div>
      </div>

    </div>
  </div>
</body>
</html>`;
}
