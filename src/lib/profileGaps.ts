import { createClient } from "@supabase/supabase-js";

/**
 * What is still missing from each person's profile.
 *
 * These fields are not admin tidiness. A missing payment account is how someone
 * does not get paid; a missing birthday is why the team chat skips them on the
 * day; a missing photo is why they are a grey circle to everyone else. The
 * reminder goes to the person who can actually fix it.
 *
 * Weekly, not daily. A nag that arrives every morning is one people learn to
 * dismiss without reading, and then the week it says something new they dismiss
 * that too.
 */

/** Fields Toni asked to chase, in the order they matter to the person. */
const FIELDS = [
  {
    key: "payment_accounts",
    label: "Payment details",
    why: "so your pay can actually be sent",
    missing: (p: Record<string, unknown>) =>
      !p.payment_accounts || JSON.stringify(p.payment_accounts) === "{}",
  },
  {
    key: "address",
    label: "Address",
    why: null,
    missing: (p: Record<string, unknown>) => !String(p.address ?? "").trim(),
  },
  {
    key: "birthday",
    label: "Birthday",
    why: "so we know when to celebrate",
    missing: (p: Record<string, unknown>) => !p.birthday,
  },
  {
    key: "avatar_url",
    label: "Profile picture",
    why: null,
    missing: (p: Record<string, unknown>) => !String(p.avatar_url ?? "").trim(),
  },
] as const;

export type ProfileGap = {
  userId: string;
  name: string;
  chatId: number | null;
  missing: { label: string; why: string | null }[];
};

export async function findProfileGaps(): Promise<ProfileGap[]> {
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  );

  const { data } = await supabase
    .from("profiles")
    .select("id, full_name, username, avatar_url, birthday, address, payment_accounts, telegram_chat_id")
    .eq("is_active", true)
    .order("full_name");

  const gaps: ProfileGap[] = [];

  for (const p of data ?? []) {
    const row = p as unknown as Record<string, unknown>;
    const missing = FIELDS.filter((f) => f.missing(row)).map((f) => ({
      label: f.label,
      why: f.why,
    }));
    if (missing.length === 0) continue;

    gaps.push({
      userId: p.id as string,
      name: (p.full_name as string) || (p.username as string) || "Someone",
      chatId: (p.telegram_chat_id as number | null) ?? null,
      missing,
    });
  }

  return gaps;
}

/** The message one person gets about their own profile. */
export function gapMessage(gap: ProfileGap): string {
  const lines = [
    "📋 <b>A few things missing from your profile</b>",
    "",
    `Hi ${gap.name} — when you have a minute:`,
    "",
  ];

  for (const m of gap.missing) {
    lines.push(m.why ? `• ${m.label} — ${m.why}` : `• ${m.label}`);
  }

  // The portal, not a /profile page — VAProfileTab lives inside it, and a link
  // to a page that does not exist is worse than no link.
  lines.push("", "You can add them in your Portal: https://minuteflow.click/portal");
  return lines.join("\n");
}
