import { createClient } from "@supabase/supabase-js";
import { google } from "googleapis";
import { Readable } from "stream";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const GOOGLE_DRIVE_FOLDER_ID = process.env.GOOGLE_DRIVE_FOLDER_ID!;

function getGoogleAuth() {
  const keyJson = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_KEY!);
  return new google.auth.GoogleAuth({
    credentials: keyJson,
    scopes: ["https://www.googleapis.com/auth/drive.file"],
  });
}

function sanitizeFilename(name: string): string {
  return name.replace(/[^a-zA-Z0-9_\-. ]/g, "_").replace(/\s+/g, "_");
}

export async function POST(request: Request) {
  // Simple auth: require a secret header to prevent unauthorized calls
  const authHeader = request.headers.get("x-sync-secret");
  if (authHeader !== process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
    const auth = getGoogleAuth();
    const drive = google.drive({ version: "v3", auth });

    // Query task_screenshots without a drive_file_id, joined with time_logs
    // and profiles for naming
    const { data: screenshots, error: queryError } = await supabase
      .from("task_screenshots")
      .select(
        `
        id,
        user_id,
        log_id,
        filename,
        storage_path,
        created_at,
        screenshot_type
      `
      )
      .is("drive_file_id", null)
      .not("storage_path", "is", null)
      .order("created_at", { ascending: true })
      .limit(20); // Process in batches to stay within time limits

    if (queryError) {
      return Response.json(
        { error: "Failed to query screenshots", details: queryError.message },
        { status: 500 }
      );
    }

    if (!screenshots || screenshots.length === 0) {
      return Response.json({
        message: "No screenshots to sync",
        synced: 0,
      });
    }

    const results: Array<{
      id: number;
      status: string;
      drive_file_id?: string;
      error?: string;
    }> = [];

    for (const screenshot of screenshots) {
      try {
        // Get VA name and task name from time_logs if available
        let vaName = "Unknown";
        let taskName = "screenshot";

        if (screenshot.log_id) {
          const { data: logEntry } = await supabase
            .from("time_logs")
            .select("full_name, username, task_name")
            .eq("id", screenshot.log_id)
            .single();

          if (logEntry) {
            vaName = logEntry.full_name || logEntry.username || "Unknown";
            taskName = logEntry.task_name || "screenshot";
          }
        } else if (screenshot.user_id) {
          // Fall back to profiles table
          const { data: profile } = await supabase
            .from("profiles")
            .select("full_name, username")
            .eq("id", screenshot.user_id)
            .single();

          if (profile) {
            vaName = profile.full_name || profile.username || "Unknown";
          }
        }

        // Format timestamp for filename
        const timestamp = new Date(screenshot.created_at)
          .toISOString()
          .replace(/[:.]/g, "-")
          .replace("T", "_")
          .replace("Z", "");

        // Build filename: {VA_name}_{task_name}_{timestamp}.png
        const driveFilename = `${sanitizeFilename(vaName)}_${sanitizeFilename(taskName)}_${timestamp}.png`;

        // Download screenshot from Supabase Storage
        const { data: fileData, error: downloadError } = await supabase.storage
          .from("screenshots")
          .download(screenshot.storage_path);

        if (downloadError || !fileData) {
          results.push({
            id: screenshot.id,
            status: "error",
            error: `Download failed: ${downloadError?.message || "No data"}`,
          });
          continue;
        }

        // Convert Blob to Buffer for upload
        const arrayBuffer = await fileData.arrayBuffer();
        const buffer = Buffer.from(arrayBuffer);

        // Upload to Google Drive
        const driveResponse = await drive.files.create({
          requestBody: {
            name: driveFilename,
            parents: [GOOGLE_DRIVE_FOLDER_ID],
            mimeType: "image/png",
          },
          media: {
            mimeType: "image/png",
            body: Readable.from(buffer),
          },
          fields: "id,name,webViewLink",
        });

        const driveFileId = driveResponse.data.id;

        if (!driveFileId) {
          results.push({
            id: screenshot.id,
            status: "error",
            error: "Drive upload returned no file ID",
          });
          continue;
        }

        // Update the task_screenshots record with drive_file_id
        const { error: updateError } = await supabase
          .from("task_screenshots")
          .update({ drive_file_id: driveFileId })
          .eq("id", screenshot.id);

        if (updateError) {
          results.push({
            id: screenshot.id,
            status: "error",
            error: `Update failed: ${updateError.message}`,
            drive_file_id: driveFileId,
          });
          continue;
        }

        results.push({
          id: screenshot.id,
          status: "synced",
          drive_file_id: driveFileId,
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        results.push({
          id: screenshot.id,
          status: "error",
          error: message,
        });
      }
    }

    const synced = results.filter((r) => r.status === "synced").length;
    const errors = results.filter((r) => r.status === "error").length;

    return Response.json({
      message: `Synced ${synced} screenshots, ${errors} errors`,
      synced,
      errors,
      total: screenshots.length,
      results,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return Response.json(
      { error: "Sync failed", details: message },
      { status: 500 }
    );
  }
}

// GET endpoint for status check
export async function GET() {
  try {
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    const { count: totalCount } = await supabase
      .from("task_screenshots")
      .select("*", { count: "exact", head: true });

    const { count: syncedCount } = await supabase
      .from("task_screenshots")
      .select("*", { count: "exact", head: true })
      .not("drive_file_id", "is", null);

    const { count: pendingCount } = await supabase
      .from("task_screenshots")
      .select("*", { count: "exact", head: true })
      .is("drive_file_id", null)
      .not("storage_path", "is", null);

    return Response.json({
      total_screenshots: totalCount ?? 0,
      synced_to_drive: syncedCount ?? 0,
      pending_sync: pendingCount ?? 0,
      drive_folder_id: GOOGLE_DRIVE_FOLDER_ID,
      service_account: "minuteflow-screenshots@minuteflow-490808.iam.gserviceaccount.com",
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return Response.json(
      { error: "Status check failed", details: message },
      { status: 500 }
    );
  }
}
