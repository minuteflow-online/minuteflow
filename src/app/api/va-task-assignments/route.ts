import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

/** GET: List VA task assignments
 *  ?va_id=xxx                          → assignments for a specific VA
 *  ?project_task_assignment_id=xxx     → VAs assigned to a specific task-in-project
 *  (no params)                         → all assignments (admin only)
 */
export async function GET(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const vaId = searchParams.get("va_id");
  const ptaId = searchParams.get("project_task_assignment_id");
  const assignmentType = searchParams.get("assignment_type"); // 'include' | 'exclude'

  let query = supabase
    .from("va_task_assignments")
    .select(
      "id, va_id, project_task_assignment_id, billing_type, rate, assignment_type, assigned_by, assigned_at, status, instructions, profiles!va_task_assignments_va_id_fkey(id, full_name, username, position), project_task_assignments(id, task_library_id, project_tag_id, billing_type, task_rate, task_library(id, task_name), project_tags(id, account, project_name))"
    )
    .order("assigned_at", { ascending: false });

  if (assignmentType) {
    query = query.eq("assignment_type", assignmentType);
  }

  if (vaId) {
    query = query.eq("va_id", vaId);
  }
  if (ptaId) {
    query = query.eq("project_task_assignment_id", parseInt(ptaId));
  }

  const { data, error } = await query;

  if (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }

  return Response.json({ assignments: data ?? [] });
}

/** POST: Assign VA(s) to task(s)-in-project
 *  Body: { va_id, project_task_assignment_ids: [1,2,3] }  → one VA to multiple tasks
 *  Body: { project_task_assignment_id, va_ids: [...] }     → multiple VAs to one task
 *  Body: { va_id, project_task_assignment_id, billing_type?, rate? } → single assignment
 */
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
  const {
    va_id,
    project_task_assignment_ids,
    project_task_assignment_id,
    va_ids,
    billing_type,
    rate,
    assignment_type,
  } = body;
  const effectiveType = assignment_type === "exclude" ? "exclude" : "include";

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let rows: any[] = [];

  // Mode 1: One VA → multiple tasks
  if (va_id && Array.isArray(project_task_assignment_ids) && project_task_assignment_ids.length > 0) {
    rows = project_task_assignment_ids.map((ptaId: number) => ({
      va_id,
      project_task_assignment_id: ptaId,
      billing_type: billing_type ?? "hourly",
      rate: rate ?? null,
      assignment_type: effectiveType,
      assigned_by: user.id,
    }));
  }
  // Mode 2: One task → multiple VAs
  else if (project_task_assignment_id && Array.isArray(va_ids) && va_ids.length > 0) {
    rows = va_ids.map((vid: string) => ({
      va_id: vid,
      project_task_assignment_id,
      billing_type: billing_type ?? "hourly",
      rate: rate ?? null,
      assignment_type: effectiveType,
      assigned_by: user.id,
    }));
  }
  // Mode 3: Single
  else if (va_id && project_task_assignment_id) {
    rows = [
      {
        va_id,
        project_task_assignment_id,
        billing_type: billing_type ?? "hourly",
        rate: rate ?? null,
        assignment_type: effectiveType,
        assigned_by: user.id,
      },
    ];
  } else {
    return Response.json(
      {
        error:
          "Provide (va_id + project_task_assignment_ids[]), (project_task_assignment_id + va_ids[]), or (va_id + project_task_assignment_id)",
      },
      { status: 400 }
    );
  }

  const { data, error } = await supabase
    .from("va_task_assignments")
    .upsert(rows, {
      onConflict: "va_id,project_task_assignment_id",
      ignoreDuplicates: false,
    })
    .select(
      "id, va_id, project_task_assignment_id, billing_type, rate, assignment_type, assigned_at, profiles!va_task_assignments_va_id_fkey(id, full_name, username), project_task_assignments(id, task_library_id, project_tag_id, billing_type, task_rate, task_library(id, task_name), project_tags(id, account, project_name))"
    );

  if (error) {
    return Response.json({ error: error.message }, { status: 400 });
  }

  return Response.json({ assignments: data }, { status: 201 });
}

/** PATCH: Update billing_type, rate, and/or assignment_type on existing assignment
 *  Body: { id, billing_type?, rate?, assignment_type? }
 */
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
  const { id, billing_type, rate, assignment_type, status, instructions } = body;

  if (!id) {
    return Response.json({ error: "id is required" }, { status: 400 });
  }

  const updates: Record<string, unknown> = {};
  if (billing_type !== undefined) updates.billing_type = billing_type;
  if (rate !== undefined) updates.rate = rate;
  if (assignment_type !== undefined) updates.assignment_type = assignment_type;
  if (status !== undefined) updates.status = status;
  if (instructions !== undefined) updates.instructions = instructions;

  if (Object.keys(updates).length === 0) {
    return Response.json({ error: "Nothing to update" }, { status: 400 });
  }

  const { data, error } = await supabase
    .from("va_task_assignments")
    .update(updates)
    .eq("id", id)
    .select(
      "id, va_id, project_task_assignment_id, billing_type, rate, assignment_type, status, instructions, assigned_at, profiles!va_task_assignments_va_id_fkey(id, full_name, username), project_task_assignments(id, task_library_id, project_tag_id, task_library(id, task_name), project_tags(id, account, project_name))"
    )
    .single();

  if (error) {
    return Response.json({ error: error.message }, { status: 400 });
  }

  return Response.json({ assignment: data });
}

/** DELETE: Remove VA task assignment(s)
 *  ?id=xxx                                          → by ID
 *  ?va_id=xxx&project_task_assignment_id=xxx        → by combo
 */
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
  const vaId = searchParams.get("va_id");
  const ptaId = searchParams.get("project_task_assignment_id");

  if (id) {
    const { error } = await supabase
      .from("va_task_assignments")
      .delete()
      .eq("id", parseInt(id));
    if (error) {
      return Response.json({ error: error.message }, { status: 400 });
    }
    return Response.json({ success: true });
  }

  if (vaId && ptaId) {
    const { error } = await supabase
      .from("va_task_assignments")
      .delete()
      .eq("va_id", vaId)
      .eq("project_task_assignment_id", parseInt(ptaId));
    if (error) {
      return Response.json({ error: error.message }, { status: 400 });
    }
    return Response.json({ success: true });
  }

  return Response.json(
    { error: "Provide id or va_id+project_task_assignment_id" },
    { status: 400 }
  );
}
