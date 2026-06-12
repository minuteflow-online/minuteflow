import { createClient } from "@/lib/supabase/server";
import { google } from "googleapis";
import { Readable } from "stream";
import { NextRequest } from "next/server";
import { buildGoogleAuthClient, refreshGoogleToken } from "@/lib/google-token";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

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
      msg.includes("autherror") ||
      msg.includes("invalid credentials")
    );
  }
  return false;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function uploadToDrive(auth: any, filename: string, buffer: Buffer, mimeType: string): Promise<string> {
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
    fields: "id,webViewLink",
  });
  const fileId = driveResponse.data.id;
  if (!fileId) throw new Error("Google Drive upload returned no file ID");
  return fileId;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function makeDriveFilePublic(auth: any, fileId: string): Promise<string> {
  const drive = google.drive({ version: "v3", auth });
  try {
    await drive.permissions.create({
      fileId,
      requestBody: { type: "anyone", role: "reader" },
    });
  } catch (err) {
    console.warn("[upload-submission-screenshot] Could not set public permission (non-fatal):", err);
  }
  // Return the thumbnail URL (directly embeddable)
  return `https://drive.google.com/thumbnail?id=${fileId}&sz=w800`;
}

/**
 * POST /api/upload-submission-screenshot
 * Body: FormData with { file: Blob }
 * Returns: { drive_file_id, url }
 */
export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      return Response.json({ error: "Unauthorized" }, { status: 401 });
    }

    const formData = await request.formData();
    const file = formData.get("file") as Blob | null;
    if (!file) {
      return Response.json({ error: "file is required" }, { status: 400 });
    }

    // Get VA name for filename
    const { data: profile } = await supabase
      .from("profiles")
      .select("full_name, username")
      .eq("id", user.id)
      .single();
    const vaName = profile?.full_name || profile?.username || "VA";

    // Determine mime type and extension
    const mimeType = file.type || "image/png";
    const ext = mimeType.includes("pdf") ? "pdf" : mimeType.includes("jpeg") || mimeType.includes("jpg") ? "jpg" : "png";
    const timestamp = new Date().toISOString().replace(/[:.]/g, "-").replace("T", "_").replace("Z", "");
    const filename = `submission_${sanitizeFilename(vaName)}_${timestamp}.${ext}`;

    const arrayBuffer = await file.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    let driveAuth: ReturnType<typeof buildGoogleAuthClient> extends Promise<infer T> ? T : never;
    let driveFileId: string;

    try {
      driveAuth = await buildGoogleAuthClient();
      driveFileId = await uploadToDrive(driveAuth, filename, buffer, mimeType);
    } catch (firstErr) {
      if (isAuthError(firstErr)) {
        await refreshGoogleToken();
        driveAuth = await buildGoogleAuthClient();
        driveFileId = await uploadToDrive(driveAuth, filename, buffer, mimeType);
      } else {
        throw firstErr;
      }
    }

    const url = await makeDriveFilePublic(driveAuth, driveFileId);

    return Response.json({ drive_file_id: driveFileId, url });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return Response.json({ error: "Upload failed", details: message }, { status: 500 });
  }
}
