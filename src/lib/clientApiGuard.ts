/**
 * Central "clients stay in their lane" check for /api/*, run from the proxy
 * (src/proxy.ts → updateSession) on every request.
 *
 * A client (employer) account shares the same Supabase project, login and
 * cookie as staff, and most staff API routes only check "is someone signed
 * in?" — not which role. Rather than retrofit a role check into every staff
 * route, a client login is refused on /api/* unless the route is on the
 * allowlist below: the routes the /client pages actually call, each of which
 * does its own org-scoping. Anything new a client page needs must be added
 * here on purpose.
 *
 * Who counts as a client: `app_metadata.account_type === "client"`. It is set
 * by the service role at client signup (app_metadata can't be changed by the
 * user themselves), so this costs no extra database query per request.
 */

type Rule = { pattern: RegExp; methods?: string[] };

const CLIENT_API_ALLOWLIST: Rule[] = [
  // The client admin area — every route here checks org membership itself.
  { pattern: /^\/api\/client-admin(\/.*)?$/ },
  // Invite a VA / list the org's invites (POST, GET, DELETE).
  { pattern: /^\/api\/organization-invites$/ },
  // Assign work to an org VA (POST) and "View as VA" (GET ?viewAsVa=).
  { pattern: /^\/api\/assigned-tasks$/, methods: ["GET", "POST"] },
  // Files and to-dos on their own org's tasks (each route checks the task's org).
  { pattern: /^\/api\/assigned-tasks\/\d+\/attachments$/ },
  { pattern: /^\/api\/assigned-tasks\/\d+\/todos(\/[^/]+)?$/ },
  // Their own org's VAs (the route returns nothing else to a client) — used by
  // the staff Assignment / Calendar screens clients reuse.
  { pattern: /^\/api\/team-members$/, methods: ["GET"] },
  // Objectives / Operations / Assets — every one of these checks the project
  // belongs to the client's own org (canAccessProject, or a client branch).
  { pattern: /^\/api\/projects$/ },
  { pattern: /^\/api\/projects\/(assets-overview|files-overview|messages-overview|submitted-files|subtask-stats|subtasks-list)$/, methods: ["GET"] },
  { pattern: /^\/api\/project-messages$/ },
  { pattern: /^\/api\/project-messages\/[^/]+\/comments$/ },
  { pattern: /^\/api\/project-files$/ },
  // Direct messages with the org's own VAs.
  { pattern: /^\/api\/conversations(\/.*)?$/ },
  // Screenshot images + details — both check the shooter is in the client's org.
  { pattern: /^\/api\/drive-image$/, methods: ["GET"] },
  { pattern: /^\/api\/screenshots\/meta$/ },
  // Report Bug / Idea in the client header.
  { pattern: /^\/api\/bug-reports$/, methods: ["POST"] },
  { pattern: /^\/api\/bug-reports\/upload$/, methods: ["POST"] },
  // Their own profile photo, from the name chip in the top bar (the route
  // only ever writes the caller's own avatar).
  { pattern: /^\/api\/upload-avatar$/, methods: ["POST"] },
  // Budget tab (read-only) — the route returns only the caller's own rows.
  { pattern: /^\/api\/budget-requests$/, methods: ["GET"] },
];

export const CLIENT_ACCOUNT_TYPE = "client";

export function isClientAllowedApi(pathname: string, method: string): boolean {
  const path = pathname.replace(/\/+$/, "");
  const m = method.toUpperCase();
  if (m === "OPTIONS" || m === "HEAD") return true;
  return CLIENT_API_ALLOWLIST.some(
    (rule) => rule.pattern.test(path) && (!rule.methods || rule.methods.includes(m))
  );
}

/**
 * Reads `app_metadata.account_type` from a bearer token WITHOUT verifying it.
 * That is safe here because it is only ever used to *refuse*: a genuine
 * client token is signed with account_type in it, and a token edited to drop
 * it no longer verifies, so the route's own getUser(token) rejects it anyway.
 */
export function bearerAccountType(authorization: string | null): string | null {
  const token = authorization?.replace(/^Bearer\s+/i, "").trim();
  if (!token) return null;
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  try {
    const b64 = parts[1].replace(/-/g, "+").replace(/_/g, "/");
    const padded = b64 + "=".repeat((4 - (b64.length % 4)) % 4);
    const payload = JSON.parse(atob(padded)) as { app_metadata?: { account_type?: unknown } };
    const type = payload.app_metadata?.account_type;
    return typeof type === "string" ? type : null;
  } catch {
    return null;
  }
}
