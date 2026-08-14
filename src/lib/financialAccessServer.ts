import { createClient } from "@/lib/supabase/server";
import { hasFinancialAccess } from "@/lib/financialAccess";

// Kept in a separate file from financialAccess.ts because this imports
// next/headers (via the server Supabase client) — bundling it into the same
// file as the pure hasXAccess() checks breaks any client component that
// only wanted those (Next.js refuses to bundle a server-only module into
// client code).

/** Server-route guard: verifies the caller is authenticated and has
 * financial access (Founder/Accounting department tag). Returns
 * `{ userId }` on success or a ready-to-return `Response` on failure. */
export async function requireFinancialAccess(): Promise<{ userId: string } | Response> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { data: profile } = await supabase
    .from("profiles")
    .select("role, department")
    .eq("id", user.id)
    .single();

  if (!hasFinancialAccess(profile)) {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }

  return { userId: user.id };
}
