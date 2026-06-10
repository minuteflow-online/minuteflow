import { createClient } from "@/lib/supabase/server";
import { createClient as createServiceClient } from "@supabase/supabase-js";

export const dynamic = "force-dynamic";

/** GET /api/square-settings — fetch Square credentials (admin only) */
export async function GET() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const serviceClient = createServiceClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
  const { data } = await serviceClient
    .from("square_settings")
    .select("id, application_id, location_id, environment, created_at, updated_at")
    // NOTE: access_token is intentionally excluded from GET — never send to client
    .limit(1)
    .single();

  return Response.json({ settings: data ?? null });
}

/** POST /api/square-settings — save Square credentials */
export async function POST(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });

  // Admin role check — only admins may overwrite Square credentials
  const { data: profile } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .single();
  if (profile?.role !== "admin") {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }

  const body = await request.json();
  const { application_id, access_token, location_id, environment = "production" } = body;

  if (!application_id?.trim()) return Response.json({ error: "Application ID is required" }, { status: 400 });
  if (!access_token?.trim()) return Response.json({ error: "Access Token is required" }, { status: 400 });
  if (!location_id?.trim()) return Response.json({ error: "Location ID is required" }, { status: 400 });

  const serviceClient = createServiceClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );

  // Check if a row already exists
  const { data: existing } = await serviceClient
    .from("square_settings")
    .select("id")
    .limit(1)
    .single();

  if (existing) {
    // Update
    const { error } = await serviceClient
      .from("square_settings")
      .update({
        application_id: application_id.trim(),
        access_token: access_token.trim(),
        location_id: location_id.trim(),
        environment,
        updated_at: new Date().toISOString(),
      })
      .eq("id", existing.id);
    if (error) return Response.json({ error: error.message }, { status: 500 });
  } else {
    // Insert
    const { error } = await serviceClient
      .from("square_settings")
      .insert({
        application_id: application_id.trim(),
        access_token: access_token.trim(),
        location_id: location_id.trim(),
        environment,
      });
    if (error) return Response.json({ error: error.message }, { status: 500 });
  }

  return Response.json({ success: true });
}
