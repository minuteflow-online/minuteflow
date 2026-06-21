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
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: Response.json({ error: "Unauthorized" }, { status: 401 }) };
  return { user };
}

export async function GET(request: Request) {
  const auth = await requireUser();
  if ("error" in auth) return auth.error;

  const { user } = auth;
  const { searchParams } = new URL(request.url);
  const projectId = searchParams.get("projectId");
  if (!projectId) return Response.json({ error: "projectId is required" }, { status: 400 });

  const supabase = serviceClient();
  const { data, error } = await supabase
    .from("project_va_notes")
    .select("project_id, user_id, note, updated_at")
    .eq("project_id", projectId)
    .eq("user_id", user.id)
    .maybeSingle();

  if (error) return Response.json({ error: error.message }, { status: 500 });
  return Response.json({ note: data?.note ?? null, updated_at: data?.updated_at ?? null });
}

export async function POST(request: Request) {
  const auth = await requireUser();
  if ("error" in auth) return auth.error;

  const { user } = auth;
  const body = (await request.json()) as { projectId?: string; note?: string | null };
  const projectId = body.projectId?.trim();
  if (!projectId) return Response.json({ error: "projectId is required" }, { status: 400 });

  const supabase = serviceClient();
  const { error } = await supabase
    .from("project_va_notes")
    .upsert(
      {
        project_id: projectId,
        user_id: user.id,
        note: body.note?.trim() || null,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "project_id,user_id" }
    );

  if (error) return Response.json({ error: error.message }, { status: 500 });
  return Response.json({ success: true });
}
