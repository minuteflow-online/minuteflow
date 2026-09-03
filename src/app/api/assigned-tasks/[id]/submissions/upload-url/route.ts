import { createClient } from "@/lib/supabase/server";
import { createClient as createAdminClient } from "@supabase/supabase-js";

export const dynamic = "force-dynamic";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;

/** Matches the bucket's own ceiling — see storage.buckets.file_size_limit. */
const MAX_FILE_BYTES = 52428800;

type RouteContext = { params: Promise<{ id: string }> };

/**
 * POST /api/assigned-tasks/[id]/submissions/upload-url
 * Body: { filename, size }
 * → { path, token }
 *
 * A signed slot in task-attachments so the browser can upload the file
 * straight to storage. Attachments used to ride along in the submission's
 * multipart POST, which put every byte through the serverless request body —
 * capped at 4.5MB on Vercel. Past that the platform answers 413 with an HTML
 * body, so the modal couldn't even read an error message out of it and said
 * "Unable to save the submission" with no reason. Flor hit it with seven
 * flyer PNGs.
 *
 * The server picks the path, so a caller can't aim an upload at another
 * task's folder, and the submission POST only accepts paths under the task
 * it is being written to.
 */
export async function POST(request: Request, { params }: RouteContext) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;

  // RLS decides this: a caller who can't see the task can't select it, and
  // therefore can't be handed an upload slot against it.
  const { data: task, error: taskError } = await supabase
    .from("assigned_tasks")
    .select("id")
    .eq("id", id)
    .maybeSingle();
  if (taskError || !task) return Response.json({ error: "Forbidden" }, { status: 403 });

  const body = await request.json().catch(() => ({}));
  const filename = String(body.filename ?? "").trim();
  const size = Number(body.size ?? 0);

  if (!filename) return Response.json({ error: "A filename is required" }, { status: 400 });
  if (size > MAX_FILE_BYTES) {
    return Response.json({ error: "File too large (max 50MB)" }, { status: 400 });
  }

  const admin = createAdminClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const safeName = filename.replace(/[^a-zA-Z0-9._-]/g, "_");
  const path = `tasks/${id}/submissions/pending/${Date.now()}-${Math.random()
    .toString(36)
    .slice(2, 8)}-${safeName}`;

  const { data, error } = await admin.storage
    .from("task-attachments")
    .createSignedUploadUrl(path);

  if (error || !data) {
    return Response.json(
      { error: error?.message ?? "Unable to start the upload" },
      { status: 500 }
    );
  }

  return Response.json({ path: data.path, token: data.token });
}
