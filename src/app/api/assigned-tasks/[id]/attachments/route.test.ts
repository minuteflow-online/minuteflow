import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * DELETE /api/assigned-tasks/[id]/attachments access rules.
 *
 * Runs against an in-memory fake of Supabase, so it never touches real data.
 * The bug this guards: DELETE was admin-only while GET/POST allowed the
 * assigned VA, so a VA could attach a file to their own task but not remove it.
 */

type Row = Record<string, unknown>;
const db: { attachments: Row[]; assignees: Row[]; removedFiles: string[]; profile: Row | null; userId: string | null } = {
  attachments: [],
  assignees: [],
  removedFiles: [],
  profile: null,
  userId: null,
};

// Minimal chainable query: .select().eq().eq() then .single()/.maybeSingle(),
// or .delete().eq(). Only the calls the route makes are supported.
function table(name: string) {
  const filters: [string, unknown][] = [];
  let deleting = false;
  const rows = () => {
    const source = name === "assigned_task_attachments" ? db.attachments : name === "assigned_task_assignees" ? db.assignees : [];
    return source.filter((r) => filters.every(([k, v]) => String(r[k]) === String(v)));
  };
  const builder: Record<string, unknown> = {
    select: () => builder,
    delete: () => {
      deleting = true;
      return builder;
    },
    eq: (k: string, v: unknown) => {
      filters.push([k, v]);
      return deleting ? Promise.resolve(applyDelete()) : builder;
    },
    single: async () => {
      if (name === "profiles") return { data: db.profile, error: null };
      const r = rows();
      return r.length === 1 ? { data: r[0], error: null } : { data: null, error: { code: "PGRST116", message: "no rows" } };
    },
    maybeSingle: async () => ({ data: rows()[0] ?? null, error: null }),
  };
  function applyDelete() {
    const gone = new Set(rows());
    db.attachments = db.attachments.filter((r) => !gone.has(r));
    return { error: null };
  }
  return builder;
}

const fakeClient = () => ({
  auth: { getUser: async () => ({ data: { user: db.userId ? { id: db.userId } : null } }) },
  from: (name: string) => table(name),
  storage: { from: () => ({ remove: async (paths: string[]) => void db.removedFiles.push(...paths) }) },
});

vi.mock("@/lib/supabase/server", () => ({ createClient: async () => fakeClient() }));
vi.mock("@supabase/supabase-js", () => ({ createClient: () => fakeClient() }));

import { DELETE } from "./route";

const call = (taskId: string, attachmentId: string | null) =>
  DELETE(
    new Request(`http://localhost/api/assigned-tasks/${taskId}/attachments${attachmentId ? `?attachmentId=${attachmentId}` : ""}`, {
      method: "DELETE",
    }),
    { params: Promise.resolve({ id: taskId }) }
  );

beforeEach(() => {
  db.userId = "va-1";
  db.profile = { role: "va", admin_permissions: [] };
  db.assignees = [{ assigned_task_id: "10", va_id: "va-1" }];
  db.attachments = [
    { id: 1, assigned_task_id: "10", storage_path: "a/one.png" },
    { id: 2, assigned_task_id: "20", storage_path: "b/two.png" },
  ];
  db.removedFiles = [];
});

describe("DELETE /api/assigned-tasks/[id]/attachments", () => {
  it("lets the VA assigned to the task delete its attachment", async () => {
    const res = await call("10", "1");
    expect(res.status).toBe(204);
    expect(db.attachments.map((a) => a.id)).toEqual([2]);
    expect(db.removedFiles).toEqual(["a/one.png"]);
  });

  it("refuses a VA who is not assigned to the task", async () => {
    db.assignees = [{ assigned_task_id: "99", va_id: "va-1" }];
    const res = await call("10", "1");
    expect(res.status).toBe(403);
    expect(db.attachments).toHaveLength(2);
    expect(db.removedFiles).toEqual([]);
  });

  it("refuses a request with no signed-in user", async () => {
    db.userId = null;
    const res = await call("10", "1");
    expect(res.status).toBe(401);
    expect(db.attachments).toHaveLength(2);
  });

  it("lets an admin delete on a task they are not assigned to", async () => {
    db.profile = { role: "admin", admin_permissions: [] };
    db.assignees = [];
    const res = await call("10", "1");
    expect(res.status).toBe(204);
    expect(db.attachments.map((a) => a.id)).toEqual([2]);
  });

  it("will not delete another task's file by naming it under a task the VA owns", async () => {
    const res = await call("10", "2");
    expect(res.status).toBe(404);
    expect(db.attachments).toHaveLength(2);
    expect(db.removedFiles).toEqual([]);
  });

  it("requires an attachmentId", async () => {
    const res = await call("10", null);
    expect(res.status).toBe(400);
    expect(db.attachments).toHaveLength(2);
  });
});
