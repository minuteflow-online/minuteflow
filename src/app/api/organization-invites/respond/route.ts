import { createClient } from "@/lib/supabase/server";
import { serviceClient } from "@/lib/projectAccess";
import { notifyOne } from "@/lib/notifyOne";

export const dynamic = "force-dynamic";

/**
 * The VA's side of a client team invite (see POST /api/organization-invites).
 * An existing account invited by a client sits at status "invited", and the
 * client has no access to them until they accept here.
 *
 * GET  — the caller's own pending invites.
 * POST — { membershipId, action: "accept" | "decline" } on one of them.
 *        Decline deletes the row, so the client can invite again later.
 */

async function currentUserId(): Promise<string | null> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return user?.id ?? null;
}

export async function GET() {
  const userId = await currentUserId();
  if (!userId) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const admin = serviceClient();
  const { data, error } = await admin
    .from("organization_members")
    .select("id, organization_id, created_at, organizations(name), inviter:profiles!organization_members_invited_by_fkey(full_name)")
    .eq("va_id", userId)
    .eq("status", "invited");
  if (error) return Response.json({ error: error.message }, { status: 500 });

  const invites = (data ?? []).map((row) => {
    const org = row.organizations as { name?: string | null } | { name?: string | null }[] | null;
    const inviter = row.inviter as { full_name?: string | null } | { full_name?: string | null }[] | null;
    const one = <T,>(v: T | T[] | null) => (Array.isArray(v) ? v[0] ?? null : v);
    return {
      id: row.id as string,
      organizationName: one(org)?.name ?? "A client",
      invitedByName: one(inviter)?.full_name ?? null,
      invitedAt: row.created_at as string,
    };
  });

  return Response.json({ invites });
}

export async function POST(request: Request) {
  const userId = await currentUserId();
  if (!userId) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const body = (await request.json().catch(() => null)) as { membershipId?: unknown; action?: unknown } | null;
  const membershipId = typeof body?.membershipId === "string" ? body.membershipId : "";
  const action = body?.action;
  if (!/^[0-9a-f-]{36}$/i.test(membershipId) || (action !== "accept" && action !== "decline")) {
    return Response.json({ error: "membershipId and action (accept | decline) are required" }, { status: 400 });
  }

  const admin = serviceClient();
  const { data: row } = await admin
    .from("organization_members")
    .select("id, va_id, status, invited_by, organizations(name)")
    .eq("id", membershipId)
    .maybeSingle();

  // Only the invited person can answer, and only while it's still pending.
  if (!row || row.va_id !== userId || row.status !== "invited") {
    return Response.json({ error: "Invite not found" }, { status: 404 });
  }

  if (action === "accept") {
    const { error } = await admin
      .from("organization_members")
      .update({ status: "active", joined_at: new Date().toISOString() })
      .eq("id", membershipId)
      .eq("status", "invited");
    if (error) return Response.json({ error: error.message }, { status: 500 });
  } else {
    const { error } = await admin.from("organization_members").delete().eq("id", membershipId);
    if (error) return Response.json({ error: error.message }, { status: 500 });
  }

  if (row.invited_by) {
    const { data: me } = await admin.from("profiles").select("full_name, username").eq("id", userId).maybeSingle();
    const name = me?.full_name || me?.username || "Your VA";
    const verb = action === "accept" ? "accepted" : "declined";
    await notifyOne(admin, {
      targetUserId: row.invited_by as string,
      senderId: userId,
      content: `${name} ${verb} your team invite.`,
      telegram: `${name} ${verb} your team invite on MinuteFlow.`,
      topic: "org_invite",
      linkPath: "/client",
    });
  }

  return Response.json({ success: true });
}
