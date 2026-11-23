import { google } from "googleapis";
import { NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { orgVisibleShots, serviceClient } from "@/lib/clientAdminAccess";

export const dynamic = "force-dynamic";

function getGoogleAuth() {
  const keyJson = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_KEY!);
  return new google.auth.GoogleAuth({
    credentials: keyJson,
    scopes: ["https://www.googleapis.com/auth/drive.readonly"],
  });
}

export async function GET(request: NextRequest) {
  // Auth guard — any logged-in staff member may view drive images
  // (screenshots) — deliberate, Toni's call, 2026-11-09. A client is new and
  // narrower: they may only see screenshots belonging to their own org's VAs,
  // never anyone else's, so that one case gets an extra check below.
  const supabase = await createClient();
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();
  if (authError || !user) {
    return new Response("Unauthorized", { status: 401 });
  }

  const fileId = request.nextUrl.searchParams.get("id");
  if (!fileId) {
    return new Response("Missing id", { status: 400 });
  }

  const { data: profile } = await supabase
    .from("profiles")
    .select("role, organization_id")
    .eq("id", user.id)
    .single();

  if (profile?.role === "client") {
    if (!profile.organization_id) {
      return new Response("Forbidden", { status: 403 });
    }
    const admin = serviceClient();
    const { data: shots } = await admin
      .from("task_screenshots")
      .select("user_id, log_id, submission_id")
      .eq("drive_file_id", fileId)
      .limit(5);
    // Only captures of work done for this client's org — not the VA's
    // agency or other-client work, even though the VA is in the org.
    const visible = await orgVisibleShots(admin, profile.organization_id, shots ?? []);
    if (visible.length === 0) {
      return new Response("Forbidden", { status: 403 });
    }
  }

  try {
    const auth = getGoogleAuth();
    const drive = google.drive({ version: "v3", auth });

    const response = await drive.files.get(
      { fileId, alt: "media" },
      { responseType: "arraybuffer" }
    );

    const buffer = Buffer.from(response.data as ArrayBuffer);

    return new Response(buffer, {
      headers: {
        "Content-Type": "image/png",
        "Cache-Control": "public, max-age=86400",
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    // Logged, not just returned. The response body of a failed <img> request is
    // never seen by anyone — the browser shows a broken image and the reason
    // disappears. Drive returns very different problems through this one path
    // (rate limit, permission, file gone), and telling them apart afterwards
    // is impossible without this line.
    console.error("drive-image: fetch failed", { fileId, message });
    return new Response(`Drive fetch failed: ${message}`, { status: 500 });
  }
}
