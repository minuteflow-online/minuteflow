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

/**
 * GET /api/projects/files-overview?projectIds=a,b,c
 * Recent files across the given objectives/operations, newest first, for the
 * landing dashboard's Docs card. Returns { files: [{ id, project_id, filename,
 * uploaded_at }] } — download happens inside each objective's Docs cabinet.
 */
export async function GET(request: Request) {
  const authClient = await createClient();
  const { data: { user } } = await authClient.auth.getUser();
  if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const ids = (new URL(request.url).searchParams.get("projectIds") ?? "")
    .split(",").map((s) => s.trim()).filter(Boolean);
  if (ids.length === 0) return Response.json({ files: [] });

  const supabase = serviceClient();
  const { data, error } = await supabase
    .from("project_files")
    .select("id, project_id, filename, uploaded_at")
    .in("project_id", ids)
    .order("uploaded_at", { ascending: false })
    .limit(50);
  if (error) return Response.json({ error: error.message }, { status: 500 });

  return Response.json({ files: data ?? [] });
}
