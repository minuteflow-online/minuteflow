import { createClient as createAdminClient } from "@supabase/supabase-js";
import { sendResendEmailAlways } from "@/lib/sendEmail";
import { createClient } from "@/lib/supabase/server";
import { escapeHtml } from "@/lib/richText";
import { notifyOne } from "@/lib/notifyOne";
import { randomBytes } from "crypto";
import type { SupabaseClient } from "@supabase/supabase-js";

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

/** Verify the caller is an authenticated client; returns their org. */
async function verifyClient(): Promise<
  { userId: string; organizationId: string; orgName: string } | Response
> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const { data: profile } = await supabase
    .from("profiles")
    .select("role, organization_id")
    .eq("id", user.id)
    .single();

  if (profile?.role !== "client" || !profile.organization_id) {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }

  const { data: org } = await supabase
    .from("organizations")
    .select("name")
    .eq("id", profile.organization_id)
    .single();

  return { userId: user.id, organizationId: profile.organization_id, orgName: org?.name ?? "" };
}

/**
 * Finds an auth user by email. listUsers() pages (50 by default), so a bare
 * call only ever searched the first page and silently missed everyone else.
 */
async function findAuthUserByEmail(admin: SupabaseClient, email: string) {
  const perPage = 1000;
  for (let page = 1; page <= 50; page++) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage });
    if (error) throw error;
    const users = data?.users ?? [];
    const hit = users.find((u) => u.email?.toLowerCase() === email);
    if (hit) return hit;
    if (users.length < perPage) return null;
  }
  return null;
}

/**
 * POST /api/organization-invites
 * Body: { email: string }
 * Client only. An existing account is never added outright: only a plain VA
 * account can be invited, and it joins as "invited" — the client gets no
 * access to them until the VA accepts on their own dashboard
 * (/api/organization-invites/respond). An email with no account gets a
 * signup invite instead, through the same flow staff invites use.
 */
export async function POST(request: Request) {
  const authResult = await verifyClient();
  if (authResult instanceof Response) return authResult;
  const { userId, organizationId, orgName } = authResult;

  const body = await request.json();
  const { email } = body as { email: string };

  if (!email || !email.includes("@")) {
    return Response.json({ error: "Valid email is required" }, { status: 400 });
  }
  const normalizedEmail = email.toLowerCase();

  const adminClient = makeAdminClient();

  // Does this email already belong to an existing account?
  let existingUser: Awaited<ReturnType<typeof findAuthUserByEmail>>;
  try {
    existingUser = await findAuthUserByEmail(adminClient, normalizedEmail);
  } catch {
    return Response.json({ error: "Could not check that email right now. Try again." }, { status: 503 });
  }

  if (existingUser) {
    // Only a plain VA account can be invited — never staff (admin, manager,
    // founder, …) or another client. Same wording either way, so the reply
    // doesn't reveal what kind of account an email belongs to.
    const { data: inviteeProfile } = await adminClient
      .from("profiles")
      .select("role")
      .eq("id", existingUser.id)
      .maybeSingle();
    if (inviteeProfile?.role !== "va") {
      return Response.json(
        { error: "This account can't be invited to a client team. Ask them for a different email." },
        { status: 409 }
      );
    }

    const { data: existingMember } = await adminClient
      .from("organization_members")
      .select("id, status")
      .eq("organization_id", organizationId)
      .eq("va_id", existingUser.id)
      .maybeSingle();

    if (existingMember) {
      return Response.json(
        {
          error:
            existingMember.status === "active"
              ? "This person is already on your team."
              : "You've already invited this person — they haven't accepted yet.",
        },
        { status: 409 }
      );
    }

    const { error: memberError } = await adminClient.from("organization_members").insert({
      organization_id: organizationId,
      va_id: existingUser.id,
      status: "invited",
      invited_by: userId,
    });

    if (memberError) {
      return Response.json({ error: memberError.message }, { status: 500 });
    }

    await notifyOne(adminClient, {
      targetUserId: existingUser.id,
      senderId: userId,
      content: `${orgName || "A client"} invited you to join their team. Accept or decline it on your dashboard.`,
      telegram: `${orgName || "A client"} invited you to join their team on MinuteFlow. Open your dashboard to accept or decline.`,
      topic: "org_invite",
      linkPath: "/dashboard",
    });

    const html = buildInvitedToTeamEmail({ orgName });
    await sendResendEmailAlways(
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${RESEND_API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          from: "MinuteFlow <noreply@minuteflow.click>",
          to: [normalizedEmail],
          subject: `${orgName} invited you to their team on MinuteFlow`,
          html,
        }),
      },
      { type: "org_invite", label: normalizedEmail, sublabel: "Invited existing user" }
    ).catch(() => {});

    return Response.json({
      success: true,
      message: `Invite sent to ${email}. They'll join your team once they accept.`,
    });
  }

  // No existing account — invite through the normal signup wizard, tagged to this org.
  const now = new Date().toISOString();
  const { data: existingInvite } = await adminClient
    .from("invitations")
    .select("id")
    .eq("email", normalizedEmail)
    .is("used_at", null)
    .gt("expires_at", now)
    .limit(1)
    .maybeSingle();

  if (existingInvite) {
    return Response.json(
      { error: "An active invite already exists for this email." },
      { status: 409 }
    );
  }

  const code = randomBytes(12).toString("hex");
  const expiresAt = new Date(Date.now() + 72 * 60 * 60 * 1000).toISOString();

  const { error: insertError } = await adminClient.from("invitations").insert({
    email: normalizedEmail,
    code,
    invited_by: userId,
    expires_at: expiresAt,
    organization_id: organizationId,
  });

  if (insertError) {
    return Response.json({ error: insertError.message }, { status: 500 });
  }

  const inviteUrl = `${SITE_URL}/invite?code=${code}`;
  const html = buildOrgInviteEmail({ orgName, inviteUrl });

  const resendRes = await sendResendEmailAlways(
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${RESEND_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: "MinuteFlow <noreply@minuteflow.click>",
        to: [normalizedEmail],
        subject: `You're invited to join ${orgName} on MinuteFlow`,
        html,
      }),
    },
    { type: "org_invite", label: normalizedEmail, sublabel: orgName }
  );

  if (!resendRes.ok) {
    return Response.json({
      success: true,
      warning: "Invite created but email failed to send. Copy the link manually.",
      inviteUrl,
    });
  }

  return Response.json({ success: true, message: `Invite sent to ${email}` });
}

/**
 * GET /api/organization-invites
 * Client only — lists this org's roster: active/invited members plus any
 * pending (not-yet-accepted) invitations.
 */
export async function GET() {
  const authResult = await verifyClient();
  if (authResult instanceof Response) return authResult;
  const { organizationId } = authResult;

  // Service role, scoped to this org: a client can't read other profiles
  // directly, so the member names come through here (name only).
  const adminClient = makeAdminClient();

  const { data: members } = await adminClient
    .from("organization_members")
    .select("id, status, va_id, profiles!organization_members_va_id_fkey(full_name)")
    .eq("organization_id", organizationId);

  // invitations has no client-readable RLS policy at all — every access goes
  // through the service role, same as the staff invite routes.
  const { data: pendingInvites } = await adminClient
    .from("invitations")
    .select("id, email, created_at, expires_at")
    .eq("organization_id", organizationId)
    .is("used_at", null)
    .gt("expires_at", new Date().toISOString());

  return Response.json({ members: members ?? [], pendingInvites: pendingInvites ?? [] });
}

function buildOrgInviteEmail({ orgName: rawOrgName, inviteUrl }: { orgName: string; inviteUrl: string }): string {
  // The org name is whatever the client typed at signup — escape it.
  const orgName = escapeHtml(rawOrgName);
  return `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"></head>
<body style="margin: 0; padding: 0; background-color: #faf6f0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;">
  <div style="max-width: 520px; margin: 0 auto; padding: 40px 16px;">
    <div style="background: #fff; border-radius: 12px; border: 1px solid #e8e0d4; overflow: hidden;">
      <div style="padding: 32px 36px 24px; border-bottom: 1px solid #e8e0d4;">
        <div style="font-size: 11px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.8px; color: #9e9080; margin-bottom: 6px;">MinuteFlow</div>
        <div style="font-size: 24px; font-weight: 700; color: #c0704e;">You're invited!</div>
        <div style="font-size: 13px; color: #6b5e52; margin-top: 4px;">Join ${orgName}'s team on MinuteFlow</div>
      </div>
      <div style="padding: 28px 36px;">
        <p style="font-size: 14px; color: #3d2b1f; line-height: 1.6; margin: 0 0 20px;">
          You've been invited to create your MinuteFlow account and start working with <strong>${orgName}</strong>.
          Click the button below to set up your account — this link is valid for <strong>72 hours</strong>.
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

function buildInvitedToTeamEmail({ orgName: rawOrgName }: { orgName: string }): string {
  const orgName = escapeHtml(rawOrgName);
  return `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"></head>
<body style="margin: 0; padding: 0; background-color: #faf6f0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;">
  <div style="max-width: 520px; margin: 0 auto; padding: 40px 16px;">
    <div style="background: #fff; border-radius: 12px; border: 1px solid #e8e0d4; overflow: hidden;">
      <div style="padding: 32px 36px 24px; border-bottom: 1px solid #e8e0d4;">
        <div style="font-size: 11px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.8px; color: #9e9080; margin-bottom: 6px;">MinuteFlow</div>
        <div style="font-size: 24px; font-weight: 700; color: #c0704e;">You're invited to a team</div>
      </div>
      <div style="padding: 28px 36px;">
        <p style="font-size: 14px; color: #3d2b1f; line-height: 1.6; margin: 0;">
          <strong>${orgName}</strong> has invited you to join their team on MinuteFlow. Sign in and
          you'll see the invite at the top of your dashboard — accept it to start working with them,
          or decline it. Nothing is shared with them unless you accept.
        </p>
      </div>
      <div style="padding: 16px 36px; background: #faf6f0; border-top: 1px solid #e8e0d4; text-align: center;">
        <div style="font-size: 11px; color: #9e9080;">MinuteFlow · Time tracking for virtual assistants</div>
      </div>
    </div>
  </div>
</body>
</html>`;
}
