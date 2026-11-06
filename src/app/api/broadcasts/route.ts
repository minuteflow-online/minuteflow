import { createClient } from "@/lib/supabase/server";
import { after } from "next/server";
import { sendResendEmail } from "@/lib/sendEmail";
import { createClient as createAdminClient } from "@supabase/supabase-js";
import { hasBroadAdminAccess } from "@/lib/financialAccess";
import { injectMagicWordHtml, isRichHtml, plainToHtml, renderBroadcastHtml, sanitizeRichHtml } from "@/lib/richText";
import { isAudience, isRecipient, broadcastPortalPath, followUpTitle, type RecipientRow } from "@/lib/broadcasts";
import { notifyVaPrivately } from "@/lib/vaNotify";
import { esc } from "@/lib/telegram";

export const dynamic = "force-dynamic";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const RESEND_API_KEY = process.env.RESEND_API_KEY!;

type Profile = {
  id: string;
  role: string;
  employment_type: string | null;
  position: string | null;
  pay_rate_type: string | null;
  is_active: boolean;
  full_name: string | null;
};

type BroadcastRecipient = {
  id: string;
  broadcast_id: string;
  recipient_type: string;
  recipient_value: string;
  created_at: string;
};

/**
 * Inject the magic word into the latter 40% of the body (split by newlines).
 * Returns the modified body string.
 */
function injectMagicWord(body: string, magicWord: string): string {
  const lines = body.split("\n");
  const total = lines.length;

  if (total === 0) {
    return body + `\n\nMagic word: [${magicWord}]`;
  }

  // Latter 40% = indices from Math.floor(total * 0.6) to total - 1
  const startIndex = Math.floor(total * 0.6);
  // Pick a random insertion point within the latter 40%
  const range = total - startIndex;
  const insertAt = range > 0 ? startIndex + Math.floor(Math.random() * range) : startIndex;

  const injectedLine = `Magic word: [${magicWord}]`;
  lines.splice(insertAt, 0, injectedLine);
  return lines.join("\n");
}

/** Same normalization bug-reports' tags use (src/app/api/bug-reports/route.ts) — trimmed, lowercased, deduped, capped. */
function normalizeTags(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const cleaned = value
    .filter((t): t is string => typeof t === "string")
    .map((t) => t.trim().toLowerCase())
    .filter(Boolean)
    .slice(0, 10);
  return Array.from(new Set(cleaned));
}

/**
 * Build a category label for use in email subjects.
 */
function categoryLabel(category: string): string {
  if (category === "memo") return "Memo";
  if (category === "training") return "Training";
  if (category === "coaching_notes") return "Coaching Notes";
  return category.charAt(0).toUpperCase() + category.slice(1);
}

/**
 * Build the HTML email body for a broadcast.
 */
function buildEmailHtml(broadcast: {
  title: string;
  body: string;
  category: string;
  magic_word?: string | null;
  require_word?: boolean;
  parent_id?: string | null;
}): string {
  // Inject magic word into the displayed body if present.
  // Plain-text bodies use the line-based injection; rich (HTML) bodies inject at a block boundary.
  const displayBody = !broadcast.magic_word
    ? renderBroadcastHtml(broadcast.body)
    : isRichHtml(broadcast.body)
    ? injectMagicWordHtml(renderBroadcastHtml(broadcast.body), `Magic word: [${broadcast.magic_word}]`, (n) => Math.floor(Math.random() * n))
    : sanitizeRichHtml(plainToHtml(injectMagicWord(broadcast.body, broadcast.magic_word)));

  const label = categoryLabel(broadcast.category);

  return `
    <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; max-width: 560px; margin: 0 auto; background: #faf9f7; padding: 32px 24px;">
      <div style="background: white; border-radius: 12px; border: 1px solid #e8e0d5; padding: 32px;">
        <div style="margin-bottom: 24px;">
          <span style="background: #f0ebe4; color: #8a6f5a; font-size: 11px; font-weight: 700; letter-spacing: 0.08em; text-transform: uppercase; padding: 4px 10px; border-radius: 100px;">${label}</span>
        </div>
        <h1 style="font-size: 22px; font-weight: 700; color: #2d1f14; margin: 0 0 16px;">${broadcast.title}</h1>
        ${broadcast.parent_id ? `<p style="font-size: 12px; color: #8a6f5a; margin: 0 0 16px;">This is an update to an earlier ${label.toLowerCase()} — only what's new is below.</p>` : ""}
        <div style="font-size: 14px; color: #4a3728; line-height: 1.7; margin: 0 0 20px;">${displayBody}</div>
        ${broadcast.require_word ? `
        <div style="background: #fef9ec; border: 1px solid #f5e6b8; border-radius: 8px; padding: 14px 16px; margin-top: 20px;">
          <p style="font-size: 13px; color: #8a6f2a; font-weight: 600; margin: 0 0 4px;">Magic Word Required</p>
          <p style="font-size: 12px; color: #8a6f2a; margin: 0;">A magic word is hidden in this message. Enter it in your MinuteFlow portal to confirm you've read this.</p>
        </div>` : ""}
        <div style="margin-top: 28px; padding-top: 20px; border-top: 1px solid #f0ebe4;">
          <p style="font-size: 13px; color: #4a3728; margin: 0 0 8px;">Log into your MinuteFlow portal to acknowledge this.</p>
          <p style="font-size: 11px; color: #9e9080; margin: 0;">MinuteFlow · noreply@minuteflow.click</p>
        </div>
      </div>
    </div>
  `;
}

/**
 * Given a broadcast's recipients config and all active profiles + auth users,
 * return the list of email addresses that should receive the email.
 */
function resolveTargetEmails(
  recipients: RecipientRow[],
  profiles: Profile[],
  authUserMap: Map<string, string>,
  authorId: string | null | undefined
): string[] {
  const emails: string[] = [];
  profiles
    .filter((p) => isAudience(recipients, p, authorId))
    .forEach((p) => {
      const email = authUserMap.get(p.id);
      if (email) emails.push(email);
    });
  return emails;
}

/**
 * Send broadcast email to matched users.
 */
async function sendBroadcastEmail(
  broadcast: {
    id: string;
    title: string;
    body: string;
    category: string;
    magic_word?: string | null;
    require_word?: boolean;
    created_by?: string | null;
    parent_id?: string | null;
  },
  recipientRows: RecipientRow[]
): Promise<void> {
  if (!RESEND_API_KEY) return;

  const adminClient = createAdminClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  // Fetch active profiles
  const { data: profiles } = await adminClient
    .from("profiles")
    .select("id, role, employment_type, position, pay_rate_type, is_active, full_name")
    .eq("is_active", true);

  if (!profiles || profiles.length === 0) return;

  // Fetch auth users to get emails
  const { data: authData } = await adminClient.auth.admin.listUsers({ perPage: 1000 });
  const authUserMap = new Map<string, string>();
  (authData?.users || []).forEach((u) => {
    if (u.email) authUserMap.set(u.id, u.email);
  });

  const emails = resolveTargetEmails(recipientRows, profiles, authUserMap, broadcast.created_by);
  if (emails.length === 0) return;

  const label = categoryLabel(broadcast.category);
  const subject = `${label}: ${broadcast.title}`;
  const htmlBody = buildEmailHtml(broadcast);

  const res = await sendResendEmail({
    method: "POST",
    headers: {
      Authorization: `Bearer ${RESEND_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: "Toni Colina <noreply@minuteflow.click>",
      to: emails,
      subject,
      html: htmlBody,
      open_tracking: true,
      click_tracking: true,
    }),
  });

  // Store resend message ID on the broadcast for tracking
  if (res.ok) {
    try {
      const data = await res.json() as { id?: string };
      if (data.id) {
        await adminClient
          .from("broadcasts")
          .update({ resend_message_id: data.id })
          .eq("id", broadcast.id);
      }
    } catch { /* non-fatal */ }
  }
}

/**
 * Private Telegram DM to each active recipient with a link to the broadcast.
 * Sent even to someone on a break or personal time — broadcasts always go out.
 */
async function sendBroadcastTelegram(
  broadcast: {
    id: string;
    title: string;
    category: string;
    require_word?: boolean;
    created_by?: string | null;
    parent_id?: string | null;
  },
  recipientRows: RecipientRow[]
): Promise<void> {
  const adminClient = createAdminClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const { data: profiles } = await adminClient
    .from("profiles")
    .select("id, role, employment_type, position, pay_rate_type, is_active, full_name, username, telegram_chat_id")
    .eq("is_active", true);

  const path = broadcastPortalPath(broadcast.category, broadcast.id);
  const link = `https://minuteflow.click${path ?? "/portal"}`;
  const kind = esc(categoryLabel(broadcast.category).toLowerCase());
  const message = [
    broadcast.parent_id
      ? `🔁 <b>${esc(broadcast.title)}</b>\n\nThere's an update to an earlier ${kind} — only the new part to read.`
      : `📣 <b>New ${kind}: ${esc(broadcast.title)}</b>`,
    "",
    broadcast.require_word
      ? "Please read it and enter the magic word to acknowledge it."
      : "Please read it and acknowledge it.",
    link,
  ].join("\n");

  for (const p of (profiles || []).filter((p) => isAudience(recipientRows, p, broadcast.created_by))) {
    await notifyVaPrivately({
      chatId: p.telegram_chat_id,
      vaName: p.full_name || p.username || "there",
      topic: "Broadcast",
      message,
    });
  }
}

/** Email plus Telegram for a newly saved published broadcast. Either failing leaves the other alone. */
async function sendBroadcastNotices(
  broadcast: Parameters<typeof sendBroadcastEmail>[0],
  recipientRows: RecipientRow[]
): Promise<void> {
  await Promise.all([
    sendBroadcastEmail(broadcast, recipientRows).catch(() => {}),
    sendBroadcastTelegram(broadcast, recipientRows).catch(() => {}),
  ]);
}

/** GET: List broadcasts visible to the current user */
export async function GET(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const { data: profile } = await supabase
    .from("profiles")
    .select("role, employment_type, position, pay_rate_type, department, is_active")
    .eq("id", user.id)
    .single();

  if (!profile) return Response.json({ error: "Profile not found" }, { status: 404 });

  if (hasBroadAdminAccess(profile)) {
    // Admin: return ALL broadcasts with read counts and recipients
    const { data: broadcasts, error } = await supabase
      .from("broadcasts")
      .select("*")
      .order("created_at", { ascending: false });

    if (error) return Response.json({ error: error.message }, { status: 500 });

    if (!broadcasts || broadcasts.length === 0) {
      return Response.json({ broadcasts: [] });
    }

    const broadcastIds = broadcasts.map((b) => b.id);

    // Fetch read records for all broadcasts
    const { data: allReads } = await supabase
      .from("broadcast_reads")
      .select("broadcast_id, user_id, confirmed, read_at")
      .in("broadcast_id", broadcastIds);

    const readCounts: Record<string, number> = {};
    (allReads || []).forEach((r) => {
      readCounts[r.broadcast_id] = (readCounts[r.broadcast_id] || 0) + 1;
    });

    // Team members, to list who has and hasn't acknowledged each broadcast
    const adminClient = createAdminClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    const { data: members } = await adminClient
      .from("profiles")
      .select("id, role, employment_type, position, pay_rate_type, is_active, full_name");
    const memberList: Profile[] = members || [];
    const memberName = new Map(memberList.map((m) => [m.id, m.full_name || "Unknown"]));

    // Fetch my own read records
    const { data: myReads } = await supabase
      .from("broadcast_reads")
      .select("broadcast_id, word_entered, confirmed")
      .eq("user_id", user.id)
      .in("broadcast_id", broadcastIds);

    const myReadMap = new Map<string, { word_entered: string | null; confirmed: boolean }>();
    (myReads || []).forEach((r) => {
      myReadMap.set(r.broadcast_id, { word_entered: r.word_entered, confirmed: r.confirmed });
    });

    // Fetch recipients for all broadcasts
    const { data: allRecipients } = await supabase
      .from("broadcast_recipients")
      .select("*")
      .in("broadcast_id", broadcastIds);

    const recipientsByBroadcast: Record<string, BroadcastRecipient[]> = {};
    (allRecipients || []).forEach((r) => {
      if (!recipientsByBroadcast[r.broadcast_id]) {
        recipientsByBroadcast[r.broadcast_id] = [];
      }
      recipientsByBroadcast[r.broadcast_id].push(r);
    });

    const result = broadcasts.map((b) => {
      const myRead = myReadMap.get(b.id);
      const rows: RecipientRow[] = (recipientsByBroadcast[b.id] || []).map((r) => ({
        type: r.recipient_type,
        value: r.recipient_value,
      }));
      const reads = (allReads || []).filter((r) => r.broadcast_id === b.id);
      const readIds = new Set(reads.map((r) => r.user_id));
      const acknowledged = reads
        .map((r) => ({ user_id: r.user_id, name: memberName.get(r.user_id) || "Unknown", read_at: r.read_at }))
        .sort((x, y) => x.name.localeCompare(y.name));
      const pending = memberList
        .filter((m) => m.is_active && isAudience(rows, m, b.created_by) && !readIds.has(m.id))
        .map((m) => ({ user_id: m.id, name: m.full_name || "Unknown" }))
        .sort((x, y) => x.name.localeCompare(y.name));
      return {
        ...b,
        read_count: readCounts[b.id] || 0,
        acknowledged,
        pending,
        confirmed_by_me: myRead?.confirmed ?? false,
        word_entered_by_me: myRead?.word_entered ?? null,
        recipients: recipientsByBroadcast[b.id] || [],
        // No "ask the author" button on your own broadcast
        author_name: b.created_by && b.created_by !== user.id ? memberName.get(b.created_by) ?? null : null,
      };
    });

    return Response.json({ broadcasts: result });
  }

  // VA: return published broadcasts AND scheduled broadcasts whose scheduled_at <= now
  const now = new Date().toISOString();
  const { data: allPublished, error } = await supabase
    .from("broadcasts")
    .select("*")
    .or(`status.eq.published,and(status.eq.scheduled,scheduled_at.lte.${now})`)
    .order("created_at", { ascending: false });

  if (error) return Response.json({ error: error.message }, { status: 500 });
  if (!allPublished || allPublished.length === 0) {
    return Response.json({ broadcasts: [] });
  }

  const publishedIds = allPublished.map((b) => b.id);

  // Fetch all recipients for published broadcasts
  const { data: allRecipients } = await supabase
    .from("broadcast_recipients")
    .select("*")
    .in("broadcast_id", publishedIds);

  // Determine which broadcasts the user is a recipient of
  const recipientsByBroadcast: Record<string, BroadcastRecipient[]> = {};
  (allRecipients || []).forEach((r) => {
    if (!recipientsByBroadcast[r.broadcast_id]) {
      recipientsByBroadcast[r.broadcast_id] = [];
    }
    recipientsByBroadcast[r.broadcast_id].push(r);
  });

  const me = {
    id: user.id,
    role: profile.role,
    employment_type: profile.employment_type,
    position: profile.position,
    pay_rate_type: profile.pay_rate_type,
    is_active: profile.is_active !== false,
  };
  const visibleBroadcasts = allPublished.filter((b) =>
    isRecipient(
      (recipientsByBroadcast[b.id] || []).map((r) => ({ type: r.recipient_type, value: r.recipient_value })),
      me
    )
  );

  if (visibleBroadcasts.length === 0) {
    return Response.json({ broadcasts: [] });
  }

  const visibleIds = visibleBroadcasts.map((b) => b.id);

  // Fetch my read records for visible broadcasts
  const { data: myReads } = await supabase
    .from("broadcast_reads")
    .select("broadcast_id, word_entered, confirmed")
    .eq("user_id", user.id)
    .in("broadcast_id", visibleIds);

  const myReadMap = new Map<string, { word_entered: string | null; confirmed: boolean }>();
  (myReads || []).forEach((r) => {
    myReadMap.set(r.broadcast_id, { word_entered: r.word_entered, confirmed: r.confirmed });
  });

  // Authors' names, for the "Ask <author> a question" button on each broadcast
  const authorIds = Array.from(new Set(visibleBroadcasts.map((b) => b.created_by).filter(Boolean))) as string[];
  const authorName = new Map<string, string>();
  if (authorIds.length) {
    const adminClient = createAdminClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    const { data: authors } = await adminClient
      .from("profiles")
      .select("id, full_name, username, is_active")
      .in("id", authorIds);
    // An author who has left can't answer, so they get no button.
    (authors || [])
      .filter((a) => a.is_active !== false)
      .forEach((a) => authorName.set(a.id, a.full_name || a.username || "the author"));
  }

  const result = visibleBroadcasts.map((b) => {
    const myRead = myReadMap.get(b.id);
    return {
      ...b,
      confirmed_by_me: myRead?.confirmed ?? false,
      word_entered_by_me: myRead?.word_entered ?? null,
      recipients: recipientsByBroadcast[b.id] || [],
      author_name: b.created_by ? authorName.get(b.created_by) ?? null : null,
    };
  });

  return Response.json({ broadcasts: result });
}

/** POST: Create a broadcast (admin only) */
export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const { data: profile } = await supabase
    .from("profiles")
    .select("role, department")
    .eq("id", user.id)
    .single();
  if (!hasBroadAdminAccess(profile)) return Response.json({ error: "Forbidden" }, { status: 403 });

  const body = await request.json();

  // A follow-up: a short update posted on an earlier published broadcast. It goes to
  // the same people, is acknowledged on its own, and leaves their acknowledgement of
  // the original alone, so they only read what's new.
  if (body.parent_id) {
    const followUpBody = typeof body.body === "string" ? body.body.trim() : "";
    if (!followUpBody) return Response.json({ error: "body is required" }, { status: 400 });

    const { data: parent } = await supabase
      .from("broadcasts")
      .select("id, title, category, status, tags, parent_id")
      .eq("id", body.parent_id)
      .single();
    if (!parent) return Response.json({ error: "Original broadcast not found" }, { status: 404 });
    if (parent.parent_id) {
      return Response.json({ error: "Post the follow-up on the original, not on another follow-up" }, { status: 400 });
    }
    if (parent.status !== "published") {
      return Response.json({ error: "Only a published broadcast can get a follow-up" }, { status: 400 });
    }

    const { data: parentRecipients } = await supabase
      .from("broadcast_recipients")
      .select("recipient_type, recipient_value")
      .eq("broadcast_id", parent.id);
    const rows: RecipientRow[] = (parentRecipients || []).map((r) => ({
      type: r.recipient_type,
      value: r.recipient_value,
    }));
    if (rows.length === 0) return Response.json({ error: "The original has no recipients" }, { status: 400 });

    const { data: followUp, error: followUpError } = await supabase
      .from("broadcasts")
      .insert({
        title: followUpTitle(parent.title),
        body: followUpBody,
        category: parent.category,
        magic_word: null,
        require_word: false,
        status: "published",
        created_by: user.id,
        tags: parent.tags ?? [],
        parent_id: parent.id,
      })
      .select()
      .single();
    if (followUpError) return Response.json({ error: followUpError.message }, { status: 500 });

    const { error: rowsError } = await supabase.from("broadcast_recipients").insert(
      rows.map((r) => ({ broadcast_id: followUp.id, recipient_type: r.type, recipient_value: r.value }))
    );
    if (rowsError) {
      await supabase.from("broadcasts").delete().eq("id", followUp.id);
      return Response.json({ error: rowsError.message }, { status: 500 });
    }

    after(() => sendBroadcastNotices(followUp, rows));
    return Response.json({ broadcast: followUp }, { status: 201 });
  }

  const {
    title,
    body: broadcastBody,
    category,
    magic_word,
    require_word,
    status,
    recipients,
    scheduled_at,
    link,
    image_url,
    sort_order,
    tags,
  } = body;

  if (!title?.trim()) return Response.json({ error: "title is required" }, { status: 400 });
  if (!broadcastBody?.trim()) return Response.json({ error: "body is required" }, { status: 400 });
  if (!category) return Response.json({ error: "category is required" }, { status: 400 });
  if (!Array.isArray(recipients) || recipients.length === 0) {
    return Response.json({ error: "recipients is required and must be a non-empty array" }, { status: 400 });
  }

  const { data: broadcast, error: broadcastError } = await supabase
    .from("broadcasts")
    .insert({
      title: title.trim(),
      body: broadcastBody.trim(),
      category,
      magic_word: magic_word?.trim() || null,
      require_word: require_word === true,
      status: status || "draft",
      created_by: user.id,
      scheduled_at: scheduled_at || null,
      link: link?.trim() || null,
      image_url: image_url?.trim() || null,
      sort_order: typeof sort_order === "number" ? sort_order : 0,
      tags: normalizeTags(tags),
    })
    .select()
    .single();

  if (broadcastError) return Response.json({ error: broadcastError.message }, { status: 500 });

  // Insert recipient rows
  const recipientInserts = recipients.map((r: { type: string; value: string }) => ({
    broadcast_id: broadcast.id,
    recipient_type: r.type,
    recipient_value: r.value,
  }));

  const { error: recipientError } = await supabase
    .from("broadcast_recipients")
    .insert(recipientInserts);

  if (recipientError) {
    // Clean up the broadcast if recipients failed
    await supabase.from("broadcasts").delete().eq("id", broadcast.id);
    return Response.json({ error: recipientError.message }, { status: 500 });
  }

  // Send email if publishing now
  if (broadcast.status === "published") {
    const recipientRows: RecipientRow[] = recipients.map((r: { type: string; value: string }) => ({
      type: r.type,
      value: r.value,
    }));
    // after() keeps the function alive until the send finishes; started and left,
    // the send can be cut off once the reply goes out and no one gets the email.
    after(() => sendBroadcastNotices(broadcast, recipientRows));
  }

  return Response.json({ broadcast }, { status: 201 });
}

/** PATCH: Update a broadcast (admin only) */
export async function PATCH(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const { data: profile } = await supabase
    .from("profiles")
    .select("role, department")
    .eq("id", user.id)
    .single();
  if (!hasBroadAdminAccess(profile)) return Response.json({ error: "Forbidden" }, { status: 403 });

  const { searchParams } = new URL(request.url);
  const id = searchParams.get("id");
  if (!id) return Response.json({ error: "id required" }, { status: 400 });

  // Fetch current broadcast to detect status transition
  const { data: current, error: fetchError } = await supabase
    .from("broadcasts")
    .select("*")
    .eq("id", id)
    .single();

  if (fetchError || !current) {
    return Response.json({ error: "Broadcast not found" }, { status: 404 });
  }

  const body = await request.json();
  const fields: Record<string, unknown> = { updated_at: new Date().toISOString() };

  if (body.title !== undefined) fields.title = body.title;
  if (body.body !== undefined) fields.body = body.body;
  if (body.category !== undefined) fields.category = body.category;
  if (body.magic_word !== undefined) fields.magic_word = body.magic_word || null;
  if (body.require_word !== undefined) fields.require_word = body.require_word;
  if (body.status !== undefined) fields.status = body.status;
  if (body.scheduled_at !== undefined) fields.scheduled_at = body.scheduled_at || null;
  if (body.link !== undefined) fields.link = body.link?.trim() || null;
  if (body.image_url !== undefined) fields.image_url = body.image_url?.trim() || null;
  if (body.sort_order !== undefined) fields.sort_order = typeof body.sort_order === "number" ? body.sort_order : 0;
  if (body.tags !== undefined) fields.tags = normalizeTags(body.tags);

  const { data: broadcast, error } = await supabase
    .from("broadcasts")
    .update(fields)
    .eq("id", id)
    .select()
    .single();

  if (error) return Response.json({ error: error.message }, { status: 500 });

  // Update recipients if provided
  if (Array.isArray(body.recipients) && body.recipients.length > 0) {
    await supabase.from("broadcast_recipients").delete().eq("broadcast_id", id);
    const recipientInserts = body.recipients.map((r: { type: string; value: string }) => ({
      broadcast_id: id,
      recipient_type: r.type,
      recipient_value: r.value,
    }));
    await supabase.from("broadcast_recipients").insert(recipientInserts);
  }

  // Every save of a published broadcast emails and Telegrams its recipients, so editing and
  // re-saving an already-published one sends it again.
  if (broadcast.status === "published") {
    // Fetch recipients for this broadcast (may have just been updated above)
    const { data: recipientRows } = await supabase
      .from("broadcast_recipients")
      .select("recipient_type, recipient_value")
      .eq("broadcast_id", id);

    const recipients: RecipientRow[] = (recipientRows || []).map((r) => ({
      type: r.recipient_type,
      value: r.recipient_value,
    }));

    after(() => sendBroadcastNotices(broadcast, recipients));
  }

  return Response.json({ broadcast });
}

/** DELETE: Delete a broadcast (admin only) */
export async function DELETE(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const { data: profile } = await supabase
    .from("profiles")
    .select("role, department")
    .eq("id", user.id)
    .single();
  if (!hasBroadAdminAccess(profile)) return Response.json({ error: "Forbidden" }, { status: 403 });

  const { searchParams } = new URL(request.url);
  const id = searchParams.get("id");
  if (!id) return Response.json({ error: "id required" }, { status: 400 });

  // Cascade delete: the broadcast's follow-ups go with it. Recipients and reads first, then broadcasts.
  const { data: followUps } = await supabase.from("broadcasts").select("id").eq("parent_id", id);
  const ids = [id, ...(followUps || []).map((f) => f.id)];
  await supabase.from("broadcast_reads").delete().in("broadcast_id", ids);
  await supabase.from("broadcast_recipients").delete().in("broadcast_id", ids);

  if (ids.length > 1) await supabase.from("broadcasts").delete().in("id", ids.slice(1));
  const { error } = await supabase.from("broadcasts").delete().eq("id", id);
  if (error) return Response.json({ error: error.message }, { status: 500 });

  return Response.json({ success: true });
}
