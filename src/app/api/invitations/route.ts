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
 * Body: { email: string, employment_type?: string, requires_extension?: boolean }
 * Admin only — generates invite code, saves to DB, sends email via Resend.
 */
export async function POST(request: Request) {
  const authResult = await verifyAdmin();
  if (authResult instanceof Response) return authResult;

  const body = await request.json();
  const { email, employment_type, requires_extension, message } = body as {
    email: string;
    employment_type?: string;
    requires_extension?: boolean;
    message?: string | null;
  };

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
    employment_type: employment_type || null,
    requires_extension: requires_extension === true,
    message: message || null,
  });

  if (insertError) {
    return Response.json({ error: insertError.message }, { status: 500 });
  }

  // Send invite email via Resend
  const inviteUrl = `${SITE_URL}/invite?code=${code}`;
  const html = buildInviteEmail({ email, inviteUrl, requires_extension: requires_extension === true, message: message || null });

  const resendRes = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${RESEND_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: "Toni Colina <noreply@minuteflow.click>",
      to: [email.toLowerCase()],
      subject: "You're invited to MinuteFlow",
      html,
      open_tracking: true,
      click_tracking: true,
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

  // Store the Resend message ID so we can track opens/clicks
  try {
    const resendData = await resendRes.json() as { id?: string };
    if (resendData.id) {
      await adminClient
        .from("invitations")
        .update({ resend_message_id: resendData.id })
        .eq("code", code);
    }
  } catch {
    // Non-fatal
  }

  return Response.json({ success: true, message: `Invite sent to ${email}` });
}

/**
 * GET /api/invitations?code=XXX  — public, validates an invite code
 * GET /api/invitations            — admin only, lists all invitations + email events
 */
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const code = searchParams.get("code");

  const adminClient = makeAdminClient();

  // ── Code validation (public) ───────────────────────────────
  if (code) {
    const now = new Date().toISOString();

    const { data: invite, error } = await adminClient
      .from("invitations")
      .select("id, email, expires_at, used_at, employment_type, requires_extension")
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

    return Response.json({
      valid: true,
      email: invite.email,
      employment_type: invite.employment_type,
      requires_extension: invite.requires_extension,
    });
  }

  // ── Admin list (authenticated admin only) ─────────────────
  const authResult = await verifyAdmin();
  if (authResult instanceof Response) return authResult;

  const { data: invitations } = await adminClient
    .from("invitations")
    .select("id, email, created_at, expires_at, used_at, employment_type, requires_extension, resend_message_id, code")
    .order("created_at", { ascending: false });

  const allInvites = invitations ?? [];

  // Fetch email events for invites that have a resend_message_id
  const messageIds = allInvites
    .filter((i) => i.resend_message_id)
    .map((i) => i.resend_message_id as string);

  let events: { resend_message_id: string; event_type: string; created_at: string }[] = [];
  if (messageIds.length > 0) {
    const { data: evts } = await adminClient
      .from("email_events")
      .select("resend_message_id, event_type, created_at")
      .in("resend_message_id", messageIds)
      .order("created_at", { ascending: true });
    events = (evts ?? []) as typeof events;
  }

  return Response.json({ invitations: allInvites, events });
}

/* ── Email HTML Builder ───────────────────────────────────── */

function buildInviteEmail({
  email,
  inviteUrl,
  requires_extension,
  message,
}: {
  email: string;
  inviteUrl: string;
  requires_extension: boolean;
  message?: string | null;
}): string {
  const extensionSection = requires_extension
    ? `
      <!-- Extension Instructions -->
      <div style="margin: 24px 0; padding: 20px; background: #faf6f0; border-radius: 8px; border: 1px solid #e8e0d4;">
        <div style="font-size: 13px; font-weight: 700; color: #c0704e; margin-bottom: 12px;">
          📸 You'll also need to install the MinuteFlow Screen Capture extension
        </div>
        <p style="font-size: 13px; color: #3d2b1f; margin: 0 0 12px; line-height: 1.6;">
          After you create your account, install the Chrome extension so screenshots can be captured automatically when you work.
        </p>
        <ol style="font-size: 13px; color: #3d2b1f; line-height: 2; margin: 0; padding-left: 20px;">
          <li>Go to <a href="${inviteUrl.split('/invite')[0]}/install" style="color: #c0704e;">${inviteUrl.split('/invite')[0]}/install</a> after signing in</li>
          <li>Click <strong>Download Extension (.zip)</strong></li>
          <li>Extract the downloaded zip file (right-click → Extract All on Windows; double-click on Mac)</li>
          <li>In Chrome, go to <code style="background:#fff;padding:2px 5px;border-radius:3px;font-size:11px;">chrome://extensions</code> and enable <strong>Developer mode</strong></li>
          <li>Click <strong>Load unpacked</strong> and select the extracted <code style="background:#fff;padding:2px 5px;border-radius:3px;font-size:11px;">chrome-extension</code> folder</li>
          <li>Click the puzzle piece icon in Chrome → click <strong>MinuteFlow</strong> → sign in</li>
        </ol>
        <div style="margin-top: 12px; padding: 10px 12px; background: #e8f4e8; border-radius: 6px; font-size: 12px; color: #3d5c3d;">
          <strong>What it does:</strong> Silently captures your active tab when you start or switch tasks. No bookmarks, tabs, or personal info is ever captured.
        </div>
      </div>`
    : "";

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

        ${message ? `
        <div style="margin: 0 0 24px; padding: 16px 20px; background: #faf6f0; border-left: 3px solid #c0704e; border-radius: 6px;">
          <div style="font-size: 11px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.8px; color: #9e9080; margin-bottom: 8px;">A note from Toni</div>
          <p style="font-size: 14px; color: #3d2b1f; line-height: 1.6; margin: 0; white-space: pre-line;">${message}</p>
        </div>` : ""}

        <div style="text-align: center; margin: 28px 0;">
          <a href="${inviteUrl}"
             style="display: inline-block; background: #c0704e; color: #fff; text-decoration: none; font-size: 14px; font-weight: 600; padding: 14px 32px; border-radius: 8px;">
            Create My Account
          </a>
        </div>

        ${extensionSection}

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
