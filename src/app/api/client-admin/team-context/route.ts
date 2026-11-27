import { requireClientOrgVaIds, serviceClient, isResponse } from "@/lib/clientAdminAccess";

export const dynamic = "force-dynamic";

/**
 * Display-only profile columns a client may see for the VAs in their org.
 * Never pay, bank/payment accounts, contact details, address or birthday —
 * a client can't read `profiles` directly at all (RLS keeps them to their
 * own row), so the client pages get the names they need from here.
 */
const SAFE_PROFILE_COLUMNS =
  "id, username, full_name, avatar_url, position, department, role, is_active, created_at";

/**
 * GET /api/client-admin/team-context
 * → { timezone, people }: the timezone the app reports in, plus the active
 * VAs in the caller's org with display-only fields.
 */
export async function GET() {
  const auth = await requireClientOrgVaIds();
  if (isResponse(auth)) return auth;
  const { vaIds } = auth;

  const admin = serviceClient();
  const [{ data: tzRow }, { data: people }] = await Promise.all([
    admin.from("organization_settings").select("timezone").limit(1).single(),
    vaIds.length
      ? admin.from("profiles").select(SAFE_PROFILE_COLUMNS).in("id", vaIds)
      : Promise.resolve({ data: [] as Record<string, unknown>[] }),
  ]);

  return Response.json({ timezone: tzRow?.timezone || "UTC", people: people ?? [] });
}
