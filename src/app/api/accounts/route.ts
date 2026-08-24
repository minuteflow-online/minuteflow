import { createClient } from "@/lib/supabase/server";
import { hasAccountsClientsAccess } from "@/lib/financialAccess";

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

  // Billing rates are Manager/Founder/Accounting only — strip them for everyone else.
  const { data: callerProfile } = await supabase
    .from("profiles")
    .select("role, department")
    .eq("id", user.id)
    .single();
  const sanitizedAccounts = hasAccountsClientsAccess(callerProfile)
    ? accounts
    : (accounts ?? []).map((a) => ({ ...a, billing_rate: null }));

  return Response.json({ accounts: sanitizedAccounts, mappings: mappings ?? [] });
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

  const { data: callerProfile } = await supabase
    .from("profiles")
    .select("role, department")
    .eq("id", user.id)
    .single();
  const isFullAdmin = hasAccountsClientsAccess(callerProfile);

  const body = await request.json();
  const {
    id, name, active, billing_rate, linkClientId, unlinkClientId,
    daily_hours_budget, weekly_hours_budget,
  } = body;

  if (!id) {
    return Response.json({ error: "id is required" }, { status: 400 });
  }

  // Time budgets ride the same isFullAdmin gate as billing_rate — they're the
  // same kind of client-capacity setting, not something every VA should be
  // able to change out from under the calendar's own consumed-vs-limit reads.
  const hasBudgetField = daily_hours_budget !== undefined || weekly_hours_budget !== undefined;

  // Update name/active/billing_rate/hour budgets
  if (name !== undefined || active !== undefined || (isFullAdmin && (billing_rate !== undefined || hasBudgetField))) {
    const updates: Record<string, unknown> = {};
    if (name !== undefined) updates.name = name.trim();
    if (active !== undefined) updates.active = active;
    if (isFullAdmin && billing_rate !== undefined) updates.billing_rate = billing_rate;
    if (isFullAdmin && daily_hours_budget !== undefined) updates.daily_hours_budget = daily_hours_budget;
    // Weekly is the one number anyone sets — monthly is always 52 weeks a
    // year divided across 12 months, never a second typed-in figure that can
    // drift out of sync with it (TAT Foundation had 26h/wk paired with a
    // hand-entered 110h/mo, when 26 * 52 / 12 is 112h40m). No weekly cap means
    // no derived monthly cap either, so clearing one clears both.
    if (isFullAdmin && weekly_hours_budget !== undefined) {
      updates.weekly_hours_budget = weekly_hours_budget;
      updates.monthly_hours_budget = weekly_hours_budget == null ? null : (weekly_hours_budget * 52) / 12;
    }

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
