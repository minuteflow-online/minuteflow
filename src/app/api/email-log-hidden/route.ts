import { createClient } from "@/lib/supabase/server";
import { createClient as createAdminClient } from "@supabase/supabase-js";
import { hasBroadAdminAccess } from "@/lib/financialAccess";

export const dynamic = "force-dynamic";

function serviceClient() {
  return createAdminClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  );
}

/**
 * email_log_hidden has no anon/authenticated grants — like every other table
 * flagged by the Security Advisor, it's meant to be reached only through a
 * service-role server route. EmailStatusTab used to read/write it straight
 * from the browser client, which only worked because RLS/grants hadn't been
 * locked down yet. This route is that lockdown's server-side counterpart.
 */
async function requireAdmin() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return { error: Response.json({ error: "Unauthorized" }, { status: 401 }) };
  }
  const { data: profile } = await supabase.from("profiles").select("role").eq("id", user.id).single();
  if (!hasBroadAdminAccess(profile)) {
    return { error: Response.json({ error: "Forbidden" }, { status: 403 }) };
  }
  return { user };
}

/**
 * GET /api/email-log-hidden
 * Returns every hidden {type, source_id} pair. Global, not per-user — hiding
 * an email log entry hides it for every admin, same as before this route existed.
 */
export async function GET() {
  const auth = await requireAdmin();
  if ("error" in auth) return auth.error;

  const { data, error } = await serviceClient().from("email_log_hidden").select("type, source_id");
  if (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
  return Response.json({ hidden: data ?? [] });
}

/**
 * POST /api/email-log-hidden
 * Body: { items: { type: string, source_id: string }[] }
 * Upserts one or many hide entries — covers both single-row and bulk delete.
 */
export async function POST(request: Request) {
  const auth = await requireAdmin();
  if ("error" in auth) return auth.error;

  const body = await request.json().catch(() => null);
  const items = body?.items;
  if (!Array.isArray(items) || items.length === 0) {
    return Response.json({ error: "items (non-empty array) is required" }, { status: 400 });
  }
  for (const item of items) {
    if (typeof item?.type !== "string" || typeof item?.source_id !== "string") {
      return Response.json({ error: "Each item needs type and source_id" }, { status: 400 });
    }
  }

  const { error } = await serviceClient().from("email_log_hidden").upsert(items);
  if (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
  return Response.json({ success: true });
}
