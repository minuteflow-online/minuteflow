import { createClient } from "@/lib/supabase/server";
import { createClient as createAdminClient } from "@supabase/supabase-js";

export const dynamic = "force-dynamic";

function serviceClient() {
  return createAdminClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  );
}

async function requireUser() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return { error: Response.json({ error: "Unauthorized" }, { status: 401 }) };
  }
  return { user };
}

/**
 * GET /api/table-prefs?tableId=<id>
 * Returns this user's saved column widths/visibility for a given table, so
 * their view is restored the next time they log in (any device/browser).
 */
export async function GET(request: Request) {
  const auth = await requireUser();
  if ("error" in auth) return auth.error;

  const { searchParams } = new URL(request.url);
  const tableId = searchParams.get("tableId");
  if (!tableId) {
    return Response.json({ error: "tableId is required" }, { status: 400 });
  }

  const { data, error } = await serviceClient()
    .from("user_table_prefs")
    .select("prefs")
    .eq("user_id", auth.user.id)
    .eq("table_id", tableId)
    .maybeSingle();

  if (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }

  return Response.json({ prefs: data?.prefs ?? null });
}

/**
 * PUT /api/table-prefs
 * Body: { tableId: string, prefs: { widths: Record<string, number>, hidden: string[] } }
 * Upserts this user's saved view for the given table.
 */
export async function PUT(request: Request) {
  const auth = await requireUser();
  if ("error" in auth) return auth.error;

  const body = await request.json();
  const tableId = typeof body.tableId === "string" ? body.tableId : null;
  if (!tableId || typeof body.prefs !== "object" || body.prefs === null) {
    return Response.json({ error: "tableId and prefs are required" }, { status: 400 });
  }

  const { error } = await serviceClient()
    .from("user_table_prefs")
    .upsert(
      {
        user_id: auth.user.id,
        table_id: tableId,
        prefs: body.prefs,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "user_id,table_id" }
    );

  if (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }

  return Response.json({ success: true });
}
