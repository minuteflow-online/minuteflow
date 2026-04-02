import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

/** GET: List all task categories */
export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { data, error } = await supabase
    .from("task_categories")
    .select("*")
    .order("sort_order")
    .order("category_name");

  if (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }

  return Response.json({ categories: data ?? [] });
}

/** POST: Create a category */
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
  const { category_name } = body;

  if (!category_name?.trim()) {
    return Response.json({ error: "category_name is required" }, { status: 400 });
  }

  // Get next sort_order
  const { data: existing } = await supabase
    .from("task_categories")
    .select("sort_order")
    .order("sort_order", { ascending: false })
    .limit(1);

  const nextOrder = (existing?.[0]?.sort_order ?? -1) + 1;

  const { data, error } = await supabase
    .from("task_categories")
    .insert({
      category_name: category_name.trim(),
      sort_order: nextOrder,
      created_by: user.id,
    })
    .select()
    .single();

  if (error) {
    if (error.code === "23505") {
      return Response.json(
        { error: "A category with this name already exists" },
        { status: 409 }
      );
    }
    return Response.json({ error: error.message }, { status: 400 });
  }

  return Response.json({ category: data }, { status: 201 });
}

/** PATCH: Update a category (rename) */
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
  const { id, category_name } = body;

  if (!id) {
    return Response.json({ error: "id is required" }, { status: 400 });
  }

  if (!category_name?.trim()) {
    return Response.json({ error: "category_name is required" }, { status: 400 });
  }

  const { error } = await supabase
    .from("task_categories")
    .update({ category_name: category_name.trim() })
    .eq("id", id);

  if (error) {
    if (error.code === "23505") {
      return Response.json(
        { error: "A category with this name already exists" },
        { status: 409 }
      );
    }
    return Response.json({ error: error.message }, { status: 400 });
  }

  return Response.json({ success: true });
}

/** DELETE: Delete a category (tasks become uncategorized) */
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

  if (!id) {
    return Response.json({ error: "id is required" }, { status: 400 });
  }

  // Tasks with this category_id will have it set to NULL (ON DELETE SET NULL)
  const { error } = await supabase.from("task_categories").delete().eq("id", id);

  if (error) {
    return Response.json({ error: error.message }, { status: 400 });
  }

  return Response.json({ success: true });
}
