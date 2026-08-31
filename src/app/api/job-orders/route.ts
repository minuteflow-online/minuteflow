import { createClient } from "@/lib/supabase/server";
import { serviceClient } from "@/lib/projectAccess";
import { hasBroadAdminAccess, isFounder } from "@/lib/financialAccess";
import { notifyOne } from "@/lib/notifyOne";
import { esc } from "@/lib/telegram";

export const dynamic = "force-dynamic";

// Columns returned to the client. `rate` is handled separately — it is stripped
// unless the caller is the Founder or the offeree (see stripRate below).
const SELECT =
  "id, title, type, linked_project_id, create_later, project, task_title, account, details, links, work_type, rate, time_frame, start_date, deadline, review_required, priority, offered_to, created_by, respond_by, status, decline_reason, accepted_task_id, accepted_at, created_at";

async function requireUser() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: Response.json({ error: "Unauthorized" }, { status: 401 }) };
  const { data: profile } = await supabase.from("profiles").select("role").eq("id", user.id).single();
  return { user, profile };
}

type OrderRow = { rate: number | null; offered_to: string; [k: string]: unknown };

// The money is Founder-controlled: only the Founder and the offeree may SEE a
// rate. Everyone else — including the admin who created the order — gets null.
function stripRate(row: OrderRow, userId: string, founder: boolean): OrderRow {
  if (founder || row.offered_to === userId) return row;
  return { ...row, rate: null };
}

/**
 * GET /api/job-orders
 * VAs see only orders offered to them. Admins see every order (oversight), but
 * the rate is redacted for anything that isn't theirs unless they're the
 * Founder. Newest first.
 */
export async function GET() {
  const auth = await requireUser();
  if ("error" in auth) return auth.error;
  const { user, profile } = auth;
  const admin = hasBroadAdminAccess(profile);
  const founder = isFounder(profile);

  const supabase = serviceClient();
  let query = supabase.from("job_orders").select(SELECT).order("created_at", { ascending: false });
  if (!admin) query = query.or(`offered_to.eq.${user.id},created_by.eq.${user.id}`);
  const { data, error } = await query;
  if (error) return Response.json({ error: error.message }, { status: 500 });

  const orders = (data ?? []).map((r) => stripRate(r as OrderRow, user.id, founder));
  return Response.json({ orders });
}

/**
 * POST /api/job-orders
 * Create + offer a job order. Admins may create; only the Founder may set the
 * rate — a non-Founder admin's `rate` is dropped server-side.
 */
export async function POST(request: Request) {
  const auth = await requireUser();
  if ("error" in auth) return auth.error;
  const { user, profile } = auth;
  if (!hasBroadAdminAccess(profile)) {
    return Response.json({ error: "Only admins can create job orders" }, { status: 403 });
  }
  const founder = isFounder(profile);

  const b = (await request.json()) as Record<string, unknown>;
  const title = typeof b.title === "string" ? b.title.trim() : "";
  const type = b.type;
  const workType = b.work_type;
  const offeredTo = b.offered_to;
  if (!title) return Response.json({ error: "title is required" }, { status: 400 });
  if (type !== "objective" && type !== "operation" && type !== "adhoc") {
    return Response.json({ error: "type must be objective, operation, or adhoc" }, { status: 400 });
  }
  if (workType !== "output" && workType !== "time") {
    return Response.json({ error: "work_type must be output or time" }, { status: 400 });
  }
  if (typeof offeredTo !== "string" || !offeredTo) {
    return Response.json({ error: "offered_to is required" }, { status: 400 });
  }

  const priority = ["low", "med", "high", "urgent"].includes(b.priority as string) ? b.priority : "med";
  const asText = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : null);
  const asNum = (v: unknown) => (typeof v === "number" && !Number.isNaN(v) ? v : null);

  const insert: Record<string, unknown> = {
    title,
    type,
    linked_project_id: asText(b.linked_project_id),
    create_later: Boolean(b.create_later),
    project: asText(b.project),
    task_title: asText(b.task_title),
    account: asText(b.account),
    details: asText(b.details),
    links: Array.isArray(b.links) ? (b.links as unknown[]).filter((l) => typeof l === "string" && l) : null,
    work_type: workType,
    time_frame: asText(b.time_frame),
    start_date: asText(b.start_date),
    deadline: asText(b.deadline),
    review_required: Boolean(b.review_required),
    priority,
    offered_to: offeredTo,
    created_by: user.id,
    respond_by: asText(b.respond_by),
    // Money is Founder-only: silently drop a rate from anyone else.
    rate: founder ? asNum(b.rate) : null,
  };

  const supabase = serviceClient();
  const { data, error } = await supabase.from("job_orders").insert(insert).select(SELECT).single();
  if (error) return Response.json({ error: error.message }, { status: 400 });

  // Ping the VA it's offered to — bell + Telegram.
  const p = profile as { full_name?: string | null; username?: string | null } | null;
  const fromName = p?.full_name || p?.username || "Someone";
  await notifyOne(supabase, {
    targetUserId: offeredTo,
    senderId: user.id,
    content: `${fromName} offered you a job order: “${title}”. Accept or decline it on the Assignment page.`,
    telegram: `📋 <b>New job order</b> from ${esc(fromName)}\n\n<b>${esc(title)}</b>\n\nAccept or decline it on the Assignment page.`,
    topic: "job_order",
  });

  return Response.json({ order: stripRate(data as OrderRow, user.id, founder) }, { status: 201 });
}
