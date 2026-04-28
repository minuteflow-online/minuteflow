import { google } from "googleapis";
import { NextRequest } from "next/server";

export const dynamic = "force-dynamic";

function getGoogleAuth() {
  const keyJson = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_KEY!);
  return new google.auth.GoogleAuth({
    credentials: keyJson,
    scopes: ["https://www.googleapis.com/auth/drive.readonly"],
  });
}

export async function GET(request: NextRequest) {
  const fileId = request.nextUrl.searchParams.get("id");
  if (!fileId) {
    return new Response("Missing id", { status: 400 });
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
    return new Response(`Drive fetch failed: ${message}`, { status: 500 });
  }
}
