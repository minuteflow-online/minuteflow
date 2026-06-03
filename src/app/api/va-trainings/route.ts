import { createClient } from "@/lib/supabase/server";
import { createClient as createAdminClient } from "@supabase/supabase-js";

export const dynamic = "force-dynamic";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const RESEND_API_KEY = process.env.RESEND_API_KEY!;

async function sendTrainingEmail(training: { title: string; description?: string | null; url?: string | null }) {
  if (!RESEND_API_KEY) return;

  // Get all VA emails
  const adminClient = createAdminClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const { data: authData } = await adminClient.auth.admin.listUsers({ perPage: 1000 });
  const emails = (authData?.users || []).map((u) => u.email).filter(Boolean) as string[];
  if (emails.length === 0) return;

  const htmlBody = `
    <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; max-width: 560px; margin: 0 auto; background: #faf9f7; padding: 32px 24px;">
      <div style="background: white; border-radius: 12px; border: 1px solid #e8e0d5; padding: 32px;">
        <div style="margin-bottom: 24px;">
          <span style="background: #f0ebe4; color: #8a6f5a; font-size: 11px; font-weight: 700; letter-spacing: 0.08em; text-transform: uppercase; padding: 4px 10px; border-radius: 100px;">New Training</span>
        </div>
        <h1 style="font-size: 22px; font-weight: 700; color: #2d1f14; margin: 0 0 12px;">${training.title}</h1>
        ${training.description ? `<p style="font-size: 14px; color: #6b5744; line-height: 1.6; margin: 0 0 20px;">${training.description}</p>` : ""}
        ${training.url ? `<a href="${training.url}" style="display: inline-block; background: #c2694f; color: white; text-decoration: none; font-size: 13px; font-weight: 600; padding: 10px 20px; border-radius: 8px;">Open Training →</a>` : ""}
        <div style="margin-top: 28px; padding-top: 20px; border-top: 1px solid #f0ebe4;">
          <p style="font-size: 11px; color: #9e9080; margin: 0;">MinuteFlow · noreply@minuteflow.click</p>
        </div>
      </div>
    </div>
  `;

  await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${RESEND_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      from: "MinuteFlow <noreply@minuteflow.click>",
      to: emails,
      subject: `New Training Available: ${training.title}`,
      html: htmlBody,
    }),
  });
}

/** GET: List trainings (all authenticated) */
export async function GET() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const { data: profile } = await supabase.from("profiles").select("role").eq("id", user.id).single();
  const isAdmin = profile?.role === "admin";

  let query = supabase.from("va_trainings").select("*").order("sort_order").order("created_at");
  if (!isAdmin) query = query.eq("is_active", true);

  const { data, error } = await query;
  if (error) return Response.json({ error: error.message }, { status: 500 });
  return Response.json({ trainings: data ?? [] });
}

/** POST: Create training (admin only, sends email) */
export async function POST(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const { data: profile } = await supabase.from("profiles").select("role").eq("id", user.id).single();
  if (profile?.role !== "admin") return Response.json({ error: "Forbidden" }, { status: 403 });

  const body = await request.json();
  const { title, description, url, category, sort_order, notify } = body;
  if (!title?.trim()) return Response.json({ error: "title is required" }, { status: 400 });

  const { data, error } = await supabase
    .from("va_trainings")
    .insert({
      title: title.trim(),
      description: description?.trim() || null,
      url: url?.trim() || null,
      category: category || "general",
      sort_order: sort_order ?? 0,
      created_by: user.id,
    })
    .select()
    .single();

  if (error) return Response.json({ error: error.message }, { status: 500 });

  // Send email notification if requested
  if (notify !== false) {
    sendTrainingEmail(data).catch(() => {});
  }

  return Response.json({ training: data }, { status: 201 });
}

/** PATCH: Update training (admin only) */
export async function PATCH(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const { data: profile } = await supabase.from("profiles").select("role").eq("id", user.id).single();
  if (profile?.role !== "admin") return Response.json({ error: "Forbidden" }, { status: 403 });

  const { searchParams } = new URL(request.url);
  const id = searchParams.get("id");
  if (!id) return Response.json({ error: "id required" }, { status: 400 });

  const body = await request.json();
  const fields: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (body.title !== undefined) fields.title = body.title;
  if (body.description !== undefined) fields.description = body.description;
  if (body.url !== undefined) fields.url = body.url;
  if (body.category !== undefined) fields.category = body.category;
  if (body.sort_order !== undefined) fields.sort_order = body.sort_order;
  if (body.is_active !== undefined) fields.is_active = body.is_active;

  const { data, error } = await supabase.from("va_trainings").update(fields).eq("id", id).select().single();
  if (error) return Response.json({ error: error.message }, { status: 500 });
  return Response.json({ training: data });
}

/** DELETE: Delete training (admin only) */
export async function DELETE(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const { data: profile } = await supabase.from("profiles").select("role").eq("id", user.id).single();
  if (profile?.role !== "admin") return Response.json({ error: "Forbidden" }, { status: 403 });

  const { searchParams } = new URL(request.url);
  const id = searchParams.get("id");
  if (!id) return Response.json({ error: "id required" }, { status: 400 });

  const { error } = await supabase.from("va_trainings").delete().eq("id", id);
  if (error) return Response.json({ error: error.message }, { status: 500 });
  return Response.json({ success: true });
}
