import { google } from "googleapis";
import { sendTelegramPhoto, type TelegramTopic } from "./telegram";

/** Enough to show what someone meant without turning one report into a wall of
 *  images. Anything past this stays in the admin panel. */
const MAX_ATTACHMENTS_POSTED = 5;

/**
 * Reads a Drive file's bytes with the service account.
 *
 * Screenshots and report attachments live in Drive and are not public, so
 * anything that needs to hand one to an outside service (Telegram, email) has
 * to fetch it here first — a Drive link on its own is unreadable to them.
 *
 * Returns null rather than throwing: every caller is decorating a message that
 * should still go out without the picture.
 */
export async function fetchDriveFile(fileId: string): Promise<Buffer | null> {
  const keyJson = process.env.GOOGLE_SERVICE_ACCOUNT_KEY;
  if (!keyJson) return null;

  try {
    const auth = new google.auth.GoogleAuth({
      credentials: JSON.parse(keyJson),
      scopes: ["https://www.googleapis.com/auth/drive.readonly"],
    });
    const drive = google.drive({ version: "v3", auth });
    const response = await drive.files.get(
      { fileId, alt: "media" },
      { responseType: "arraybuffer" }
    );
    return Buffer.from(response.data as ArrayBuffer);
  } catch (err) {
    console.error(`drive fetch failed for ${fileId}:`, err);
    return null;
  }
}

/**
 * Posts a report's Drive attachments into a Telegram chat, under the message
 * they belong to.
 *
 * Sent as replies to the alert rather than as its caption: captions cap at 1024
 * characters and would force the alert text to be cut, and a caption cannot
 * carry more than one image anyway.
 *
 * Every failure is swallowed — the alert itself has already been delivered, and
 * a picture that will not load is not worth failing a request over.
 */
export async function sendDriveFilesToTelegram(
  topic: TelegramTopic,
  fileIds: string[],
  replyToMessageId?: number
): Promise<number> {
  let posted = 0;
  for (const fileId of fileIds.slice(0, MAX_ATTACHMENTS_POSTED)) {
    const bytes = await fetchDriveFile(fileId);
    if (!bytes) continue;
    const result = await sendTelegramPhoto(topic, bytes, `${fileId}.png`, { replyToMessageId });
    if (result.ok) posted++;
  }
  return posted;
}
