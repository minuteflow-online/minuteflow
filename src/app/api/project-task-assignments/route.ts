import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

/** GET: List task assignments for a project (with task details) */
export async function GET(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const projectTagId = searchParams.get("project_tag_id");

  if (!projectTagId) {
    return Response.json(
      { error: "project_tag_id is required" },
      { status: 400 }
    );
  }

  const { data, error } = await supabase
    .from("project_task_assignments")
    .select("id, task_library_id, project_tag_id, sort_order, billing_type, task_rate, task_library(id, task_name, is_active, billing_type, default_rate)")
    .eq("project_tag_id", parseInt(projectTagId))
    .order("sort_order");

  if (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }

  return Response.json({ assignments: data ?? [] });
}

/** POST: Assign tasks to a project (bulk) */
export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { data: profile } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .single();
  if (profile?.role !== "admin") {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }

  const body = await request.json();
  const { project_tag_id, task_library_ids } = body;

  if (!project_tag_id || !Array.isArray(task_library_ids) || task_library_ids.length === 0) {
    return Response.json(
      { error: "project_tag_id and task_library_ids[] are required" },
      { status: 400 }
    );
  }

  // Get next sort_order for this project
  const { data: existing } = await supabase
    .from("project_task_assignments")
    .select("sort_order")
    .eq("project_tag_id", project_tag_id)
    .order("sort_order", { ascending: false })
    .limit(1);

  let nextOrder = (existing?.[0]?.sort_order ?? -1) + 1;

  const rows = task_library_ids.map((taskId: number) => ({
    task_library_id: taskId,
    project_tag_id,
    sort_order: nextOrder++,
    assigned_by: user.id,
  }));

  const { data, error } = await supabase
    .from("project_task_assignments")
    .insert(rows)
    .select("id, task_library_id, project_tag_id, sort_order, billing_type, task_rate, task_library(id, task_name, is_active, billing_type, default_rate)");

  if (error) {
    if (error.code === "23505") {
      return Response.json(
        { error: "Some tasks are already assigned to this project" },
        { status: 409 }
      );
    }
    return Response.json({ error: error.message }, { status: 400 });
  }

  return Response.json({ assignments: data }, { status: 201 });
}

/** PATCH: Reorder assignments within a project */
export async function PATCH(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { data: profile } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .single();
  if (profile?.role !== "admin") {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }

  const body = await request.json();

  if (Array.isArray(body.reorder)) {
    for (const item of body.reorder) {
      await supabase
        .from("project_task_assignments")
        .update({ sort_order: item.sort_order })
        .eq("id", item.id);
    }
    return Response.json({ success: true });
  }

  // Update billing_type, task_rate, instructions, and/or show_in_assignment on a single assignment
  const { id, billing_type, task_rate, instructions, show_in_assignment } = body;
  if (id && (billing_type !== undefined || task_rate !== undefined || instructions !== undefined || show_in_assignment !== undefined)) {
    const updates: Record<string, unknown> = {};
    if (billing_type !== undefined) updates.billing_type = billing_type;
    if (task_rate !== undefined) updates.task_rate = task_rate;
    if (instructions !== undefined) updates.instructions = instructions;
    if (show_in_assignment !== undefined) updates.show_in_assignment = show_in_assignment;

    const { error } = await supabase
      .from("project_task_assignments")
      .update(updates)
      .eq("id", id);

    if (error) {
      return Response.json({ error: error.message }, { status: 400 });
    }
    return Response.json({ success: true });
  }

  return Response.json({ error: "reorder[] or id with billing_type/task_rate/instructions/show_in_assignment is required" }, { status: 400 });
}

/** DELETE: Remove task assignment(s) from a project */
export async function DELETE(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { data: profile } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .single();
  if (profile?.role !== "admin") {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }

  const { searchParams } = new URL(request.url);
  const id = searchParams.get("id");
  const ids = searchParams.get("ids");

  if (!id && !ids) {
    return Response.json({ error: "id or ids is required" }, { status: 400 });
  }

  if (ids) {
    const idList = ids
      .split(",")
      .map((i) => parseInt(i.trim()))
      .filter((i) => !isNaN(i));
    if (idList.length === 0) {
      return Response.json({ error: "No valid ids provided" }, { status: 400 });
    }
    const { error } = await supabase
      .from("project_task_assignments")
      .delete()
      .in("id", idList);
    if (error) {
      return Response.json({ error: error.message }, { status: 400 });
    }
    return Response.json({ success: true, deleted: idList.length });
  }

  const { error } = await supabase
    .from("project_task_assignments")
    .delete()
    .eq("id", id);
  if (error) {
    return Response.json({ error: error.message }, { status: 400 });
  }

  return Response.json({ success: true });
}
