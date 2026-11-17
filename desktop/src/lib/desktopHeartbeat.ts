// Tells the server desktop is open for this user, so the extension (and the
// web app's own "reshare your screen" nag) can stand down instead of running
// a second capture stream alongside desktop's — mirrors the Chrome
// extension's own sendHeartbeat()/extension_heartbeats exactly, just a
// separate table so neither side's "am I still the one capturing?" check
// has to guess which app last wrote a row meant for the other one.
//
// Runs for as long as the app is signed in, not just while clocked in —
// same lifecycle as autoCapture's own interval (see App.tsx): the point is
// "is desktop actually open and usable right now," not "is it capturing
// this exact second."
import { query } from "./db";
import pkg from "../../package.json";

const HEARTBEAT_INTERVAL_MS = 30000;

async function sendHeartbeat(userId: string): Promise<void> {
  try {
    await query("desktop_heartbeats", {
      method: "POST",
      filters: "on_conflict=user_id",
      body: {
        user_id: userId,
        desktop_version: pkg.version,
        last_seen: new Date().toISOString(),
        is_active: true,
      },
      headers: {
        Prefer: "resolution=merge-duplicates,return=representation",
      },
    });
  } catch {
    // Best-effort — a missed beat just means the extension/web fall back to
    // capturing themselves until the next one lands, not a lost screenshot.
  }
}

/** Starts sending a heartbeat every 30s. Returns a function that stops it. */
export function startDesktopHeartbeat(userId: string): () => void {
  void sendHeartbeat(userId);
  const id = setInterval(() => void sendHeartbeat(userId), HEARTBEAT_INTERVAL_MS);
  return () => clearInterval(id);
}
