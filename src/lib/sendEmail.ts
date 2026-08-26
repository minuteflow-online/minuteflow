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
 */

type SendOptions = {
  /** Skip the suppression check — account recovery and invitations only. */
  alwaysSend?: boolean;
};

function adminClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } }
  );
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

  if (options.alwaysSend) return fetch(url, init);

  let payload: Record<string, unknown>;
  try {
    payload = JSON.parse(String(init.body ?? "{}"));
  } catch {
    // Unparseable body — not ours to rewrite, pass it straight through.
    return fetch(url, init);
  }

  const to = toArray(payload.to);
  if (to.length === 0) return fetch(url, init);

  const suppressed = await suppressedAddresses(to);
  if (suppressed.size === 0) return fetch(url, init);

  const allowed = to.filter((address) => !suppressed.has(address.trim().toLowerCase()));

  if (allowed.length === 0) {
    return new Response(
      JSON.stringify({ id: null, skipped: "recipient inactive or emails disabled" }),
      { status: 200, headers: { "Content-Type": "application/json" } }
    );
  }

  if (allowed.length === to.length) return fetch(url, init);

  return fetch(url, { ...init, body: JSON.stringify({ ...payload, to: allowed }) });
}

/**
 * Send regardless of suppression — account recovery and invitations only.
 *
 * Someone who is inactive, or has had their mail turned off, still has to be
 * able to reset a password or accept an invite. Turning off updates is not the
 * same as taking away the keys.
 */
export function sendResendEmailAlways(init: RequestInit): Promise<Response> {
  return sendResendEmail(init, { alwaysSend: true });
}
