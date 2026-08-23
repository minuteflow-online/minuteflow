import { createClient } from "@/lib/supabase/server";
import { hasBroadAdminAccess } from "@/lib/financialAccess";
import { NextRequest } from "next/server";
import { sendTelegram, telegramEnabled, esc } from "@/lib/telegram";

export const dynamic = "force-dynamic";

export async function GET() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const { data: profile } = await supabase
    .from("profiles")
    .select("role, department")
    .eq("id", user.id)
    .single();

  const isAdmin = hasBroadAdminAccess(profile);

  let query = supabase
    .from("bug_reports")
    .select("*")
    .order("created_at", { ascending: false });

  if (!isAdmin) {
    query = query.eq("user_id", user.id);
  }

  const { data, error } = await query;
  if (error) return Response.json({ error: error.message }, { status: 500 });

  return Response.json({ reports: data || [] });
}

export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const { data: profile } = await supabase
    .from("profiles")
    .select("username, full_name")
    .eq("id", user.id)
    .single();

  const body = await request.json();
  const { title, description, report_date, drive_file_ids, report_type } = body;

  if (!title?.trim() || !description?.trim()) {
    return Response.json({ error: "title and description are required" }, { status: 400 });
  }

  // One endpoint serves both — anything that isn't an explicit feature request
  // is a bug, which keeps older clients posting bugs exactly as before.
  const reportType = report_type === "feature" ? "feature" : "bug";

  const { data, error } = await supabase
    .from("bug_reports")
    .insert({
      user_id: user.id,
      username: profile?.username || "",
      full_name: profile?.full_name || "",
      report_type: reportType,
      title: title.trim(),
      description: description.trim(),
      report_date: report_date || new Date().toISOString().split("T")[0],
      status: "submitted",
      drive_file_ids: drive_file_ids || [],
    })
    .select()
    .single();

  if (error) return Response.json({ error: error.message }, { status: 500 });
  // Best-effort ping — the report is already saved, so a send failure is not
  // worth surfacing to the VA who filed it.
  if (telegramEnabled("bugs")) {
    const who = profile?.full_name || profile?.username || "Someone";
    const desc = description.trim();
    const heading = reportType === "feature" ? "💡 <b>Feature request</b>" : "🐞 <b>Bug report</b>";
    await sendTelegram(
      "bugs",
      [
        `${heading} from ${esc(who)}`,
        esc(title.trim()),
        "",
        esc(desc.length > 400 ? desc.slice(0, 400) + "…" : desc),
        "",
        "Review: https://minuteflow.click/admin",
      ].join("\n")
    );
  }

  return Response.json({ report: data }, { status: 201 });
}

export async function PATCH(request: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const { data: profile } = await supabase
    .from("profiles")
    .select("role, department")
    .eq("id", user.id)
    .single();

  const { searchParams } = new URL(request.url);
  const id = searchParams.get("id");
  if (!id) return Response.json({ error: "id required" }, { status: 400 });

  const { data: existing } = await supabase
    .from("bug_reports")
    .select("user_id, status")
    .eq("id", Number(id))
    .single();
  if (!existing) return Response.json({ error: "Report not found" }, { status: 404 });

  const isReviewer = hasBroadAdminAccess(profile);
  const isOwner = existing.user_id === user.id;

  const body = await request.json();
  const { status, admin_notes, archived, title, description, drive_file_ids } = body;

  const updates: Record<string, unknown> = {};

  // The person who filed a report can correct it, but only while nobody has
  // started on it. Once a reviewer moves it to testing the wording is what they
  // are testing against, so it freezes — anything further goes in the note
  // thread, which stays open to both sides for the life of the report.
  if (title !== undefined || description !== undefined || drive_file_ids !== undefined) {
    if (!isOwner && !isReviewer) {
      return Response.json({ error: "Forbidden" }, { status: 403 });
    }
    if (existing.status !== "submitted") {
      return Response.json(
        { error: "This report is already being worked on and can no longer be edited. Add a note instead." },
        { status: 409 }
      );
    }
    if (typeof title === "string") {
      if (!title.trim()) return Response.json({ error: "title cannot be empty" }, { status: 400 });
      updates.title = title.trim();
    }
    if (typeof description === "string") {
      if (!description.trim()) {
        return Response.json({ error: "description cannot be empty" }, { status: 400 });
      }
      updates.description = description.trim();
    }
    if (Array.isArray(drive_file_ids)) {
      updates.drive_file_ids = drive_file_ids.filter((f: unknown) => typeof f === "string");
    }
  }

  // Status, reviewer notes and archiving stay reviewer-only, whether or not the
  // caller happens to have filed the report themselves.
  if (status !== undefined || admin_notes !== undefined || archived !== undefined) {
    if (!isReviewer) return Response.json({ error: "Forbidden" }, { status: 403 });
  }

  if (Object.keys(updates).length === 0 && !isReviewer) {
    return Response.json({ error: "Nothing to update" }, { status: 400 });
  }

  if (status) updates.status = status;
  if (admin_notes !== undefined) updates.admin_notes = admin_notes;
  // Both endings count as reviewed: dismissing a request is a decision, not a
  // report left untouched.
  if (status === "fixed" || status === "dismissed") {
    updates.reviewed_at = new Date().toISOString();
  }
  // Archiving is separate from status — a fixed report and a dismissed one can
  // both be filed away, and either can come back out.
  if (archived !== undefined) {
    updates.archived_at = archived ? new Date().toISOString() : null;
  }

  const { data, error } = await supabase
    .from("bug_reports")
    .update(updates)
    .eq("id", Number(id))
    .select()
    .single();

  if (error) return Response.json({ error: error.message }, { status: 500 });
  return Response.json({ report: data });
}
