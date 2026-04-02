import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

/** GET: Return task counts per project { project_tag_id, count }[] */
export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Use a raw RPC or just select all assignments and group client-side
  const { data, error } = await supabase
    .from("project_task_assignments")
    .select("project_tag_id");

  if (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }

  // Aggregate counts
  const counts: Record<number, number> = {};
  for (const row of data ?? []) {
    counts[row.project_tag_id] = (counts[row.project_tag_id] || 0) + 1;
  }

  return Response.json({ counts });
}
