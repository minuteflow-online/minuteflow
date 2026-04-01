import { createClient } from "@supabase/supabase-js";
import { createClient as createServerClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;

/** Verify the caller is an authenticated admin */
async function verifyAdmin(): Promise<{ userId: string } | Response> {
  const supabase = await createServerClient();
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
  if (!profile || profile.role !== "admin") {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }
  return { userId: user.id };
}

/** POST: Create a new user via Supabase Admin API */
export async function POST(request: Request) {
  const authResult = await verifyAdmin();
  if (authResult instanceof Response) return authResult;

  const body = await request.json();
  const { email, password, username, full_name, role, department, position, pay_rate, pay_rate_type } = body;

  if (!email || !password || !username || !full_name) {
    return Response.json(
      { error: "email, password, username, and full_name are required" },
      { status: 400 }
    );
  }

  const adminClient = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  // Create user via admin API
  const { data: newUser, error: createError } =
    await adminClient.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: {
        username,
        full_name,
        role: role || "va",
      },
    });

  if (createError) {
    return Response.json({ error: createError.message }, { status: 400 });
  }

  // Update profile with additional fields (trigger creates baseline profile)
  if (newUser?.user) {
    await adminClient
      .from("profiles")
      .update({
        department: department || null,
        position: position || null,
        role: role || "va",
        pay_rate: pay_rate || 0,
        pay_rate_type: pay_rate_type || "hourly",
      })
      .eq("id", newUser.user.id);
  }

  return Response.json({ user: newUser.user }, { status: 201 });
}

/** PUT: Reset a user's password via Supabase Admin API */
export async function PUT(request: Request) {
  const authResult = await verifyAdmin();
  if (authResult instanceof Response) return authResult;

  const body = await request.json();
  const { userId, newPassword } = body;

  if (!userId || !newPassword) {
    return Response.json(
      { error: "userId and newPassword are required" },
      { status: 400 }
    );
  }

  if (newPassword.length < 6) {
    return Response.json(
      { error: "Password must be at least 6 characters" },
      { status: 400 }
    );
  }

  try {
    const res = await fetch(
      `${SUPABASE_URL}/auth/v1/admin/users/${userId}`,
      {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
          apikey: SUPABASE_SERVICE_ROLE_KEY,
        },
        body: JSON.stringify({ password: newPassword }),
      }
    );

    if (!res.ok) {
      const errData = await res.json();
      return Response.json(
        { error: errData.msg || errData.message || "Failed to reset password" },
        { status: res.status }
      );
    }

    return Response.json({ success: true });
  } catch {
    return Response.json(
      { error: "Failed to connect to auth service" },
      { status: 500 }
    );
  }
}

/** PATCH: Update user profile or disable user */
export async function PATCH(request: Request) {
  const authResult = await verifyAdmin();
  if (authResult instanceof Response) return authResult;

  const body = await request.json();
  const { user_id, ...updates } = body;

  if (!user_id) {
    return Response.json({ error: "user_id is required" }, { status: 400 });
  }

  const adminClient = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  // If disabling/enabling user, use admin API
  if ("disabled" in updates) {
    const banned = !!updates.disabled;
    const { error: banError } = await adminClient.auth.admin.updateUserById(
      user_id,
      { ban_duration: banned ? "876000h" : "none" }
    );
    if (banError) {
      return Response.json({ error: banError.message }, { status: 400 });
    }
    delete updates.disabled;
  }

  // Update profile fields
  const profileUpdates: Record<string, unknown> = {};
  const allowedFields = [
    "full_name",
    "username",
    "role",
    "department",
    "position",
    "pay_rate",
    "pay_rate_type",
    "is_active",
  ];
  for (const field of allowedFields) {
    if (field in updates) {
      profileUpdates[field] = updates[field];
    }
  }

  if (Object.keys(profileUpdates).length > 0) {
    const { error: updateError } = await adminClient
      .from("profiles")
      .update(profileUpdates)
      .eq("id", user_id);

    if (updateError) {
      return Response.json({ error: updateError.message }, { status: 400 });
    }
  }

  return Response.json({ success: true });
}

/** DELETE: Delete a user (profile + auth account) */
export async function DELETE(request: Request) {
  const authResult = await verifyAdmin();
  if (authResult instanceof Response) return authResult;

  const { searchParams } = new URL(request.url);
  const userId = searchParams.get("userId");

  if (!userId) {
    return Response.json({ error: "userId is required" }, { status: 400 });
  }

  // Prevent admin from deleting themselves
  if (userId === (authResult as { userId: string }).userId) {
    return Response.json(
      { error: "You cannot delete your own account" },
      { status: 400 }
    );
  }

  const adminClient = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  // Check how many time logs this user has
  const { count: logCount } = await adminClient
    .from("time_logs")
    .select("id", { count: "exact", head: true })
    .eq("user_id", userId);

  // Delete related records in order (to avoid FK constraint issues)
  // 1. task_screenshots
  await adminClient.from("task_screenshots").delete().eq("user_id", userId);

  // 2. sessions
  await adminClient.from("sessions").delete().eq("user_id", userId);

  // 3. team_assignments (as VA or manager)
  await adminClient.from("team_assignments").delete().eq("va_id", userId);
  await adminClient.from("team_assignments").delete().eq("manager_id", userId);

  // 4. messages (sent to or sent by)
  await adminClient.from("messages").delete().eq("target_user_id", userId);
  await adminClient.from("messages").delete().eq("sender_id", userId);

  // 5. extension_heartbeats
  await adminClient.from("extension_heartbeats").delete().eq("user_id", userId);

  // 6. time_correction_requests (requested by)
  await adminClient
    .from("time_correction_requests")
    .delete()
    .eq("requested_by", userId);

  // 7. time_log_edits (edited by)
  await adminClient.from("time_log_edits").delete().eq("edited_by", userId);

  // 8. capture_requests
  await adminClient
    .from("capture_requests")
    .delete()
    .eq("target_user_id", userId);
  await adminClient
    .from("capture_requests")
    .delete()
    .eq("requested_by", userId);

  // 9. time_logs
  await adminClient.from("time_logs").delete().eq("user_id", userId);

  // 10. profile (CASCADE should handle this from auth deletion, but be explicit)
  await adminClient.from("profiles").delete().eq("id", userId);

  // 11. Delete auth user
  const { error: deleteError } =
    await adminClient.auth.admin.deleteUser(userId);

  if (deleteError) {
    return Response.json({ error: deleteError.message }, { status: 400 });
  }

  return Response.json({
    success: true,
    time_logs_deleted: logCount || 0,
  });
}
