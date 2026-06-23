import { createClient } from "@supabase/supabase-js";
import { createClient as createServerClient } from "@/lib/supabase/server";
import { google } from "googleapis";
import { Readable } from "stream";
import { NextRequest } from "next/server";
import { buildGoogleAuthClient, refreshGoogleToken } from "@/lib/google-token";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const GOOGLE_DRIVE_FOLDER_ID = process.env.GOOGLE_DRIVE_FOLDER_ID!;

function sanitizeFilename(name: string): string {
  return name.replace(/[^a-zA-Z0-9_\-. ]/g, "_").replace(/\s+/g, "_");
}

function isAuthError(err: unknown): boolean {
  if (err instanceof Error) {
    const msg = err.message.toLowerCase();
    return (
      msg.includes("401") ||
      msg.includes("invalid_grant") ||
      msg.includes("token") ||
      msg.includes("unauthorized") ||
      msg.includes("invalid credentials")
    );
  }
  return false;
}

async function uploadToDrive(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  auth: any,
  filename: string,
  buffer: Buffer,
  mimeType: string
): Promise<string> {
  const drive = google.drive({ version: "v3", auth });

  const driveResponse = await drive.files.create({
    requestBody: {
      name: filename,
      parents: [GOOGLE_DRIVE_FOLDER_ID],
      mimeType,
    },
    media: {
      mimeType,
      body: Readable.from(buffer),
    },
    fields: "id,name,webViewLink",
  });

  const fileId = driveResponse.data.id;
  if (!fileId) {
    throw new Error("Google Drive upload returned no file ID");
  }
  return fileId;
}

async function makeDriveFilePublic(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  auth: any,
  fileId: string
): Promise<void> {
  try {
    const drive = google.drive({ version: "v3", auth });
    await drive.permissions.create({
      fileId,
      requestBody: { type: "anyone", role: "reader" },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.warn(`[profile-files] Could not set public permission on ${fileId} (non-fatal):`, message);
  }
}

export async function POST(request: NextRequest) {
  try {
    // Auth gate — must be authenticated
    const serverSupabase = await createServerClient();
    const { data: { user } } = await serverSupabase.auth.getUser();
    if (!user) {
      return Response.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { data: callerProfile } = await serverSupabase
      .from("profiles")
      .select("role")
      .eq("id", user.id)
      .single();

    const formData = await request.formData();
    const blob = formData.get("file") as Blob | null;
    const userId = formData.get("userId") as string | null;
    const fileType = formData.get("fileType") as string | null;
    const filename = formData.get("filename") as string | null;

    if (!blob || !userId || !fileType || !filename) {
      return Response.json(
        { error: "Missing required fields: file, userId, fileType, filename" },
        { status: 400 }
      );
    }

    if (fileType !== "resume" && fileType !== "general") {
      return Response.json({ error: "fileType must be 'resume' or 'general'" }, { status: 400 });
    }

    // Authz — caller must be the profile owner or an admin
    if (!callerProfile || (callerProfile.role !== "admin" && user.id !== userId)) {
      return Response.json({ error: "Forbidden" }, { status: 403 });
    }

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    // Build Drive filename with timestamp to avoid collisions
    const timestamp = new Date()
      .toISOString()
      .replace(/[:.]/g, "-")
      .replace("T", "_")
      .replace("Z", "");
    const driveFilename = `profile_${fileType}_${sanitizeFilename(filename)}_${timestamp}`;

    const mimeType = blob.type || "application/pdf";
    const arrayBuffer = await blob.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    // Drive upload with self-healing retry on auth errors
    let driveFileId: string;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let driveAuth: any;

    try {
      driveAuth = await buildGoogleAuthClient();
      driveFileId = await uploadToDrive(driveAuth, driveFilename, buffer, mimeType);
    } catch (firstErr) {
      if (isAuthError(firstErr)) {
        console.warn("[profile-files] Auth error on first attempt, refreshing token and retrying:", firstErr);
        try {
          await refreshGoogleToken();
          driveAuth = await buildGoogleAuthClient();
          driveFileId = await uploadToDrive(driveAuth, driveFilename, buffer, mimeType);
        } catch (retryErr) {
          const message = retryErr instanceof Error ? retryErr.message : String(retryErr);
          console.error("[profile-files] Retry after token refresh also failed:", message);
          return Response.json(
            { error: "Drive upload failed after token refresh", details: message },
            { status: 502 }
          );
        }
      } else {
        throw firstErr;
      }
    }

    await makeDriveFilePublic(driveAuth, driveFileId);

    // If replacing a resume, delete the old record first
    if (fileType === "resume") {
      await supabase
        .from("profile_files")
        .delete()
        .eq("user_id", userId)
        .eq("file_type", "resume");
    }

    const { error: insertError } = await supabase
      .from("profile_files")
      .insert({
        user_id: userId,
        file_type: fileType,
        filename: filename,
        drive_file_id: driveFileId,
      });

    if (insertError) {
      return Response.json(
        { error: "DB insert failed", details: insertError.message },
        { status: 500 }
      );
    }

    return Response.json({ ok: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return Response.json({ error: "Upload failed", details: message }, { status: 500 });
  }
}
