import { createClient } from "@/lib/supabase/server";
import { createClient as createAdminClient } from "@supabase/supabase-js";
import { hasBroadAdminAccess } from "@/lib/financialAccess";

export const dynamic = "force-dynamic";

/**
 * A sitewide default is stored as an ordinary user_table_prefs row under this
 * prefix, written by whichever admin set it. Reading it ignores user_id and
 * takes the newest row, so the last admin to choose wins for everyone who
 * hasn't picked their own.
 */
const SITEWIDE_PREFIX = "sitewide:";

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
  return { user, supabase };
}

/**
 * GET /api/table-prefs?tableId=<id>[&scope=sitewide]
 * Returns this user's saved column widths/visibility for a given table, so
 * their view is restored the next time they log in (any device/browser).
 * With scope=sitewide, returns the admin-set default for everyone instead.
 */
export async function GET(request: Request) {
  const auth = await requireUser();
  if ("error" in auth) return auth.error;

  const { searchParams } = new URL(request.url);
  const tableId = searchParams.get("tableId");
  if (!tableId) {
    return Response.json({ error: "tableId is required" }, { status: 400 });
  }

  if (searchParams.get("scope") === "sitewide") {
    const { data, error } = await serviceClient()
      .from("user_table_prefs")
      .select("prefs")
      .eq("table_id", SITEWIDE_PREFIX + tableId)
      .order("updated_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error) {
      return Response.json({ error: error.message }, { status: 500 });
    }
    return Response.json({ prefs: data?.prefs ?? null });
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
 * Body: { tableId: string, prefs: { widths: Record<string, number>, hidden: string[] }, scope?: "sitewide" }
 * Upserts this user's saved view for the given table. scope "sitewide" sets
 * the default for everyone and is limited to admins.
 */
export async function PUT(request: Request) {
  const auth = await requireUser();
  if ("error" in auth) return auth.error;

  const body = await request.json();
  const tableId = typeof body.tableId === "string" ? body.tableId : null;
  if (!tableId || typeof body.prefs !== "object" || body.prefs === null) {
    return Response.json({ error: "tableId and prefs are required" }, { status: 400 });
  }
  // The prefix is reserved for the admin-only path below.
  if (tableId.startsWith(SITEWIDE_PREFIX)) {
    return Response.json({ error: "Invalid tableId" }, { status: 400 });
  }

  const sitewide = body.scope === "sitewide";
  if (sitewide) {
    const { data: profile } = await auth.supabase
      .from("profiles")
      .select("role")
      .eq("id", auth.user.id)
      .single();
    // Same tier that sees the Objectives/Operations admin controls.
    if (!hasBroadAdminAccess(profile)) {
      return Response.json({ error: "Only admins can set a sitewide default" }, { status: 403 });
    }
  }

  const { error } = await serviceClient()
    .from("user_table_prefs")
    .upsert(
      {
        user_id: auth.user.id,
        table_id: sitewide ? SITEWIDE_PREFIX + tableId : tableId,
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
