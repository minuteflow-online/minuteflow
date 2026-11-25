import { createClient } from "@/lib/supabase/server";
import { hasBroadAdminAccess } from "@/lib/financialAccess";
import { createClient as createAdminClient } from "@supabase/supabase-js";

export const dynamic = "force-dynamic";

function serviceClient() {
  return createAdminClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  );
}

async function requireAdmin() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: Response.json({ error: "Unauthorized" }, { status: 401 }) };
  const { data: profile } = await supabase.from("profiles").select("role, department").eq("id", user.id).single();
  if (!hasBroadAdminAccess(profile)) return { error: Response.json({ error: "Forbidden" }, { status: 403 }) };
  return { user };
}

async function getUserAndRole() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: Response.json({ error: "Unauthorized" }, { status: 401 }) };
  const { data: profile } = await supabase
    .from("profiles")
    .select("role, department, organization_id")
    .eq("id", user.id)
    .single();
  // A client (employer) works only with their own org's projects.
  const clientOrgId =
    profile?.role === "client" && profile.organization_id ? (profile.organization_id as string) : null;
  return { user, isAdmin: hasBroadAdminAccess(profile), clientOrgId };
}

/** The org a project belongs to (null = an agency project), or undefined if it doesn't exist. */
async function projectOrg(supabase: ReturnType<typeof serviceClient>, id: string): Promise<string | null | undefined> {
  const { data } = await supabase.from("projects").select("organization_id").eq("id", id).maybeSingle();
  if (!data) return undefined;
  return (data.organization_id as string | null) ?? null;
}

/** The client org's active VAs — the only people a client may add to a project. */
async function orgVaIds(supabase: ReturnType<typeof serviceClient>, orgId: string): Promise<Set<string>> {
  const { data } = await supabase
    .from("organization_members")
    .select("va_id")
    .eq("organization_id", orgId)
    .eq("status", "active");
  return new Set((data ?? []).map((m) => m.va_id as string));
}

/**
 * For a client: every project id it names (parent, linked objective) must be
 * its own org's, and every VA it adds must be on its team. Returns an error
 * response, or null when the request stays inside the org.
 */
async function checkClientProjectRefs(
  supabase: ReturnType<typeof serviceClient>,
  orgId: string,
  body: { va_ids?: string[]; parent_project_id?: string | null; linked_objective_id?: string | null }
): Promise<Response | null> {
  for (const ref of [body.parent_project_id, body.linked_objective_id]) {
    if (ref && (await projectOrg(supabase, ref)) !== orgId) {
      return Response.json({ error: "That parent or linked objective isn't yours." }, { status: 403 });
    }
  }
  if (Array.isArray(body.va_ids) && body.va_ids.length > 0) {
    const allowed = await orgVaIds(supabase, orgId);
    if (body.va_ids.some((id) => !allowed.has(id))) {
      return Response.json({ error: "You can only add VAs on your own team." }, { status: 403 });
    }
  }
  return null;
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const id = searchParams.get("id");
  const mine = searchParams.get("mine") === "true";
  const kind = searchParams.get("kind"); // "objective" | "operation" — omit for all kinds

  const supabase = serviceClient();

  if (id) {
    const auth = await getUserAndRole();
    if ("error" in auth) return auth.error;
    const { data, error } = await supabase.from("projects").select("*").eq("id", id).maybeSingle();
    if (error) return Response.json({ error: error.message }, { status: 500 });
    if (!data) return Response.json({ error: "Project not found" }, { status: 404 });
    if (auth.clientOrgId && data.organization_id !== auth.clientOrgId) {
      return Response.json({ error: "Project not found" }, { status: 404 });
    }
    return Response.json({ project: data });
  }

  const vaAccess = searchParams.get("vaAccess") === "true";
  const projectId = searchParams.get("projectId");
  if (vaAccess && projectId) {
    const auth = await getUserAndRole();
    if ("error" in auth) return auth.error;
    if (auth.clientOrgId && (await projectOrg(supabase, projectId)) !== auth.clientOrgId) {
      return Response.json({ error: "Project not found" }, { status: 404 });
    }
    const { data, error } = await supabase
      .from("project_va_access")
      .select("va_id")
      .eq("project_id", projectId);
    if (error) return Response.json({ error: error.message }, { status: 500 });
    return Response.json({ va_ids: (data ?? []).map((row) => row.va_id) });
  }

  if (mine) {
    const authResult = await getUserAndRole();
    if ("error" in authResult) return authResult.error;
    const { user, isAdmin, clientOrgId } = authResult;

    // A client sees every project their org owns — and nothing else.
    if (clientOrgId) {
      let query = supabase
        .from("projects")
        .select("*")
        .eq("organization_id", clientOrgId)
        .order("sort_order", { ascending: true, nullsFirst: false })
        .order("created_at", { ascending: false });
      if (kind) query = query.eq("kind", kind);
      const { data, error } = await query;
      if (error) return Response.json({ error: error.message }, { status: 500 });
      return Response.json({ projects: data ?? [] });
    }

    if (isAdmin) {
      // The agency's own projects — a client org's projects belong to that
      // client and stay out of agency lists.
      let query = supabase
        .from("projects")
        .select("*")
        .is("organization_id", null)
        .order("sort_order", { ascending: true, nullsFirst: false })
        .order("created_at", { ascending: false });
      if (kind) query = query.eq("kind", kind);
      const { data, error } = await query;
      if (error) return Response.json({ error: error.message }, { status: 500 });
      return Response.json({ projects: data ?? [] });
    }

    const { data: accessRows, error: accessError } = await supabase
      .from("project_va_access")
      .select("project_id")
      .eq("va_id", user.id);
    if (accessError) return Response.json({ error: accessError.message }, { status: 500 });
    const accessIds = (accessRows ?? []).map((row) => row.project_id);

    let query = supabase
      .from("projects")
      .select("*")
      .or(
        accessIds.length > 0
          ? `created_by.eq.${user.id},id.in.(${accessIds.join(",")})`
          : `created_by.eq.${user.id}`
      )
      .order("sort_order", { ascending: true, nullsFirst: false })
      .order("created_at", { ascending: false });
    if (kind) query = query.eq("kind", kind);
    const { data, error } = await query;
    if (error) return Response.json({ error: error.message }, { status: 500 });
    return Response.json({ projects: data ?? [] });
  }

  const auth = await requireAdmin();
  if ("error" in auth) return auth.error;

  // Agency projects only — see the admin branch of ?mine above.
  let query = supabase.from("projects").select("*").is("organization_id", null).order("created_at", { ascending: false });
  if (kind) query = query.eq("kind", kind);
  const { data, error } = await query;
  if (error) return Response.json({ error: error.message }, { status: 500 });
  return Response.json({ projects: data ?? [] });
}

export async function POST(request: Request) {
  const auth = await getUserAndRole();
  if ("error" in auth) return auth.error;
  const { user, clientOrgId } = auth;
  const body = (await request.json()) as {
    name?: string;
    description?: string;
    account?: string;
    details?: string;
    notes?: string;
    va_ids?: string[];
    kind?: string;
    parent_project_id?: string | null;
    target_date?: string | null;
    start_date?: string | null;
    status?: string | null;
    linked_objective_id?: string | null;
  };
  if (!body.name?.trim()) return Response.json({ error: "name is required" }, { status: 400 });
  const kind = body.kind === "operation" ? "operation" : "objective";
  const supabase = serviceClient();
  if (clientOrgId) {
    const refError = await checkClientProjectRefs(supabase, clientOrgId, body);
    if (refError) return refError;
  }
  const { data, error } = await supabase.from("projects").insert({
    name: body.name.trim(),
    account: body.account?.trim() || null,
    description: body.description?.trim() || null,
    details: body.details?.trim() || null,
    notes: body.notes?.trim() || null,
    created_by: user.id,
    is_active: true,
    kind,
    parent_project_id: body.parent_project_id || null,
    target_date: body.target_date || null,
    start_date: body.start_date || null,
    status: body.status?.trim() || "active",
    linked_objective_id: body.linked_objective_id || null,
    // A client's project belongs to their org; everyone else's is the agency's.
    organization_id: clientOrgId,
  }).select("*").single();
  if (error) return Response.json({ error: error.message }, { status: 400 });

  if (Array.isArray(body.va_ids) && body.va_ids.length > 0) {
    await supabase.from("project_va_access").insert(
      body.va_ids.map((vaId) => ({ project_id: data.id, va_id: vaId }))
    );
  }

  return Response.json({ project: data }, { status: 201 });
}

export async function PATCH(request: Request) {
  const authResult = await getUserAndRole();
  if ("error" in authResult) return authResult.error;
  const { user, isAdmin, clientOrgId } = authResult;

  const { searchParams } = new URL(request.url);
  const id = searchParams.get("id");
  if (!id) return Response.json({ error: "id is required" }, { status: 400 });

  const supabase = serviceClient();

  // A client may edit any project their org owns — and only those.
  if (clientOrgId && (await projectOrg(supabase, id)) !== clientOrgId) {
    return Response.json({ error: "Project not found" }, { status: 404 });
  }

  if (!isAdmin && !clientOrgId) {
    const { data: project } = await supabase.from("projects").select("created_by").eq("id", id).maybeSingle();
    if (!project) return Response.json({ error: "Project not found" }, { status: 404 });
    // Anyone involved in the objective/operation can edit it — the creator or a
    // VA who's been given access (project_va_access) — not just the creator.
    if (project.created_by !== user.id) {
      const { data: access } = await supabase
        .from("project_va_access")
        .select("project_id")
        .eq("project_id", id)
        .eq("va_id", user.id)
        .maybeSingle();
      if (!access) return Response.json({ error: "Forbidden" }, { status: 403 });
    }
  }

  const body = (await request.json()) as {
    name?: string;
    description?: string;
    account?: string;
    details?: string;
    notes?: string;
    is_active?: boolean;
    va_ids?: string[];
    parent_project_id?: string | null;
    target_date?: string | null;
    start_date?: string | null;
    status?: string | null;
    linked_objective_id?: string | null;
  };
  if (clientOrgId) {
    const refError = await checkClientProjectRefs(supabase, clientOrgId, body);
    if (refError) return refError;
  }
  const updates: Record<string, unknown> = {};
  if (body.name !== undefined) updates.name = body.name.trim();
  if (body.account !== undefined) updates.account = body.account?.trim() || null;
  if (body.description !== undefined) updates.description = body.description?.trim() || null;
  if (body.details !== undefined) updates.details = body.details?.trim() || null;
  if (body.notes !== undefined) updates.notes = body.notes?.trim() || null;
  if (body.is_active !== undefined) updates.is_active = Boolean(body.is_active);
  if (body.parent_project_id !== undefined) {
    if (body.parent_project_id === id) {
      return Response.json({ error: "A project cannot be its own parent" }, { status: 400 });
    }
    if (body.parent_project_id) {
      // Walk up the proposed parent's own ancestor chain. If we hit `id`
      // along the way, the new parent is really a descendant of this
      // project — re-parenting under it would create a loop in the tree.
      // The UI already filters descendants out of its picker, but that's
      // not something the API should have to trust.
      const getParentId = async (projectId: string): Promise<string | null> => {
        const res = await supabase.from("projects").select("parent_project_id").eq("id", projectId).maybeSingle();
        return (res.data?.parent_project_id as string | null | undefined) ?? null;
      };
      let cursor: string | null = body.parent_project_id;
      let hops = 0;
      while (cursor && hops < 50) {
        if (cursor === id) {
          return Response.json(
            { error: "Cannot nest under one of its own sub-items — that would create a loop." },
            { status: 400 }
          );
        }
        cursor = await getParentId(cursor);
        hops++;
      }
    }
    updates.parent_project_id = body.parent_project_id || null;
  }
  if (body.target_date !== undefined) updates.target_date = body.target_date || null;
  if (body.start_date !== undefined) updates.start_date = body.start_date || null;
  if (body.status !== undefined) updates.status = body.status?.trim() || "active";
  if (body.linked_objective_id !== undefined) updates.linked_objective_id = body.linked_objective_id || null;
  const { data, error } = await supabase.from("projects").update(updates).eq("id", id).select("*").single();
  if (error) return Response.json({ error: error.message }, { status: 400 });

  if (Array.isArray(body.va_ids)) {
    await supabase.from("project_va_access").delete().eq("project_id", id);
    if (body.va_ids.length > 0) {
      await supabase.from("project_va_access").insert(
        body.va_ids.map((vaId) => ({ project_id: id, va_id: vaId }))
      );
    }
  }

  return Response.json({ project: data });
}

export async function DELETE(request: Request) {
  const authResult = await getUserAndRole();
  if ("error" in authResult) return authResult.error;
  const { user, isAdmin, clientOrgId } = authResult;

  const { searchParams } = new URL(request.url);
  const id = searchParams.get("id");
  if (!id) return Response.json({ error: "id is required" }, { status: 400 });

  const supabase = serviceClient();

  if (clientOrgId) {
    // A client may delete any project their org owns — and only those.
    if ((await projectOrg(supabase, id)) !== clientOrgId) {
      return Response.json({ error: "Project not found" }, { status: 404 });
    }
  } else if (!isAdmin) {
    const { data: project } = await supabase.from("projects").select("created_by").eq("id", id).maybeSingle();
    if (!project) return Response.json({ error: "Project not found" }, { status: 404 });
    if (project.created_by !== user.id) return Response.json({ error: "Forbidden" }, { status: 403 });
  }

  const { count: childCount } = await supabase
    .from("projects")
    .select("id", { count: "exact", head: true })
    .eq("parent_project_id", id);
  if (childCount && childCount > 0) {
    return Response.json(
      { error: `Cannot delete — ${childCount} sub-project(s) still nest under this one. Delete or move them first.` },
      { status: 400 }
    );
  }

  await supabase.from("assigned_tasks").update({ project_id: null }).eq("project_id", id);
  const { error } = await supabase.from("projects").delete().eq("id", id);
  if (error) return Response.json({ error: error.message }, { status: 400 });
  return Response.json({ success: true });
}
