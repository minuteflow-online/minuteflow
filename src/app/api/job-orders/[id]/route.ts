import { createClient } from "@/lib/supabase/server";
import { serviceClient } from "@/lib/projectAccess";
import { hasBroadAdminAccess, isFounder } from "@/lib/financialAccess";
import { notifyOne } from "@/lib/notifyOne";
import { esc } from "@/lib/telegram";

export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ id: string }> };

async function requireUser() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: Response.json({ error: "Unauthorized" }, { status: 401 }) };
  const { data: profile } = await supabase.from("profiles").select("role").eq("id", user.id).single();
  return { user, profile };
}

/**
 * PATCH /api/job-orders/[id]
 * body: { action: "accept" | "decline" | "set_rate" | "cancel", ... }
 *  - accept  : offeree only. Materializes the order into a real subtask and
 *              flips status to accepted.
 *  - decline : offeree only. status → declined, with a reason, back to creator.
 *  - set_rate: Founder only. Attach/adjust the money.
 *  - cancel  : creator/admin. status → expired (pull a still-offered order).
 */
export async function PATCH(request: Request, { params }: RouteContext) {
  const auth = await requireUser();
  if ("error" in auth) return auth.error;
  const { user, profile } = auth;
  const { id } = await params;

  const supabase = serviceClient();
  const { data: order, error: readErr } = await supabase.from("job_orders").select("*").eq("id", id).maybeSingle();
  if (readErr) return Response.json({ error: readErr.message }, { status: 500 });
  if (!order) return Response.json({ error: "Job order not found" }, { status: 404 });

  const body = (await request.json()) as { action?: string; reason?: string; rate?: number; task_title?: string; project?: string; fields?: Record<string, unknown> };
  const action = body.action;

  // ── Creator/admin edits an open order ─────────────────────────────────────
  if (action === "edit") {
    const isOwnerOrAdmin = order.created_by === user.id || hasBroadAdminAccess(profile);
    if (!isOwnerOrAdmin) return Response.json({ error: "Forbidden" }, { status: 403 });
    if (order.status !== "offered") return Response.json({ error: "Only an offered order can be edited" }, { status: 409 });
    const f = body.fields ?? {};
    const allowed = ["title", "type", "linked_project_id", "create_later", "account", "details", "links", "work_type", "time_frame", "start_date", "deadline", "respond_by", "review_required", "priority", "offered_to"];
    const updates: Record<string, unknown> = { updated_at: new Date().toISOString() };
    for (const k of allowed) if (k in f) updates[k] = f[k];
    // The rate is Founder-only, even on edit.
    if ("rate" in f && isFounder(profile)) updates.rate = typeof f.rate === "number" ? f.rate : null;
    const { data, error } = await supabase.from("job_orders").update(updates).eq("id", id).select("*").single();
    if (error) return Response.json({ error: error.message }, { status: 400 });
    return Response.json({ ok: true, order: data });
  }

  // ── Founder sets the money ────────────────────────────────────────────────
  if (action === "set_rate") {
    if (!isFounder(profile)) return Response.json({ error: "Only the Founder can set the rate" }, { status: 403 });
    const rate = typeof body.rate === "number" && !Number.isNaN(body.rate) ? body.rate : null;
    const { error } = await supabase.from("job_orders").update({ rate, updated_at: new Date().toISOString() }).eq("id", id);
    if (error) return Response.json({ error: error.message }, { status: 400 });
    return Response.json({ ok: true });
  }

  // ── Creator/admin pulls a still-open offer ────────────────────────────────
  if (action === "cancel") {
    const isOwnerOrAdmin = order.created_by === user.id || hasBroadAdminAccess(profile);
    if (!isOwnerOrAdmin) return Response.json({ error: "Forbidden" }, { status: 403 });
    if (order.status !== "offered") return Response.json({ error: "Only an offered order can be cancelled" }, { status: 409 });
    const { error } = await supabase.from("job_orders").update({ status: "expired", updated_at: new Date().toISOString() }).eq("id", id);
    if (error) return Response.json({ error: error.message }, { status: 400 });
    return Response.json({ ok: true });
  }

  // ── Accept / Decline — the offeree only ───────────────────────────────────
  if (action === "accept" || action === "decline") {
    if (order.offered_to !== user.id) {
      return Response.json({ error: "This order isn't offered to you" }, { status: 403 });
    }
    if (order.status !== "offered") {
      return Response.json({ error: `This order is already ${order.status}` }, { status: 409 });
    }

    const p = profile as { full_name?: string | null; username?: string | null } | null;
    const vaName = p?.full_name || p?.username || "A VA";

    if (action === "decline") {
      const reason = typeof body.reason === "string" ? body.reason.trim() : "";
      const { error } = await supabase
        .from("job_orders")
        .update({ status: "declined", decline_reason: reason || null, updated_at: new Date().toISOString() })
        .eq("id", id);
      if (error) return Response.json({ error: error.message }, { status: 400 });
      await notifyOne(supabase, {
        targetUserId: order.created_by,
        senderId: user.id,
        content: `${vaName} declined your job order “${order.title}”${reason ? `: ${reason}` : ""}.`,
        telegram: `↩️ <b>${esc(vaName)}</b> declined your job order\n\n<b>${esc(order.title)}</b>${reason ? `\n\nReason: ${esc(reason)}` : ""}`,
        topic: "job_order",
      });
      return Response.json({ ok: true });
    }

    // accept → create the subtask. The VA supplies the task title (and project)
    // as they take it on. A "create later" order is created unlinked for now —
    // it lands in their task list to attach to the node they create.
    const vaTaskTitle = typeof body.task_title === "string" && body.task_title.trim() ? body.task_title.trim() : null;
    const vaProject = typeof body.project === "string" && body.project.trim() ? body.project.trim() : null;
    const projectId = order.create_later ? null : (order.linked_project_id ?? null);
    const { data: task, error: taskErr } = await supabase
      .from("assigned_tasks")
      .insert({
        task_name: vaTaskTitle || order.title,
        task_detail: order.title, // the client-memo entry
        account: order.account,
        project: vaProject || order.project,
        project_id: projectId,
        due_date: order.deadline,
        start_date: order.start_date,
        status: "pending",
        review_required: order.review_required,
        review_required_locked: true,
        category: "Task",
        created_by: order.created_by,
        assigned_by: order.created_by,
      })
      .select("id")
      .single();
    if (taskErr) return Response.json({ error: taskErr.message }, { status: 400 });

    const { error: assignErr } = await supabase
      .from("assigned_task_assignees")
      .insert({ assigned_task_id: task.id, va_id: order.offered_to });
    if (assignErr) return Response.json({ error: assignErr.message }, { status: 400 });

    const { error: updErr } = await supabase
      .from("job_orders")
      .update({ status: "accepted", accepted_task_id: task.id, accepted_at: new Date().toISOString(), updated_at: new Date().toISOString() })
      .eq("id", id);
    if (updErr) return Response.json({ error: updErr.message }, { status: 400 });

    await notifyOne(supabase, {
      targetUserId: order.created_by,
      senderId: user.id,
      content: `${vaName} accepted your job order “${order.title}” — it's now a task on their list.`,
      telegram: `✅ <b>${esc(vaName)}</b> accepted your job order\n\n<b>${esc(order.title)}</b>`,
      topic: "job_order",
    });

    return Response.json({ ok: true, task_id: task.id, pending_setup: order.create_later });
  }

  return Response.json({ error: "Unknown action" }, { status: 400 });
}
