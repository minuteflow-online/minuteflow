// Turning in work on an in-progress task. Mirrors src/lib/submissions.ts
// (the word-count bar) and src/components/SubmitWorkModal.tsx's upload flow
// (src/app/api/assigned-tasks/[id]/submissions + its upload-url sub-route),
// adapted to bearer-token auth and a raw fetch instead of the
// @supabase/supabase-js client this project deliberately doesn't depend on
// (see db.ts's own comment on staying a thin PostgREST+fetch client).
import { ensureAuth } from "./db";
import { API_BASE, SUPABASE_URL, SUPABASE_ANON_KEY } from "./config";

/** A message on its own has to say something — this is the bar. */
export const MIN_SUBMISSION_WORDS = 15;

export function countWords(text: string | null | undefined): number {
  return (text ?? "").trim().split(/\s+/).filter(Boolean).length;
}

/** What counts as a real submission — a file or a link is evidence on its
 *  own, so either passes alone; a bare message has to carry the whole
 *  account of the work. */
export function submissionMeetsBar({
  message,
  link,
  fileCount,
}: {
  message?: string | null;
  link?: string | null;
  fileCount: number;
}): boolean {
  if (fileCount > 0) return true;
  if (link?.trim()) return true;
  return countWords(message) >= MIN_SUBMISSION_WORDS;
}

export interface PendingAttachment {
  path: string;
  filename: string;
  size: number;
  mime_type: string | null;
}

/** Claims a signed upload slot for one file, scoped server-side to this
 *  task's own storage folder. */
export async function requestUploadSlot(
  assignedTaskId: number,
  filename: string,
  size: number
): Promise<{ path: string; token: string } | null> {
  const session = await ensureAuth();
  if (!session) return null;
  try {
    const res = await fetch(`${API_BASE}/api/assigned-tasks/${assignedTaskId}/submissions/upload-url`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${session.access_token}`,
      },
      body: JSON.stringify({ filename, size }),
    });
    if (!res.ok) return null;
    const data = await res.json();
    return { path: data.path, token: data.token };
  } catch {
    return null;
  }
}

/** Uploads straight to Supabase Storage via the signed slot above — the same
 *  direct-to-storage path web's SubmitWorkModal uses, so a multi-file
 *  submission never rides through the API route's body (Vercel caps that at
 *  4.5MB). This is the raw HTTP call @supabase/supabase-js's
 *  uploadToSignedUrl() makes (PUT .../object/upload/sign/<bucket>/<path>
 *  ?token=..., a FormData body with a cacheControl field plus the file under
 *  an empty field name) — reproduced by hand rather than pulling in the SDK. */
export async function uploadFileToSignedSlot(path: string, token: string, file: File): Promise<boolean> {
  const session = await ensureAuth();
  if (!session) return false;
  try {
    const form = new FormData();
    form.append("cacheControl", "3600");
    form.append("", file);
    const res = await fetch(
      `${SUPABASE_URL}/storage/v1/object/upload/sign/task-attachments/${path}?token=${encodeURIComponent(token)}`,
      {
        method: "PUT",
        headers: {
          apikey: SUPABASE_ANON_KEY,
          Authorization: `Bearer ${session.access_token}`,
          "x-upsert": "false",
        },
        body: form,
      }
    );
    return res.ok;
  } catch {
    return false;
  }
}

export interface SubmitWorkResult {
  ok: boolean;
  error?: string;
  /** "submitted", or the server's auto-outcome — "completed"/"approved" for
   *  logged categories or tasks that don't require review. */
  autoStatus?: string;
}

/** Saves the submission row once every attachment is already in storage. */
export async function postSubmission(
  assignedTaskId: number,
  params: { message?: string; link?: string; attachments: PendingAttachment[] }
): Promise<SubmitWorkResult> {
  const session = await ensureAuth();
  if (!session) return { ok: false, error: "Not signed in." };
  try {
    const res = await fetch(`${API_BASE}/api/assigned-tasks/${assignedTaskId}/submissions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${session.access_token}`,
      },
      body: JSON.stringify({
        message_type: "submission",
        message: params.message || undefined,
        link: params.link || undefined,
        attachments: params.attachments,
      }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      return { ok: false, error: data.error ?? `Unable to save the submission (${res.status}).` };
    }
    return { ok: true, autoStatus: data.autoStatus ?? "submitted" };
  } catch {
    return { ok: false, error: "Network error — nothing was recorded. Try again." };
  }
}
