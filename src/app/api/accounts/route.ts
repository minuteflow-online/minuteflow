import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

/** GET: List all accounts with their linked clients */
export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { data: accounts, error } = await supabase
    .from("accounts")
    .select("*")
    .order("name");

  if (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }

  // Fetch account-client mappings with joined names
  const { data: mappings } = await supabase
    .from("account_client_map")
    .select("account_id, client_id, clients(id, name)");

  return Response.json({ accounts, mappings: mappings ?? [] });
}

/** POST: Create a new account */
export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await request.json();
  const { name } = body;

  if (!name?.trim()) {
    return Response.json({ error: "Name is required" }, { status: 400 });
  }

  const { data, error } = await supabase
    .from("accounts")
    .insert({ name: name.trim() })
    .select()
    .single();

  if (error) {
    return Response.json({ error: error.message }, { status: 400 });
  }

  return Response.json({ account: data }, { status: 201 });
}

/** PATCH: Update an account */
export async function PATCH(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await request.json();
  const { id, name, active, billing_rate, linkClientId, unlinkClientId } = body;

  if (!id) {
    return Response.json({ error: "id is required" }, { status: 400 });
  }

  // Update name/active/billing_rate
  if (name !== undefined || active !== undefined || billing_rate !== undefined) {
    const updates: Record<string, unknown> = {};
    if (name !== undefined) updates.name = name.trim();
    if (active !== undefined) updates.active = active;
    if (billing_rate !== undefined) updates.billing_rate = billing_rate;

    const { error } = await supabase
      .from("accounts")
      .update(updates)
      .eq("id", id);

    if (error) {
      return Response.json({ error: error.message }, { status: 400 });
    }
  }

  // Link a client
  if (linkClientId) {
    const { error } = await supabase
      .from("account_client_map")
      .insert({ account_id: id, client_id: linkClientId });

    if (error && !error.message.includes("duplicate")) {
      return Response.json({ error: error.message }, { status: 400 });
    }
  }

  // Unlink a client
  if (unlinkClientId) {
    await supabase
      .from("account_client_map")
      .delete()
      .eq("account_id", id)
      .eq("client_id", unlinkClientId);
  }

  return Response.json({ success: true });
}

/** DELETE: Delete an account */
export async function DELETE(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const id = searchParams.get("id");

  if (!id) {
    return Response.json({ error: "id is required" }, { status: 400 });
  }

  const { error } = await supabase.from("accounts").delete().eq("id", id);

  if (error) {
    return Response.json({ error: error.message }, { status: 400 });
  }

  return Response.json({ success: true });
}
