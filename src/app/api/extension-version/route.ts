import { createClient as createServiceClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { EXTENSION_MIN_VERSION, isVersionOlder } from "@/lib/extensionVersion";

export const dynamic = "force-dynamic";

/**
 * GET /api/extension-version
 *
 * The extension version the caller is running, and whether it's behind.
 *
 * Exists because extension_upload_status is admin-only under RLS, so a VA can't
 * read their own row from the browser. This reads it with the service key but
 * only ever for the authenticated caller's own user_id — never anyone else's.
 */
export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();

  if (authError || !user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const service = createServiceClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  );

  const { data, error } = await service
    .from("extension_upload_status")
    .select("extension_version")
    .eq("user_id", user.id)
    .maybeSingle();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const version = data?.extension_version ?? null;

  return NextResponse.json({
    version,
    required: EXTENSION_MIN_VERSION,
    // No reported version means the extension has never checked in — that's the
    // "not installed" case, which the SCE banner already covers. Only an actually
    // reported, actually older version counts as outdated here.
    outdated: version !== null && isVersionOlder(version, EXTENSION_MIN_VERSION),
  });
}
