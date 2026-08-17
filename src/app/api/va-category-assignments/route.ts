import { createClient } from "@/lib/supabase/server";
import { hasBroadAdminAccess } from "@/lib/financialAccess";

export const dynamic = "force-dynamic";

/** GET: List VA category assignments
 *  ?va_id=xxx       → assignments for a specific VA
 *  ?category_id=xxx → assignments for a specific category
 *  (no params)      → all assignments (admin only)
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
  const categoryId = searchParams.get("category_id");

  let query = supabase
    .from("va_category_assignments")
    .select("id, va_id, category_id, assigned_by, assigned_at, task_categories(id, category_name)")
    .order("assigned_at", { ascending: false });

  if (vaId) {
    query = query.eq("va_id", vaId);
  }
  if (categoryId) {
    query = query.eq("category_id", parseInt(categoryId));
  }

  const { data, error } = await query;

  if (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }

  const rows = data ?? [];
  // va_category_assignments.va_id has no direct FK to profiles (it points to
  // auth.users), so PostgREST can't embed profiles via a join hint here —
  // fetch them separately and merge instead.
  const vaIds = [...new Set(rows.map((r) => r.va_id))];
  const { data: vaProfiles } = vaIds.length
    ? await supabase.from("profiles").select("id, full_name, username").in("id", vaIds)
    : { data: [] };
  const profileMap = new Map((vaProfiles ?? []).map((p) => [p.id, p]));

  const assignments = rows.map((r) => ({ ...r, profiles: profileMap.get(r.va_id) ?? null }));

  return Response.json({ assignments });
}

/** POST: Assign VA(s) to category/categories (batch support)
 *  Body: { va_id, category_ids: [1,2,3] }        → assign one VA to multiple categories
 *  Body: { category_id, va_ids: ["uuid1","uuid2"] } → assign multiple VAs to one category
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
    .select("role, department")
    .eq("id", user.id)
    .single();
  if (!hasBroadAdminAccess(profile)) {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }

  const body = await request.json();
  const { va_id, category_ids, category_id, va_ids } = body;

  let rows: { va_id: string; category_id: number; assigned_by: string }[] = [];

  // Mode 1: One VA → multiple categories
  if (va_id && Array.isArray(category_ids) && category_ids.length > 0) {
    rows = category_ids.map((catId: number) => ({
      va_id,
      category_id: catId,
      assigned_by: user.id,
    }));
  }
  // Mode 2: One category → multiple VAs
  else if (category_id && Array.isArray(va_ids) && va_ids.length > 0) {
    rows = va_ids.map((vid: string) => ({
      va_id: vid,
      category_id,
      assigned_by: user.id,
    }));
  } else {
    return Response.json(
      { error: "Provide (va_id + category_ids[]) or (category_id + va_ids[])" },
      { status: 400 }
    );
  }

  const { data, error } = await supabase
    .from("va_category_assignments")
    .upsert(rows, { onConflict: "va_id,category_id", ignoreDuplicates: true })
    .select("id, va_id, category_id, assigned_at, task_categories(id, category_name)");

  if (error) {
    return Response.json({ error: error.message }, { status: 400 });
  }

  // va_category_assignments.va_id has no direct FK to profiles (it points to
  // auth.users), so PostgREST can't embed profiles via a join hint here —
  // fetch them separately and merge instead.
  const upserted = data ?? [];
  const vaIds = [...new Set(upserted.map((r) => r.va_id))];
  const { data: vaProfiles } = vaIds.length
    ? await supabase.from("profiles").select("id, full_name, username").in("id", vaIds)
    : { data: [] };
  const profileMap = new Map((vaProfiles ?? []).map((p) => [p.id, p]));

  const assignments = upserted.map((r) => ({ ...r, profiles: profileMap.get(r.va_id) ?? null }));

  return Response.json({ assignments }, { status: 201 });
}

/** DELETE: Remove VA category assignment(s)
 *  ?id=xxx          → remove single assignment by ID
 *  ?va_id=xxx&category_id=xxx → remove by VA+category combo
 *  ?ids=1,2,3       → bulk remove by IDs
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
    .select("role, department")
    .eq("id", user.id)
    .single();
  if (!hasBroadAdminAccess(profile)) {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }

  const { searchParams } = new URL(request.url);
  const id = searchParams.get("id");
  const ids = searchParams.get("ids");
  const vaId = searchParams.get("va_id");
  const categoryId = searchParams.get("category_id");

  // Delete by ID
  if (id) {
    const { error } = await supabase
      .from("va_category_assignments")
      .delete()
      .eq("id", parseInt(id));
    if (error) {
      return Response.json({ error: error.message }, { status: 400 });
    }
    return Response.json({ success: true });
  }

  // Bulk delete by IDs
  if (ids) {
    const idList = ids
      .split(",")
      .map((i) => parseInt(i.trim()))
      .filter((i) => !isNaN(i));
    if (idList.length === 0) {
      return Response.json({ error: "No valid ids provided" }, { status: 400 });
    }
    const { error } = await supabase
      .from("va_category_assignments")
      .delete()
      .in("id", idList);
    if (error) {
      return Response.json({ error: error.message }, { status: 400 });
    }
    return Response.json({ success: true, deleted: idList.length });
  }

  // Delete by VA + category combo
  if (vaId && categoryId) {
    const { error } = await supabase
      .from("va_category_assignments")
      .delete()
      .eq("va_id", vaId)
      .eq("category_id", parseInt(categoryId));
    if (error) {
      return Response.json({ error: error.message }, { status: 400 });
    }
    return Response.json({ success: true });
  }

  return Response.json(
    { error: "Provide id, ids, or va_id+category_id" },
    { status: 400 }
  );
}
