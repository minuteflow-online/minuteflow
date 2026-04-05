import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

/** GET: List VA project assignments
 *  ?va_id=xxx           → assignments for a specific VA
 *  ?project_tag_id=xxx  → assignments for a specific project
 *  (no params)          → all assignments (admin only)
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
  const projectTagId = searchParams.get("project_tag_id");

  const assignmentType = searchParams.get("assignment_type"); // 'include' | 'exclude'

  let query = supabase
    .from("va_project_assignments")
    .select(
      "id, va_id, project_tag_id, billing_type, rate, assignment_type, assigned_by, assigned_at, profiles!va_project_assignments_va_id_fkey(id, full_name, username), project_tags(id, account, project_name)"
    )
    .order("assigned_at", { ascending: false });

  if (assignmentType) {
    query = query.eq("assignment_type", assignmentType);
  }

  if (vaId) {
    query = query.eq("va_id", vaId);
  }
  if (projectTagId) {
    query = query.eq("project_tag_id", parseInt(projectTagId));
  }

  const { data, error } = await query;

  if (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }

  return Response.json({ assignments: data ?? [] });
}

/** POST: Assign VA(s) to project(s)
 *  Body: { va_id, project_tag_ids: [1,2,3] }                → assign one VA to multiple projects
 *  Body: { project_tag_id, va_ids: ["uuid1","uuid2"] }      → assign multiple VAs to one project
 *  Body: { va_id, project_tag_id, billing_type?, rate? }     → assign single with optional rate
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
  const { va_id, project_tag_ids, project_tag_id, va_ids, billing_type, rate, assignment_type } = body;
  const effectiveType = assignment_type === "exclude" ? "exclude" : "include";

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let rows: any[] = [];

  // Mode 1: One VA → multiple projects
  if (va_id && Array.isArray(project_tag_ids) && project_tag_ids.length > 0) {
    rows = project_tag_ids.map((ptId: number) => ({
      va_id,
      project_tag_id: ptId,
      billing_type: billing_type ?? "hourly",
      rate: rate ?? null,
      assignment_type: effectiveType,
      assigned_by: user.id,
    }));
  }
  // Mode 2: One project → multiple VAs
  else if (project_tag_id && Array.isArray(va_ids) && va_ids.length > 0) {
    rows = va_ids.map((vid: string) => ({
      va_id: vid,
      project_tag_id,
      billing_type: billing_type ?? "hourly",
      rate: rate ?? null,
      assignment_type: effectiveType,
      assigned_by: user.id,
    }));
  }
  // Mode 3: Single assignment
  else if (va_id && project_tag_id) {
    rows = [
      {
        va_id,
        project_tag_id,
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
          "Provide (va_id + project_tag_ids[]), (project_tag_id + va_ids[]), or (va_id + project_tag_id)",
      },
      { status: 400 }
    );
  }

  const { data, error } = await supabase
    .from("va_project_assignments")
    .upsert(rows, { onConflict: "va_id,project_tag_id", ignoreDuplicates: false })
    .select(
      "id, va_id, project_tag_id, billing_type, rate, assignment_type, assigned_at, profiles!va_project_assignments_va_id_fkey(id, full_name, username), project_tags(id, account, project_name)"
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
  const { id, billing_type, rate, assignment_type } = body;

  if (!id) {
    return Response.json({ error: "id is required" }, { status: 400 });
  }

  const updates: Record<string, unknown> = {};
  if (billing_type !== undefined) updates.billing_type = billing_type;
  if (rate !== undefined) updates.rate = rate;
  if (assignment_type !== undefined) updates.assignment_type = assignment_type;

  if (Object.keys(updates).length === 0) {
    return Response.json({ error: "Nothing to update" }, { status: 400 });
  }

  const { data, error } = await supabase
    .from("va_project_assignments")
    .update(updates)
    .eq("id", id)
    .select(
      "id, va_id, project_tag_id, billing_type, rate, assignment_type, assigned_at, profiles!va_project_assignments_va_id_fkey(id, full_name, username), project_tags(id, account, project_name)"
    )
    .single();

  if (error) {
    return Response.json({ error: error.message }, { status: 400 });
  }

  return Response.json({ assignment: data });
}

/** DELETE: Remove VA project assignment(s)
 *  ?id=xxx                          → remove single assignment by ID
 *  ?va_id=xxx&project_tag_id=xxx    → remove by VA+project combo
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
  const projectTagId = searchParams.get("project_tag_id");

  if (id) {
    const { error } = await supabase
      .from("va_project_assignments")
      .delete()
      .eq("id", parseInt(id));
    if (error) {
      return Response.json({ error: error.message }, { status: 400 });
    }
    return Response.json({ success: true });
  }

  if (vaId && projectTagId) {
    const { error } = await supabase
      .from("va_project_assignments")
      .delete()
      .eq("va_id", vaId)
      .eq("project_tag_id", parseInt(projectTagId));
    if (error) {
      return Response.json({ error: error.message }, { status: 400 });
    }
    return Response.json({ success: true });
  }

  return Response.json(
    { error: "Provide id or va_id+project_tag_id" },
    { status: 400 }
  );
}
