import { requireClientOrgVaIds, serviceClient, isResponse } from "@/lib/clientAdminAccess";

export const dynamic = "force-dynamic";

/**
 * Private notes a client's org keeps about one of its VAs
 * (organization_member_notes — no RLS policies, so only these routes reach
 * it). The VA and the agency never see them.
 *
 * GET    ?vaId=  → that VA's notes from this org, newest first
 * POST   { vaId, body }
 * DELETE { noteId } → the note's author, or the org's owner
 */

export async function GET(request: Request) {
  const auth = await requireClientOrgVaIds();
  if (isResponse(auth)) return auth;
  const { organizationId } = auth;

  const vaId = new URL(request.url).searchParams.get("vaId");
  if (!vaId) return Response.json({ error: "vaId is required" }, { status: 400 });

  const admin = serviceClient();
  const { data, error } = await admin
    .from("organization_member_notes")
    .select("id, body, created_at, author_id")
    .eq("organization_id", organizationId)
    .eq("va_id", vaId)
    .order("created_at", { ascending: false });
  if (error) return Response.json({ error: error.message }, { status: 500 });

  const authorIds = Array.from(new Set((data ?? []).map((n) => n.author_id).filter(Boolean))) as string[];
  const { data: authors } = authorIds.length
    ? await admin.from("profiles").select("id, full_name, username").in("id", authorIds)
    : { data: [] as Array<{ id: string; full_name: string | null; username: string | null }> };
  const nameById = new Map((authors ?? []).map((a) => [a.id, a.full_name || a.username || "Unknown"]));

  return Response.json({
    notes: (data ?? []).map((n) => ({
      id: n.id as number,
      body: n.body as string,
      createdAt: n.created_at as string,
      authorId: (n.author_id as string | null) ?? null,
      authorName: n.author_id ? nameById.get(n.author_id as string) ?? "Unknown" : "Removed user",
    })),
  });
}

export async function POST(request: Request) {
  const auth = await requireClientOrgVaIds();
  if (isResponse(auth)) return auth;
  const { organizationId, vaIds, userId } = auth;

  const { vaId, body } = ((await request.json().catch(() => null)) ?? {}) as { vaId?: unknown; body?: unknown };
  const text = typeof body === "string" ? body.trim() : "";
  if (typeof vaId !== "string" || !text) {
    return Response.json({ error: "vaId and a note are required" }, { status: 400 });
  }
  if (text.length > 5000) {
    return Response.json({ error: "Keep notes under 5,000 characters." }, { status: 400 });
  }
  if (!vaIds.includes(vaId)) {
    return Response.json({ error: "That VA isn't on your team." }, { status: 403 });
  }

  const admin = serviceClient();
  const { error } = await admin.from("organization_member_notes").insert({
    organization_id: organizationId,
    va_id: vaId,
    author_id: userId,
    body: text,
  });
  if (error) return Response.json({ error: error.message }, { status: 500 });
  return Response.json({ success: true });
}

export async function DELETE(request: Request) {
  const auth = await requireClientOrgVaIds();
  if (isResponse(auth)) return auth;
  const { organizationId, userId, isOwner } = auth;

  const { noteId } = ((await request.json().catch(() => null)) ?? {}) as { noteId?: unknown };
  if (typeof noteId !== "number") return Response.json({ error: "noteId is required" }, { status: 400 });

  const admin = serviceClient();
  let query = admin
    .from("organization_member_notes")
    .delete()
    .eq("id", noteId)
    .eq("organization_id", organizationId);
  if (!isOwner) query = query.eq("author_id", userId);
  const { data: removed, error } = await query.select("id");
  if (error) return Response.json({ error: error.message }, { status: 500 });
  if (!removed?.length) {
    return Response.json({ error: "You can only delete your own notes." }, { status: 403 });
  }
  return Response.json({ success: true });
}
