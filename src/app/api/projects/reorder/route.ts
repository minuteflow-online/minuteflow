import { createClient } from "@/lib/supabase/server";
import { hasBroadAdminAccess } from "@/lib/financialAccess";
import { createClient as createAdminClient } from "@supabase/supabase-js";

export const dynamic = "force-dynamic";

function serviceClient() {
  return createAdminClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  );
}

/**
 * POST /api/projects/reorder
 * Body: { ids: string[] } — the project ids in their new top-to-bottom order.
 * Sets sort_order = index for each. Admins may reorder any project; a VA may
 * only reorder projects they created or have been granted access to (others in
 * the list keep their current order).
 */
export async function POST(request: Request) {
  const authClient = await createClient();
  const { data: { user } } = await authClient.auth.getUser();
  if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const { data: profile } = await authClient
    .from("profiles").select("role, department").eq("id", user.id).single();
  const isAdmin = hasBroadAdminAccess(profile);

  const body = (await request.json()) as { ids?: unknown };
  const ids = Array.isArray(body.ids) ? body.ids.filter((v): v is string => typeof v === "string") : null;
  if (!ids || ids.length === 0) {
    return Response.json({ error: "ids array is required" }, { status: 400 });
  }

  const supabase = serviceClient();

  let allowed = new Set(ids);
  if (!isAdmin) {
    const { data: accessRows } = await supabase
      .from("project_va_access").select("project_id").eq("va_id", user.id);
    const { data: ownRows } = await supabase
      .from("projects").select("id").eq("created_by", user.id).in("id", ids);
    allowed = new Set([
      ...(accessRows ?? []).map((r) => r.project_id as string),
      ...(ownRows ?? []).map((r) => r.id as string),
    ]);
  }

  const results = await Promise.all(
    ids.map((id, index) =>
      allowed.has(id)
        ? supabase.from("projects").update({ sort_order: index }).eq("id", id)
        : Promise.resolve({ error: null })
    )
  );
  const failed = results.find((r) => r.error);
  if (failed?.error) return Response.json({ error: failed.error.message }, { status: 400 });

  return Response.json({ ok: true });
}
