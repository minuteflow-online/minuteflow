import { createClient as createAdminClient, type SupabaseClient } from "@supabase/supabase-js";
import { hasBroadAdminAccess } from "@/lib/financialAccess";

/**
 * "Can this user see/post to this project (Objective or Operation)?" — the one
 * rule every project-scoped surface (Message Board, To-dos, Docs & Files, and
 * anything else that lands on an Objective/Operation page) needs, written
 * once so six routes don't grow six slightly different versions of it.
 *
 * Per Toni's answer on Operations visibility (2026-08-18): admins see every
 * project; everyone else sees only what pertains to them, which for a
 * project is "am I assigned to it, or did I create it" — not per-item
 * ownership within the project. A VA assigned to an Operation sees every
 * message/task on it, the same way they already see every subtask on it
 * (VAProjectsTab's project_id-scoped fetch has no per-item filter either).
 */
export async function canAccessProject(
  serviceClient: SupabaseClient,
  profile: { role?: string | null } | null | undefined,
  userId: string,
  projectId: string
): Promise<boolean> {
  if (hasBroadAdminAccess(profile)) return true;

  const { data: project } = await serviceClient
    .from("projects")
    .select("created_by")
    .eq("id", projectId)
    .maybeSingle();
  if (project?.created_by === userId) return true;

  const { data: access } = await serviceClient
    .from("project_va_access")
    .select("va_id")
    .eq("project_id", projectId)
    .eq("va_id", userId)
    .maybeSingle();
  return Boolean(access);
}

export function serviceClient() {
  return createAdminClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  );
}
