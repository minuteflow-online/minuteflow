import { createClient } from "@supabase/supabase-js";
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

/** Returns true if the error looks like an auth/token problem. */
function isAuthError(err: unknown): boolean {
  if (err instanceof Error) {
    const msg = err.message.toLowerCase();
    return (
      msg.includes("401") ||
      msg.includes("invalid_grant") ||
      msg.includes("token") ||
      msg.includes("unauthorized") ||
      msg.includes("authError") ||
      msg.includes("invalid credentials")
    );
  }
  return false;
}

/**
 * Upload a buffer to Google Drive.
 * @param auth  Pre-authenticated OAuth2 client
 * @param filename  Drive filename
 * @param buffer  File content
 * @returns Drive file ID
 */
async function uploadToDrive(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  auth: any,
  filename: string,
  buffer: Buffer
): Promise<string> {
  const drive = google.drive({ version: "v3", auth });

  const driveResponse = await drive.files.create({
    requestBody: {
      name: filename,
      parents: [GOOGLE_DRIVE_FOLDER_ID],
      mimeType: "image/png",
    },
    media: {
      mimeType: "image/png",
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

export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData();
    const blob = formData.get("file") as Blob | null;
    const userId = formData.get("userId") as string | null;
    const logId = formData.get("logId") as string | null;
    const screenshotType = formData.get("screenshotType") as string | null;
    const captureRequestId = formData.get("captureRequestId") as string | null;

    if (!blob || !userId || !logId || !screenshotType) {
      return Response.json(
        { error: "Missing required fields: file, userId, logId, screenshotType" },
        { status: 400 }
      );
    }

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    // Look up VA name and task name for the Drive filename
    let vaName = "Unknown";
    let taskName = "screenshot";

    const { data: logEntry } = await supabase
      .from("time_logs")
      .select("full_name, username, task_name")
      .eq("id", Number(logId))
      .single();

    if (logEntry) {
      vaName = logEntry.full_name || logEntry.username || "Unknown";
      taskName = logEntry.task_name || "screenshot";
    } else {
      const { data: profile } = await supabase
        .from("profiles")
        .select("full_name, username")
        .eq("id", userId)
        .single();
      if (profile) {
        vaName = profile.full_name || profile.username || "Unknown";
      }
    }

    // Build Drive filename
    const timestamp = new Date()
      .toISOString()
      .replace(/[:.]/g, "-")
      .replace("T", "_")
      .replace("Z", "");
    const driveFilename = `${sanitizeFilename(vaName)}_${sanitizeFilename(taskName)}_${timestamp}.png`;

    // Convert Blob to Buffer once
    const arrayBuffer = await blob.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    // ── Drive upload with self-healing retry ─────────────────
    let driveFileId: string;

    try {
      const auth = await buildGoogleAuthClient();
      driveFileId = await uploadToDrive(auth, driveFilename, buffer);
    } catch (firstErr) {
      if (isAuthError(firstErr)) {
        // Token was invalid — force a fresh refresh and retry once
        console.warn("[upload-screenshot] Auth error on first attempt, refreshing token and retrying:", firstErr);
        try {
          await refreshGoogleToken();
          const authRetry = await buildGoogleAuthClient();
          driveFileId = await uploadToDrive(authRetry, driveFilename, buffer);
          console.log("[upload-screenshot] Self-heal retry succeeded.");
        } catch (retryErr) {
          const message = retryErr instanceof Error ? retryErr.message : String(retryErr);
          console.error("[upload-screenshot] Retry after token refresh also failed:", message);
          return Response.json(
            { error: "Drive upload failed after token refresh", details: message },
            { status: 502 }
          );
        }
      } else {
        throw firstErr; // Non-auth error — bubble up
      }
    }

    // Insert task_screenshots record — Drive only, no storage_path
    const { data: ssData, error: insertError } = await supabase
      .from("task_screenshots")
      .insert({
        user_id: userId,
        log_id: Number(logId),
        filename: driveFilename,
        drive_file_id: driveFileId,
        screenshot_type: screenshotType,
        ...(captureRequestId ? { capture_request_id: Number(captureRequestId) } : {}),
      })
      .select()
      .single();

    if (insertError) {
      return Response.json(
        { error: "DB insert failed", details: insertError.message },
        { status: 500 }
      );
    }

    return Response.json({ screenshot: ssData });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return Response.json({ error: "Upload failed", details: message }, { status: 500 });
  }
}
