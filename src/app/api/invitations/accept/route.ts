import { createClient as createAdminClient } from "@supabase/supabase-js";

export const dynamic = "force-dynamic";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;

function makeAdminClient() {
  return createAdminClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

/**
 * POST /api/invitations/accept
 * Public endpoint (VA is not logged in yet).
 * Body: {
 *   code: string,
 *   password: string,
 *   username: string,
 *   full_name: string,
 *   position?: string,
 *   department?: string,
 *   payment_method: 'gcash' | 'bank' | 'none',
 *   gcash_number?: string,
 *   gcash_name?: string,
 *   gcash_city?: string,
 *   bank_name?: string,
 *   bank_account_number?: string,
 *   bank_account_name?: string,
 * }
 */
export async function POST(request: Request) {
  const body = await request.json();
  const {
    code,
    password,
    username,
    full_name,
    position,
    department,
    payment_method,
    gcash_number,
    gcash_name,
    gcash_city,
    bank_name,
    bank_account_number,
    bank_account_name,
  } = body as {
    code: string;
    password: string;
    username: string;
    full_name: string;
    position?: string;
    department?: string;
    payment_method: "gcash" | "bank" | "none";
    gcash_number?: string;
    gcash_name?: string;
    gcash_city?: string;
    bank_name?: string;
    bank_account_number?: string;
    bank_account_name?: string;
  };

  if (!code || !password || !username || !full_name) {
    return Response.json(
      { error: "code, password, username, and full_name are required" },
      { status: 400 }
    );
  }

  if (password.length < 6) {
    return Response.json(
      { error: "Password must be at least 6 characters" },
      { status: 400 }
    );
  }

  const adminClient = makeAdminClient();
  const now = new Date().toISOString();

  // 1. Look up and validate the invitation
  const { data: invite, error: inviteError } = await adminClient
    .from("invitations")
    .select("id, email, expires_at, used_at, employment_type, requires_extension")
    .eq("code", code)
    .single();

  if (inviteError || !invite) {
    return Response.json({ error: "Invalid invite code" }, { status: 400 });
  }

  if (invite.used_at) {
    return Response.json({ error: "This invite has already been used" }, { status: 400 });
  }

  if (invite.expires_at < now) {
    return Response.json({ error: "This invite has expired" }, { status: 400 });
  }

  const email = invite.email as string;

  // 2. Create Supabase auth user
  const { data: newUser, error: createError } = await adminClient.auth.admin.createUser({
    email,
    password,
    email_confirm: true, // no confirmation email needed — they were already verified via invite
    user_metadata: {
      username,
      full_name,
      role: "va",
    },
  });

  if (createError) {
    return Response.json({ error: createError.message }, { status: 400 });
  }

  const userId = newUser.user?.id;
  if (!userId) {
    return Response.json({ error: "Failed to create user account" }, { status: 500 });
  }

  // 3. Build payment_accounts JSONB
  const paymentAccounts: Record<string, Record<string, string>> = {};
  if (payment_method === "gcash" && (gcash_number || gcash_name)) {
    paymentAccounts.gcash = {
      number: gcash_number || "",
      name: gcash_name || "",
      city: gcash_city || "",
    };
  } else if (payment_method === "bank" && (bank_name || bank_account_number)) {
    paymentAccounts.bank_deposit = {
      bank_name: bank_name || "",
      account_number: bank_account_number || "",
      account_name: bank_account_name || "",
    };
  }

  // 4. Update profile (trigger creates it; we update fields)
  // Wait a moment for the trigger to fire and create the profile row
  await new Promise((resolve) => setTimeout(resolve, 1500));

  const { error: profileError } = await adminClient
    .from("profiles")
    .update({
      full_name,
      username,
      position: position || null,
      department: department || null,
      role: "va",
      payment_accounts: paymentAccounts,
      employment_type: (invite as { employment_type?: string | null }).employment_type || null,
      requires_extension: (invite as { requires_extension?: boolean }).requires_extension === true,
      extension_popup_shown: false,
    })
    .eq("id", userId);

  if (profileError) {
    console.error("Profile update error:", profileError.message);
    // Non-fatal — user is created, profile will be partially populated
  }

  // 5. Mark invite as used
  await adminClient
    .from("invitations")
    .update({ used_at: now, used_by: userId })
    .eq("id", invite.id);

  return Response.json({ success: true });
}
