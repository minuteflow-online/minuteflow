import { createClient as createAdminClient } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;

export function serviceClient() {
  return createAdminClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

/**
 * Every client-admin route's entry gate: confirms the caller is a client
 * with an org, and returns the active VA ids in that org. Every query or
 * action downstream scopes to exactly this list — a client never reaches a
 * VA who isn't theirs, no matter what id a request names.
 */
export async function requireClientOrgVaIds(): Promise<
  { userId: string; organizationId: string; vaIds: string[] } | Response
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

  const admin = serviceClient();
  const { data: members } = await admin
    .from("organization_members")
    .select("va_id")
    .eq("organization_id", profile.organization_id)
    .eq("status", "active");

  const vaIds = (members ?? []).map((m) => m.va_id as string);
  return { userId: user.id, organizationId: profile.organization_id, vaIds };
}

export function isResponse(x: unknown): x is Response {
  return x instanceof Response;
}
