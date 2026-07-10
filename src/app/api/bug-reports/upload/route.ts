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
      msg.includes("invalid credentials")
    );
  }
  return false;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function uploadToDrive(auth: any, filename: string, buffer: Buffer): Promise<string> {
  const drive = google.drive({ version: "v3", auth });
  const res = await drive.files.create({
    requestBody: {
      name: filename,
      parents: [GOOGLE_DRIVE_FOLDER_ID],
      mimeType: "image/png",
    },
    media: {
      mimeType: "image/png",
      body: Readable.from(buffer),
    },
    fields: "id",
  });
  const fileId = res.data.id;
  if (!fileId) throw new Error("Google Drive upload returned no file ID");
  return fileId;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function makeDriveFilePublic(auth: any, fileId: string): Promise<void> {
  try {
    const drive = google.drive({ version: "v3", auth });
    await drive.permissions.create({
      fileId,
      requestBody: { type: "anyone", role: "reader" },
    });
  } catch (err) {
    console.warn(`[bug-reports/upload] Could not set anyone/reader on ${fileId} (non-fatal):`, err instanceof Error ? err.message : err);
  }
}

export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });

    const formData = await request.formData();
    const blob = formData.get("file") as Blob | null;
    if (!blob) return Response.json({ error: "No file provided" }, { status: 400 });

    const { data: profile } = await supabase
      .from("profiles")
      .select("full_name, username")
      .eq("id", user.id)
      .single();

    const vaName = profile?.full_name || profile?.username || "Unknown";
    const timestamp = new Date().toISOString().replace(/[:.]/g, "-").replace("T", "_").replace("Z", "");
    const filename = `bug_${sanitizeFilename(vaName)}_${timestamp}.png`;

    const arrayBuffer = await blob.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    let driveFileId: string;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let auth: any;

    try {
      auth = await buildGoogleAuthClient();
      driveFileId = await uploadToDrive(auth, filename, buffer);
    } catch (firstErr) {
      if (isAuthError(firstErr)) {
        await refreshGoogleToken();
        auth = await buildGoogleAuthClient();
        driveFileId = await uploadToDrive(auth, filename, buffer);
      } else {
        throw firstErr;
      }
    }

    await makeDriveFilePublic(auth, driveFileId);

    return Response.json({ drive_file_id: driveFileId });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return Response.json({ error: "Upload failed", details: message }, { status: 500 });
  }
}
