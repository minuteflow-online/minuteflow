import { randomBytes } from "crypto";
import { requireClientOrgVaIds, serviceClient, isResponse } from "@/lib/clientAdminAccess";
import { sendResendEmailAlways } from "@/lib/sendEmail";
import { escapeHtml } from "@/lib/richText";

export const dynamic = "force-dynamic";

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL || "https://minuteflow.click";
const RESEND_API_KEY = process.env.RESEND_API_KEY!;

/**
 * Co-admins: other people from the client's business who run the org with
 * them. A co-admin is a client login of this same org (no org of their own).
 *
 * POST   { email }  → invite a co-admin. Only a brand-new email: an existing
 *                     MinuteFlow account (staff, VA, another client) is never
 *                     turned into a co-admin. They sign up at
 *                     /signup-client?code=… and land in this org.
 * DELETE { adminId } → owner only: remove a co-admin from the org.
 * DELETE { inviteId } → cancel a pending co-admin invite.
 */

async function emailExists(admin: ReturnType<typeof serviceClient>, email: string): Promise<boolean> {
  const perPage = 1000;
  for (let page = 1; page <= 50; page++) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage });
    if (error) throw error;
    const users = data?.users ?? [];
    if (users.some((u) => u.email?.toLowerCase() === email)) return true;
    if (users.length < perPage) return false;
  }
  return false;
}

export async function POST(request: Request) {
  const auth = await requireClientOrgVaIds();
  if (isResponse(auth)) return auth;
  const { organizationId, userId } = auth;

  const { email } = ((await request.json().catch(() => null)) ?? {}) as { email?: unknown };
  if (typeof email !== "string" || !email.includes("@")) {
    return Response.json({ error: "Valid email is required" }, { status: 400 });
  }
  const normalizedEmail = email.trim().toLowerCase();

  const admin = serviceClient();
  try {
    if (await emailExists(admin, normalizedEmail)) {
      // Nothing is sent to an existing account, but the reply matches a real
      // invite so it never confirms the email is on MinuteFlow.
      return Response.json({ success: true, message: coAdminSentMessage(normalizedEmail) });
    }
  } catch {
    return Response.json({ error: "Could not check that email right now. Try again." }, { status: 503 });
  }

  const now = new Date().toISOString();
  const { data: openInvite } = await admin
    .from("invitations")
    .select("id")
    .eq("email", normalizedEmail)
    .is("used_at", null)
    .gt("expires_at", now)
    .limit(1)
    .maybeSingle();
  if (openInvite) {
    return Response.json({ error: "An active invite already exists for this email." }, { status: 409 });
  }

  const code = randomBytes(12).toString("hex");
  const expiresAt = new Date(Date.now() + 72 * 60 * 60 * 1000).toISOString();
  const { error: insertError } = await admin.from("invitations").insert({
    email: normalizedEmail,
    code,
    invited_by: userId,
    expires_at: expiresAt,
    organization_id: organizationId,
    org_role: "admin",
  });
  if (insertError) return Response.json({ error: insertError.message }, { status: 500 });

  const [{ data: org }, { data: inviter }] = await Promise.all([
    admin.from("organizations").select("name").eq("id", organizationId).maybeSingle(),
    admin.from("profiles").select("full_name, username").eq("id", userId).maybeSingle(),
  ]);
  const rawOrgName = (org?.name as string | null) || "a team";
  const rawInviterName = inviter?.full_name || inviter?.username || "A colleague";
  const orgName = escapeHtml(rawOrgName);
  const inviterName = escapeHtml(rawInviterName);
  const inviteUrl = `${SITE_URL}/signup-client?code=${code}`;

  const res = await sendResendEmailAlways(
    {
      method: "POST",
      headers: { Authorization: `Bearer ${RESEND_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        from: "MinuteFlow <noreply@minuteflow.click>",
        to: [normalizedEmail],
        subject: `${rawInviterName} invited you to help run ${rawOrgName} on MinuteFlow`,
        html: buildCoAdminEmail({ orgName, inviterName, inviteUrl }),
      }),
    },
    { type: "org_invite", label: normalizedEmail, sublabel: "Co-admin invite" }
  ).catch(() => null);

  if (!res || !res.ok) {
    return Response.json({
      success: true,
      warning: "Invite created but the email failed to send. Copy the link manually.",
      inviteUrl,
    });
  }
  return Response.json({ success: true, message: coAdminSentMessage(normalizedEmail) });
}

function coAdminSentMessage(email: string): string {
  return `Invite sent to ${email}. If nothing arrives, ask them for a different email.`;
}

export async function DELETE(request: Request) {
  const auth = await requireClientOrgVaIds();
  if (isResponse(auth)) return auth;
  const { organizationId, isOwner, ownerId } = auth;

  const { adminId, inviteId } = ((await request.json().catch(() => null)) ?? {}) as {
    adminId?: unknown;
    inviteId?: unknown;
  };
  const admin = serviceClient();

  if (typeof inviteId === "string") {
    const { data: removed, error } = await admin
      .from("invitations")
      .delete()
      .eq("id", inviteId)
      .eq("organization_id", organizationId)
      .eq("org_role", "admin")
      .is("used_at", null)
      .select("id");
    if (error) return Response.json({ error: error.message }, { status: 500 });
    if (!removed?.length) return Response.json({ error: "Invite not found" }, { status: 404 });
    return Response.json({ success: true });
  }

  if (typeof adminId !== "string") {
    return Response.json({ error: "adminId or inviteId is required" }, { status: 400 });
  }
  if (!isOwner) {
    return Response.json({ error: "Only the team's owner can remove a co-admin." }, { status: 403 });
  }
  if (adminId === ownerId) {
    return Response.json({ error: "The owner can't be removed." }, { status: 400 });
  }

  // Detach, never delete: the login stays (their history is kept) but it no
  // longer belongs to any org, so every client route refuses it.
  const { data: detached, error } = await admin
    .from("profiles")
    .update({ organization_id: null, is_active: false })
    .eq("id", adminId)
    .eq("role", "client")
    .eq("organization_id", organizationId)
    .select("id");
  if (error) return Response.json({ error: error.message }, { status: 500 });
  if (!detached?.length) return Response.json({ error: "Co-admin not found" }, { status: 404 });
  return Response.json({ success: true });
}

function buildCoAdminEmail({ orgName, inviterName, inviteUrl }: { orgName: string; inviterName: string; inviteUrl: string }): string {
  return `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"></head>
<body style="margin: 0; padding: 0; background-color: #faf6f0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;">
  <div style="max-width: 520px; margin: 0 auto; padding: 40px 16px;">
    <div style="background: #fff; border-radius: 12px; border: 1px solid #e8e0d4; overflow: hidden;">
      <div style="padding: 32px 36px 24px; border-bottom: 1px solid #e8e0d4;">
        <div style="font-size: 11px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.8px; color: #9e9080; margin-bottom: 6px;">MinuteFlow</div>
        <div style="font-size: 24px; font-weight: 700; color: #c0704e;">You're invited to co-admin a team</div>
        <div style="font-size: 13px; color: #6b5e52; margin-top: 4px;">${orgName}</div>
      </div>
      <div style="padding: 28px 36px;">
        <p style="font-size: 14px; color: #3d2b1f; line-height: 1.6; margin: 0 0 20px;">
          <strong>${inviterName}</strong> invited you to help run <strong>${orgName}</strong> on MinuteFlow —
          managing its VAs, tasks and submissions. This link is valid for <strong>72 hours</strong>.
        </p>
        <div style="text-align: center; margin: 28px 0;">
          <a href="${inviteUrl}" style="display: inline-block; background: #c0704e; color: #fff; text-decoration: none; font-size: 14px; font-weight: 600; padding: 14px 32px; border-radius: 8px;">
            Create My Account
          </a>
        </div>
      </div>
      <div style="padding: 16px 36px; background: #faf6f0; border-top: 1px solid #e8e0d4; text-align: center;">
        <div style="font-size: 11px; color: #9e9080;">MinuteFlow · Time tracking for virtual assistants</div>
      </div>
    </div>
  </div>
</body>
</html>`;
}
