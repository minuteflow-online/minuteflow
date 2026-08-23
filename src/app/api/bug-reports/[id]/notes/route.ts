import { createClient } from "@/lib/supabase/server";
import { canReviewBugReports } from "@/lib/financialAccess";
import { NextRequest } from "next/server";

export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ id: string }> };

/**
 * Notes on a bug report — a running thread either side can add to.
 *
 * A report used to be write-once: whoever filed it could not add the detail they
 * forgot, and the only reply channel was a single admin_notes field that the
 * reviewer overwrote each time. This is the conversation instead.
 *
 * Visibility follows the report: you can read and add notes on a report that is
 * yours, or on any report if you review them.
 */

/** Postgres "relation does not exist" — the notes table has not been created yet. */
const UNDEFINED_TABLE = "42P01";

async function loadContext(reportId: number) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Unauthorized" as const, status: 401 };

  const { data: profile } = await supabase
    .from("profiles")
    .select("role, department, full_name, username")
    .eq("id", user.id)
    .single();

  const { data: report } = await supabase
    .from("bug_reports")
    .select("id, user_id, status")
    .eq("id", reportId)
    .single();

  if (!report) return { error: "Report not found" as const, status: 404 };

  const allowed = report.user_id === user.id || canReviewBugReports(profile);
  if (!allowed) return { error: "Forbidden" as const, status: 403 };

  return { supabase, user, profile, report };
}

export async function GET(_request: NextRequest, { params }: RouteContext) {
  const { id } = await params;
  const ctx = await loadContext(Number(id));
  if ("error" in ctx) return Response.json({ error: ctx.error }, { status: ctx.status });

  const { data, error } = await ctx.supabase
    .from("bug_report_notes")
    .select("*")
    .eq("report_id", Number(id))
    .order("created_at", { ascending: true });

  if (error) {
    // Before the table exists the feature simply isn't there yet; callers render
    // nothing rather than showing an error on every report.
    if (error.code === UNDEFINED_TABLE) return Response.json({ notes: [], unavailable: true });
    return Response.json({ error: error.message }, { status: 500 });
  }

  return Response.json({ notes: data || [] });
}

export async function POST(request: NextRequest, { params }: RouteContext) {
  const { id } = await params;
  const ctx = await loadContext(Number(id));
  if ("error" in ctx) return Response.json({ error: ctx.error }, { status: ctx.status });

  const body = await request.json();
  const text = typeof body.body === "string" ? body.body.trim() : "";
  const driveFileIds: string[] = Array.isArray(body.drive_file_ids)
    ? body.drive_file_ids.filter((id: unknown): id is string => typeof id === "string")
    : [];
  // A note can be an image on its own — "here is what I mean" needs no caption.
  if (!text && driveFileIds.length === 0) {
    return Response.json({ error: "a note needs text or an attachment" }, { status: 400 });
  }

  const { data, error } = await ctx.supabase
    .from("bug_report_notes")
    .insert({
      report_id: Number(id),
      user_id: ctx.user.id,
      full_name: ctx.profile?.full_name || ctx.profile?.username || "",
      body: text,
      drive_file_ids: driveFileIds,
    })
    .select()
    .single();

  if (error) {
    if (error.code === UNDEFINED_TABLE) {
      return Response.json({ error: "Notes are not enabled yet" }, { status: 503 });
    }
    return Response.json({ error: error.message }, { status: 500 });
  }

  return Response.json({ note: data }, { status: 201 });
}


export async function DELETE(request: NextRequest, { params }: RouteContext) {
  const { id } = await params;
  const ctx = await loadContext(Number(id));
  if ("error" in ctx) return Response.json({ error: ctx.error }, { status: ctx.status });

  const noteId = new URL(request.url).searchParams.get("noteId");
  if (!noteId) return Response.json({ error: "noteId required" }, { status: 400 });

  // The thread is a record of what was decided once work starts, so notes can
  // only be taken back while the report is still Submitted. After that a note is
  // part of what the reviewer is working from and deleting it would rewrite the
  // history they are relying on.
  if (ctx.report.status !== "submitted") {
    return Response.json(
      { error: "This report is being worked on — notes can no longer be deleted." },
      { status: 409 }
    );
  }

  const { data: note } = await ctx.supabase
    .from("bug_report_notes")
    .select("user_id")
    .eq("id", Number(noteId))
    .single();
  if (!note) return Response.json({ error: "Note not found" }, { status: 404 });

  // Your own note, or anyone's if you review these.
  if (note.user_id !== ctx.user.id && !canReviewBugReports(ctx.profile)) {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }

  const { error } = await ctx.supabase
    .from("bug_report_notes")
    .delete()
    .eq("id", Number(noteId));

  if (error) return Response.json({ error: error.message }, { status: 500 });
  return Response.json({ ok: true });
}