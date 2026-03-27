import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

/** GET: List all clients with their linked accounts */
export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { data: clients, error } = await supabase
    .from("clients")
    .select("*")
    .order("name");

  if (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }

  // Fetch account-client mappings with joined account names
  const { data: mappings } = await supabase
    .from("account_client_map")
    .select("account_id, client_id, accounts(id, name)");

  return Response.json({ clients, mappings: mappings ?? [] });
}

/** POST: Create a new client */
export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await request.json();
  const { name, contact_name, email, phone, address, city, state, zip, country, logo_url, payment_terms, currency, tax_id, default_hourly_rate, notes } = body;

  if (!name?.trim()) {
    return Response.json({ error: "Name is required" }, { status: 400 });
  }

  const insert: Record<string, unknown> = { name: name.trim() };
  if (contact_name !== undefined) insert.contact_name = contact_name || null;
  if (email !== undefined) insert.email = email || null;
  if (phone !== undefined) insert.phone = phone || null;
  if (address !== undefined) insert.address = address || null;
  if (city !== undefined) insert.city = city || null;
  if (state !== undefined) insert.state = state || null;
  if (zip !== undefined) insert.zip = zip || null;
  if (country !== undefined) insert.country = country || null;
  if (logo_url !== undefined) insert.logo_url = logo_url || null;
  if (payment_terms !== undefined) insert.payment_terms = payment_terms;
  if (currency !== undefined) insert.currency = currency;
  if (tax_id !== undefined) insert.tax_id = tax_id || null;
  if (default_hourly_rate !== undefined) insert.default_hourly_rate = default_hourly_rate || null;
  if (notes !== undefined) insert.notes = notes || null;

  const { data, error } = await supabase
    .from("clients")
    .insert(insert)
    .select()
    .single();

  if (error) {
    return Response.json({ error: error.message }, { status: 400 });
  }

  return Response.json({ client: data }, { status: 201 });
}

/** PATCH: Update a client */
export async function PATCH(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await request.json();
  const { id, name, active, contact_name, email, phone, address, city, state, zip, country, logo_url, payment_terms, currency, tax_id, default_hourly_rate, notes } = body;

  if (!id) {
    return Response.json({ error: "id is required" }, { status: 400 });
  }

  const updates: Record<string, unknown> = {};
  if (name !== undefined) updates.name = name.trim();
  if (active !== undefined) updates.active = active;
  if (contact_name !== undefined) updates.contact_name = contact_name || null;
  if (email !== undefined) updates.email = email || null;
  if (phone !== undefined) updates.phone = phone || null;
  if (address !== undefined) updates.address = address || null;
  if (city !== undefined) updates.city = city || null;
  if (state !== undefined) updates.state = state || null;
  if (zip !== undefined) updates.zip = zip || null;
  if (country !== undefined) updates.country = country || null;
  if (logo_url !== undefined) updates.logo_url = logo_url || null;
  if (payment_terms !== undefined) updates.payment_terms = payment_terms;
  if (currency !== undefined) updates.currency = currency;
  if (tax_id !== undefined) updates.tax_id = tax_id || null;
  if (default_hourly_rate !== undefined) updates.default_hourly_rate = default_hourly_rate || null;
  if (notes !== undefined) updates.notes = notes || null;

  const { error } = await supabase
    .from("clients")
    .update(updates)
    .eq("id", id);

  if (error) {
    return Response.json({ error: error.message }, { status: 400 });
  }

  return Response.json({ success: true });
}

/** DELETE: Delete a client */
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

  const { error } = await supabase.from("clients").delete().eq("id", id);

  if (error) {
    return Response.json({ error: error.message }, { status: 400 });
  }

  return Response.json({ success: true });
}
