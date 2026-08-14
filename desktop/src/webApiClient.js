/**
 * Calls the web app's Next.js API routes (not direct Supabase table access) for
 * the handful of things that only exist behind those routes — right now
 * GET /api/assigned-tasks?selfOnly=true, PATCH /api/assigned-tasks/:id, and
 * POST /api/assigned-tasks/:id/todos (see AssignedTasksWidget.tsx,
 * src/lib/assignedTaskStatus.ts, and src/lib/taskTodos.ts's addTodo for
 * the web app's equivalents — this mirrors those calls exactly).
 *
 * Those routes authenticate via `src/lib/supabase/server.ts`, which reads the
 * user's session from a `@supabase/ssr`-formatted cookie (see
 * node_modules/@supabase/ssr/dist/main/cookies.js and utils/chunker.js) —
 * there's no Authorization-header path. The desktop app doesn't have a
 * browser's cookie jar, so we build that cookie by hand from the same session
 * our own supabase-js client already persisted (see sessionStore.js), using
 * the exact encoding @supabase/ssr uses:
 *   - cookie name:  `sb-<project-ref>-auth-token`  (project ref = the first
 *     dot-separated segment of the Supabase URL's hostname — this is also
 *     supabase-js's own default storageKey, so our client and the web app's
 *     browser client land on the identical cookie name with no extra config)
 *   - cookie value: "base64-" + base64url(JSON.stringify(session))
 *   - chunked into `<name>.0`, `<name>.1`, ... if longer than 3180 chars
 * This is not a guess — it's read directly out of the installed
 * @supabase/ssr package in the web app's node_modules.
 */

const { WEB_APP_BASE_URL, SUPABASE_URL } = require("./config");
const { fileStorageAdapter } = require("./sessionStore");

const COOKIE_CHUNK_SIZE = 3180; // matches @supabase/ssr's utils/chunker.js MAX_CHUNK_SIZE
const BASE64_PREFIX = "base64-";

function authCookieName() {
  const hostname = new URL(SUPABASE_URL).hostname;
  const projectRef = hostname.split(".")[0];
  return `sb-${projectRef}-auth-token`;
}

// Ported from @supabase/ssr's createChunks (utils/chunker.js), simplified: the
// upstream version splits on encodeURIComponent-safe boundaries because cookie
// values can contain arbitrary characters. Ours never can — base64url output
// plus the literal "base64-" prefix is only ever [A-Za-z0-9._-], none of which
// encodeURIComponent touches — so a plain length-based slice produces the same
// chunks without needing to reimplement that boundary-safety logic.
function chunkCookieValue(name, value) {
  if (value.length <= COOKIE_CHUNK_SIZE) return [{ name, value }];
  const chunks = [];
  for (let i = 0; i < value.length; i += COOKIE_CHUNK_SIZE) {
    chunks.push(value.slice(i, i + COOKIE_CHUNK_SIZE));
  }
  return chunks.map((v, i) => ({ name: `${name}.${i}`, value: v }));
}

/** Returns a `Cookie:` header value carrying the current session, or null if not logged in. */
function buildAuthCookieHeader() {
  const cookieName = authCookieName();
  const raw = fileStorageAdapter.getItem(cookieName);
  if (!raw) return null;

  const encoded = BASE64_PREFIX + Buffer.from(raw, "utf8").toString("base64url");
  const chunks = chunkCookieValue(cookieName, encoded);
  return chunks.map(({ name, value }) => `${name}=${value}`).join("; ");
}

async function fetchWithAuthCookie(path, options = {}) {
  const cookie = buildAuthCookieHeader();
  if (!cookie) throw new Error("Not logged in.");

  return fetch(`${WEB_APP_BASE_URL}${path}`, {
    ...options,
    headers: { ...(options.headers || {}), Cookie: cookie },
  });
}

/** GET /api/assigned-tasks?selfOnly=true — same endpoint AssignedTasksWidget.tsx uses. */
async function fetchAssignedTasksSelf() {
  const res = await fetchWithAuthCookie("/api/assigned-tasks?selfOnly=true");
  if (!res.ok) {
    throw new Error(`Couldn't load assigned tasks (${res.status}).`);
  }
  const json = await res.json();
  return json.tasks || [];
}

/** PATCH /api/assigned-tasks/:id — same call src/lib/assignedTaskStatus.ts makes. */
async function patchAssignedTaskStatus(assignedTaskId, body) {
  const res = await fetchWithAuthCookie(`/api/assigned-tasks/${assignedTaskId}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return res.ok;
}

/**
 * POST /api/assigned-tasks/:id/todos — same call src/lib/taskTodos.ts's
 * addTodo() makes. `assignedTaskId` is the parent assigned_tasks.id (NOT the
 * assigned_task_assignees row id used elsewhere as `assigneeId`).
 */
async function addTaskTodo(assignedTaskId, text) {
  const res = await fetchWithAuthCookie(`/api/assigned-tasks/${assignedTaskId}/todos`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text }),
  });
  if (!res.ok) {
    throw new Error(`Couldn't add the to-do (${res.status}).`);
  }
  const json = await res.json();
  return json.todo;
}

module.exports = {
  fetchAssignedTasksSelf,
  patchAssignedTaskStatus,
  addTaskTodo,
  // exported for the cookie-building unit test only
  _internal: { authCookieName, chunkCookieValue, buildAuthCookieHeader },
};
