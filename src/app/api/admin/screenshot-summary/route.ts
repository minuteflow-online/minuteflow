import { NextRequest, NextResponse } from "next/server";
import { google } from "googleapis";
import { execFileSync } from "child_process";
import fs from "fs";
import os from "os";
import path from "path";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

function getGoogleAuth() {
  const keyJson = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_KEY!);
  return new google.auth.GoogleAuth({
    credentials: keyJson,
    scopes: ["https://www.googleapis.com/auth/drive.readonly"],
  });
}

async function downloadDriveFile(fileId: string, destPath: string) {
  const auth = getGoogleAuth();
  const drive = google.drive({ version: "v3", auth });
  const res = await drive.files.get({ fileId, alt: "media" }, { responseType: "arraybuffer" });
  fs.writeFileSync(destPath, Buffer.from(res.data as ArrayBuffer));
}

// Ported from the earlier verify-timelogs.cjs prototype (ticket 1be40941).
// --allowedTools Read MUST come before --print or the CLI call errors.
function describeScreenshot(imagePath: string): string {
  return execFileSync(
    "claude",
    [
      "--allowedTools",
      "Read",
      "--print",
      `Read the image file at ${imagePath} and describe in 2-3 sentences what screen/task is visible, whether it looks idle/blank, and any visible status banners.`,
    ],
    { encoding: "utf8", timeout: 60000 }
  ).trim();
}

function judgeTaskSummary(
  taskName: string,
  claimedMemo: string,
  descriptions: { type: string; text: string }[]
): string {
  const joined = descriptions.map((d, i) => `Screenshot ${i + 1} (${d.type}): ${d.text}`).join("\n");
  return execFileSync(
    "claude",
    [
      "--allowedTools",
      "Read",
      "--print",
      `Claimed task: "${taskName}". Claimed work: "${claimedMemo}".\n\nScreenshot descriptions in chronological order:\n${joined}\n\nRespond in exactly this format:\nSUMMARY: <one sentence: what the screenshots show this person doing>\nVERDICT: match|mismatch|uncertain\nDEVIATION: <if the person appears to have switched away from the claimed task at some point, say when/to what; otherwise write "none observed">`,
    ],
    { encoding: "utf8", timeout: 60000 }
  ).trim();
}

function parseVerdict(raw: string) {
  const summary = raw.match(/SUMMARY:\s*(.+)/)?.[1]?.trim() || "";
  const verdictWord = raw.match(/VERDICT:\s*(\w+)/)?.[1]?.trim().toLowerCase();
  const deviation = raw.match(/DEVIATION:\s*(.+)/)?.[1]?.trim() || "";
  const verdict = verdictWord === "match" || verdictWord === "mismatch" ? verdictWord : "uncertain";
  return { summary, verdict, deviation };
}

export async function POST(request: NextRequest) {
  // Re-check admin role here explicitly — API routes are NOT covered by the
  // (admin) route group's layout guard, only page navigation is.
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { data: profile } = await supabase.from("profiles").select("role").eq("id", user.id).single();
  if (!profile || profile.role !== "admin") {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const { userId, date } = await request.json();
  if (!userId || !date) {
    return NextResponse.json({ error: "userId and date required" }, { status: 400 });
  }

  const { data: logs, error: logsErr } = await supabase
    .from("time_logs")
    .select("id, task_name, project, client_memo, start_time")
    .eq("user_id", userId)
    .eq("session_date", date)
    .order("start_time");
  if (logsErr) return NextResponse.json({ error: logsErr.message }, { status: 500 });
  if (!logs || !logs.length) return NextResponse.json({ userId, date, tasks: [] });

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "mf-summary-"));
  const tasks = [];

  try {
    for (const log of logs) {
      const { data: shots, error: shotsErr } = await supabase
        .from("task_screenshots")
        .select("id, filename, screenshot_type, drive_file_id")
        .eq("log_id", log.id)
        .order("created_at");
      if (shotsErr) return NextResponse.json({ error: shotsErr.message }, { status: 500 });

      const withDrive = (shots || []).filter((s) => s.drive_file_id);
      const sampled =
        withDrive.length <= 4
          ? withDrive
          : [
              withDrive[0],
              withDrive[Math.floor(withDrive.length / 3)],
              withDrive[Math.floor((2 * withDrive.length) / 3)],
              withDrive[withDrive.length - 1],
            ];

      const descriptions: { type: string; text: string }[] = [];
      for (const shot of sampled) {
        const localPath = path.join(tmpDir, shot.filename);
        await downloadDriveFile(shot.drive_file_id as string, localPath);
        descriptions.push({ type: shot.screenshot_type || "unknown", text: describeScreenshot(localPath) });
        fs.unlinkSync(localPath);
      }

      if (!descriptions.length) {
        tasks.push({
          logId: log.id,
          task_name: log.task_name,
          verdict: "uncertain",
          summary: "No screenshots with a Drive file available for this task.",
          deviation: "",
        });
        continue;
      }

      const raw = judgeTaskSummary(log.task_name, log.client_memo || "", descriptions);
      const { summary, verdict, deviation } = parseVerdict(raw);
      tasks.push({ logId: log.id, task_name: log.task_name, verdict, summary, deviation });
    }
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }

  return NextResponse.json({ userId, date, tasks });
}
