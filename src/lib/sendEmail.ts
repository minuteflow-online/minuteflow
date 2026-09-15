import { createClient } from "@supabase/supabase-js";

/**
 * The one place email leaves MinuteFlow.
 *
 * Every send used to be its own raw `fetch("https://api.resend.com/emails")`,
 * scattered across ~20 routes, which meant "stop emailing this person" had no
 * single place to live. This wraps that call with one rule:
 *
 *   a recipient who is INACTIVE, or has emails turned off, is dropped.
 *
 * Suppression is by recipient address, not by call site, so it holds for every
 * kind of mail — paystubs, broadcasts, budget replies, capture alerts, memos —
 * including any added later, without each one having to remember the rule.
 *
 * Clients have the same switch, on the client record. An address belonging to
 * neither a team member nor a client passes through untouched.
 *
 * Deliberately NOT suppressed: password resets and invitations, which are sent
 * through this helper with `alwaysSend` because locking someone out of their own
 * account recovery is not what "turn off emails" means.
 *
 * The signature mirrors the `fetch` init it replaces and it returns a real
 * Response, so call sites that check `res.ok` keep working unchanged. When every
 * recipient is suppressed it returns a synthetic 200 — nothing was sent, and
 * nothing went wrong.
 *
 * Passing `log` records the send to the `email_log` table (Admin → Email Log)
 * — same reasoning as suppression: this is the one place a send happens, so
 * it's the one place that can guarantee every kind of mail is visible without
 * every call site remembering to log it itself.
 */

type SendOptions = {
  /** Skip the suppression check — account recovery and invitations only. */
  alwaysSend?: boolean;
  /** Record this send in the email_log table. Omit for sends that shouldn't
   * show up there (e.g. a manual test/diagnostic ping). */
  log?: {
    /** Broad category shown as a filter pill in the Email Log tab. */
    type: string;
    /** Per-send identifier, e.g. an invoice number or a VA's name. */
    label?: string;
    sublabel?: string;
  };
};

function adminClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } }
  );
}

function safeParseBody(body: unknown): Record<string, unknown> | null {
  try {
    return JSON.parse(String(body ?? "{}"));
  } catch {
    return null;
  }
}

/**
 * Fire-and-forget insert into email_log. Never awaited by the caller, and
 * failures here must never surface as a failed send — the email already
 * left, or didn't; this is just the record of it.
 */
async function logSend(
  response: Response,
  payload: Record<string, unknown> | null,
  log: NonNullable<SendOptions["log"]>
) {
  try {
    if (!response.ok) return; // failed sends aren't recorded — Resend already errors loudly
    const body = (await response.clone().json().catch(() => null)) as
      | { id?: string; skipped?: string }
      | null;
    if (body?.skipped) return; // suppressed — nothing actually went out

    const to = toArray(payload?.to);
    const cc = toArray(payload?.cc);
    const subject = typeof payload?.subject === "string" ? payload.subject : null;

    await adminClient().from("email_log").insert({
      email_type: log.type,
      label: log.label ?? null,
      sublabel: log.sublabel ?? null,
      recipient: to.join(", ") || null,
      cc_emails: cc.length ? cc.join(", ") : null,
      subject,
      resend_message_id: body?.id ?? null,
    });
  } catch {
    // Logging must never break a send.
  }
}

function toArray(value: unknown): string[] {
  if (Array.isArray(value)) return value.filter((v): v is string => typeof v === "string");
  if (typeof value === "string") return [value];
  return [];
}

/**
 * Addresses to drop: team members who are inactive or have emails turned off.
 *
 * profiles.username is a handle ("ari", "FleurM"), not an address — the real
 * email lives on the auth user — so the blocked profile ids are resolved to
 * addresses through auth.admin. Matched case-insensitively, since a stored
 * address and a hand-typed recipient will not always agree on capitalisation.
 */
export async function suppressedAddresses(candidates: string[]): Promise<Set<string>> {
  const suppressed = new Set<string>();
  if (candidates.length === 0) return suppressed;

  try {
    const supabase = adminClient();
    const { data: blocked } = await supabase
      .from("profiles")
      .select("id, is_active, emails_disabled")
      .or("is_active.eq.false,emails_disabled.eq.true");

    const blockedIds = (blocked ?? []).map((r: { id: string }) => r.id);
    const wanted = new Set(candidates.map((c) => c.trim().toLowerCase()));

    // Clients keep their address on the record itself — no auth lookup needed.
    const { data: blockedClients } = await supabase
      .from("clients")
      .select("email")
      .eq("emails_disabled", true);
    for (const row of (blockedClients ?? []) as { email: string | null }[]) {
      const email = row.email?.trim().toLowerCase();
      if (email && wanted.has(email)) suppressed.add(email);
    }

    if (blockedIds.length === 0) return suppressed;

    // Resolve each blocked profile to its address, and only keep the ones that
    // actually appear in this send — one lookup per blocked person, not per
    // recipient, and the list of blocked people is short.
    for (const id of blockedIds) {
      const { data: authUser } = await supabase.auth.admin.getUserById(id);
      const email = authUser?.user?.email?.trim().toLowerCase();
      if (email && wanted.has(email)) suppressed.add(email);
    }
  } catch {
    // If the lookup fails, send rather than silently swallow the mail — a
    // missed suppression is recoverable, a missed paystub is not.
    return new Set();
  }

  return suppressed;
}

export async function sendResendEmail(
  init: RequestInit,
  options: SendOptions = {}
): Promise<Response> {
  const url = "https://api.resend.com/emails";

  // Every path below ends here so a `log` option always gets recorded,
  // regardless of which branch actually sent the mail. Awaited, not
  // fire-and-forget — a serverless function can be torn down the instant it
  // returns a response, which would silently drop an un-awaited insert.
  const finish = async (response: Response, payload: Record<string, unknown> | null) => {
    if (options.log) await logSend(response, payload, options.log);
    return response;
  };

  if (options.alwaysSend) return finish(await fetch(url, init), safeParseBody(init.body));

  const payload = safeParseBody(init.body);
  if (!payload) {
    // Unparseable body — not ours to rewrite, pass it straight through.
    return finish(await fetch(url, init), null);
  }

  const to = toArray(payload.to);
  if (to.length === 0) return finish(await fetch(url, init), payload);

  const suppressed = await suppressedAddresses(to);
  if (suppressed.size === 0) return finish(await fetch(url, init), payload);

  const allowed = to.filter((address) => !suppressed.has(address.trim().toLowerCase()));

  if (allowed.length === 0) {
    const synthetic = new Response(
      JSON.stringify({ id: null, skipped: "recipient inactive or emails disabled" }),
      { status: 200, headers: { "Content-Type": "application/json" } }
    );
    return finish(synthetic, payload);
  }

  if (allowed.length === to.length) return finish(await fetch(url, init), payload);

  const narrowedPayload = { ...payload, to: allowed };
  return finish(await fetch(url, { ...init, body: JSON.stringify(narrowedPayload) }), narrowedPayload);
}

/**
 * Send regardless of suppression — account recovery and invitations only.
 *
 * Someone who is inactive, or has had their mail turned off, still has to be
 * able to reset a password or accept an invite. Turning off updates is not the
 * same as taking away the keys.
 */
export function sendResendEmailAlways(
  init: RequestInit,
  log?: SendOptions["log"]
): Promise<Response> {
  return sendResendEmail(init, { alwaysSend: true, log });
}
