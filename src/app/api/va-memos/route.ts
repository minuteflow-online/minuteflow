import { createClient } from "@/lib/supabase/server";
import { createClient as createAdminClient } from "@supabase/supabase-js";

export const dynamic = "force-dynamic";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const RESEND_API_KEY = process.env.RESEND_API_KEY!;

async function sendMemoEmail(memo: { title: string; body: string; requires_confirmation: boolean }) {
  if (!RESEND_API_KEY) return;

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
          <span style="background: #f0ebe4; color: #8a6f5a; font-size: 11px; font-weight: 700; letter-spacing: 0.08em; text-transform: uppercase; padding: 4px 10px; border-radius: 100px;">Team Memo</span>
        </div>
        <h1 style="font-size: 22px; font-weight: 700; color: #2d1f14; margin: 0 0 16px;">${memo.title}</h1>
        <div style="font-size: 14px; color: #4a3728; line-height: 1.7; white-space: pre-wrap; margin: 0 0 20px;">${memo.body}</div>
        ${memo.requires_confirmation ? `
        <div style="background: #fef9ec; border: 1px solid #f5e6b8; border-radius: 8px; padding: 14px 16px; margin-top: 20px;">
          <p style="font-size: 13px; color: #8a6f2a; font-weight: 600; margin: 0 0 4px;">📋 Confirmation Required</p>
          <p style="font-size: 12px; color: #8a6f2a; margin: 0;">Please log into your MinuteFlow portal and confirm you've read this memo.</p>
        </div>` : ""}
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
      subject: `Team Memo: ${memo.title}`,
      html: htmlBody,
    }),
  });
}

/** GET: List memos */
export async function GET() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const { data: memos, error } = await supabase
    .from("va_memos")
    .select("*")
    .order("created_at", { ascending: false });
  if (error) return Response.json({ error: error.message }, { status: 500 });

  // Also return which memos this user has read
  const { data: reads } = await supabase
    .from("va_memo_reads")
    .select("memo_id")
    .eq("user_id", user.id);

  const readIds = new Set((reads || []).map((r) => r.memo_id));
  const result = (memos || []).map((m) => ({ ...m, read_by_me: readIds.has(m.id) }));

  // If admin, also attach read counts
  const { data: profile } = await supabase.from("profiles").select("role").eq("id", user.id).single();
  if (profile?.role === "admin" && memos && memos.length > 0) {
    const { data: allReads } = await supabase
      .from("va_memo_reads")
      .select("memo_id");
    const readCounts: Record<number, number> = {};
    (allReads || []).forEach((r) => {
      readCounts[r.memo_id] = (readCounts[r.memo_id] || 0) + 1;
    });
    return Response.json({
      memos: result.map((m) => ({ ...m, read_count: readCounts[m.id] || 0 })),
    });
  }

  return Response.json({ memos: result });
}

/** POST: Create memo (admin only, sends email) */
export async function POST(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const { data: profile } = await supabase.from("profiles").select("role").eq("id", user.id).single();
  if (profile?.role !== "admin") return Response.json({ error: "Forbidden" }, { status: 403 });

  const body = await request.json();
  const { title, body: memoBody, requires_confirmation } = body;
  if (!title?.trim() || !memoBody?.trim()) {
    return Response.json({ error: "title and body are required" }, { status: 400 });
  }

  const { data, error } = await supabase
    .from("va_memos")
    .insert({
      title: title.trim(),
      body: memoBody.trim(),
      requires_confirmation: requires_confirmation !== false,
      created_by: user.id,
    })
    .select()
    .single();

  if (error) return Response.json({ error: error.message }, { status: 500 });

  sendMemoEmail(data).catch(() => {});

  return Response.json({ memo: data }, { status: 201 });
}

/** PATCH: Update memo (admin only) */
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
  if (body.body !== undefined) fields.body = body.body;
  if (body.requires_confirmation !== undefined) fields.requires_confirmation = body.requires_confirmation;

  const { data, error } = await supabase.from("va_memos").update(fields).eq("id", id).select().single();
  if (error) return Response.json({ error: error.message }, { status: 500 });
  return Response.json({ memo: data });
}

/** DELETE: Delete memo (admin only) */
export async function DELETE(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const { data: profile } = await supabase.from("profiles").select("role").eq("id", user.id).single();
  if (profile?.role !== "admin") return Response.json({ error: "Forbidden" }, { status: 403 });

  const { searchParams } = new URL(request.url);
  const id = searchParams.get("id");
  if (!id) return Response.json({ error: "id required" }, { status: 400 });

  const { error } = await supabase.from("va_memos").delete().eq("id", id);
  if (error) return Response.json({ error: error.message }, { status: 500 });
  return Response.json({ success: true });
}
