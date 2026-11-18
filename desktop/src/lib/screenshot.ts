// Full-screen capture — the actual reason this app exists instead of just
// using the Chrome extension. desktopCapturer (main process, via preload)
// sees every monitor and every open window, not just an active browser tab;
// getUserMedia here in the renderer does the actual pixel readback once a
// source id is picked.
//
// Uploads go straight to /api/upload-screenshot, same endpoint the extension
// posts to for its "manual"/"remote" direct-upload path (background.js
// captureAndUpload). That route has no auth gate of its own — it trusts the
// client-supplied userId (see the minuteflow-no-root-middleware memory) — so
// no bearer token is needed here, only the fields it expects.
import { API_BASE } from "./config";

export class ScreenshotError extends Error {}

/**
 * Perceptual fingerprint of a capture — a 64-bit difference hash as 16 hex
 * chars. Ported from the extension's imageFingerprint (background.js) so
 * "Unchanged" detection (the admin screenshot grid, and the idle-screen
 * check in staticScreen.ts) works the same way regardless of which surface
 * took the shot — without this, every desktop capture's image_hash stays
 * null and never gets flagged as unchanged, no matter how idle the screen.
 *
 * Squashes to 9x8 greyscale and compares each pixel to its right-hand
 * neighbour, so the hash describes screen *layout* rather than exact
 * pixels — two untouched frames hash identical even though a blinking
 * cursor makes their raw pixels differ slightly.
 *
 * Returns null if it can't be computed; callers treat that as "unknown",
 * never as "changed" — same contract as the extension's version.
 */
function computeFingerprint(source: CanvasImageSource): string | null {
  try {
    const width = 9;
    const height = 8;
    const small = document.createElement("canvas");
    small.width = width;
    small.height = height;
    const ctx = small.getContext("2d", { willReadFrequently: true });
    if (!ctx) return null;
    ctx.drawImage(source, 0, 0, width, height);

    const { data } = ctx.getImageData(0, 0, width, height);
    const grey: number[] = [];
    for (let i = 0; i < width * height; i++) {
      const o = i * 4;
      grey.push(0.299 * data[o] + 0.587 * data[o + 1] + 0.114 * data[o + 2]);
    }

    let bits = "";
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width - 1; x++) {
        bits += grey[y * width + x] > grey[y * width + x + 1] ? "1" : "0";
      }
    }

    let hex = "";
    for (let i = 0; i < 64; i += 4) {
      hex += parseInt(bits.slice(i, i + 4), 2).toString(16);
    }
    return hex;
  } catch (err) {
    console.warn("[MinuteFlow] Fingerprint failed:", err instanceof Error ? err.message : err);
    return null;
  }
}

/** Grabs a single frame from the primary display. Returns the PNG Blob plus
 *  its perceptual fingerprint (null if it couldn't be computed). */
async function captureEntireScreen(): Promise<{ blob: Blob; fingerprint: string | null }> {
  const sources = await window.mfDesktop.getScreenSources();
  const screenSource =
    sources.find((s) => s.id.startsWith("screen:0") || s.name === "Entire Screen") ??
    sources.find((s) => s.id.startsWith("screen:")) ??
    sources[0];

  if (!screenSource) {
    throw new ScreenshotError("No screen source available to capture.");
  }

  // getUserMedia's TS types don't know about Electron's chromeMediaSource
  // constraint shape, hence the cast.
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: false,
    video: {
      mandatory: {
        chromeMediaSource: "desktop",
        chromeMediaSourceId: screenSource.id,
      },
    },
  } as unknown as MediaStreamConstraints);

  try {
    const video = document.createElement("video");
    video.srcObject = stream;
    await new Promise<void>((resolve, reject) => {
      video.onloadedmetadata = () => {
        video.play().then(resolve).catch(reject);
      };
      video.onerror = () => reject(new ScreenshotError("Could not read the screen capture stream."));
    });

    const canvas = document.createElement("canvas");
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new ScreenshotError("Canvas 2D context unavailable.");
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/png"));
    if (!blob) throw new ScreenshotError("Failed to encode the capture as PNG.");
    const fingerprint = computeFingerprint(canvas);
    return { blob, fingerprint };
  } finally {
    // Capture is a single frame, not a continuous share — stop immediately.
    stream.getTracks().forEach((t) => t.stop());
  }
}

export interface UploadResult {
  ok: boolean;
  error?: string;
  screenshot?: { id: number; drive_file_id: string };
}

/** Captures the primary display and uploads it via /api/upload-screenshot
 *  (Google Drive only, per the app's absolute screenshot rule). */
export async function captureAndUploadScreenshot(params: {
  userId: string;
  logId: number;
  screenshotType?: "manual" | "progress" | "start" | "end";
}): Promise<UploadResult> {
  try {
    const { blob, fingerprint } = await captureEntireScreen();

    const formData = new FormData();
    formData.append("file", blob, "screenshot.png");
    formData.append("userId", params.userId);
    formData.append("logId", String(params.logId));
    formData.append("screenshotType", params.screenshotType ?? "manual");
    formData.append("capturedAt", new Date().toISOString());
    formData.append("source", "desktop");
    if (fingerprint) {
      formData.append("fingerprint", fingerprint);
    }

    const res = await fetch(`${API_BASE}/api/upload-screenshot`, {
      method: "POST",
      body: formData,
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({}) as Record<string, string>);
      return { ok: false, error: err.error || err.details || `Upload failed (${res.status})` };
    }

    const data = await res.json();
    return { ok: true, screenshot: data.screenshot };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Capture failed" };
  }
}
