import { NextResponse } from "next/server";
import { readFileSync } from "fs";
import { join } from "path";

/**
 * Serves the MinuteFlow extension zip with explicit download headers.
 * Using an API route (instead of a direct public/ link) ensures the browser
 * always triggers a save-to-disk download and never tries to "install" the
 * file as a Chrome extension — which would cause a Package Invalid error.
 */
export async function GET() {
  try {
    const filePath = join(process.cwd(), "public", "minuteflow-extension.zip");
    const fileBuffer = readFileSync(filePath);

    return new NextResponse(fileBuffer, {
      status: 200,
      headers: {
        "Content-Type": "application/octet-stream",
        "Content-Disposition":
          'attachment; filename="minuteflow-extension.zip"',
        "Content-Length": fileBuffer.length.toString(),
        "Cache-Control": "no-store",
      },
    });
  } catch {
    return new NextResponse("Extension file not found", { status: 404 });
  }
}
