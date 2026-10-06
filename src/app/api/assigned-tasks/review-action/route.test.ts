import { describe, it, expect, vi, beforeEach } from "vitest";

// The token is signed with the service-role key, read when approvalToken loads.
process.env.SUPABASE_SERVICE_ROLE_KEY = "test-service-role-key";
process.env.NEXT_PUBLIC_SUPABASE_URL = "http://localhost";

const writes: string[] = [];
let task: { id: number; task_name: string; status: string } | null;

// Records every write so the tests can say "GET wrote nothing".
function table(name: string) {
  const chain = {
    select: () => chain,
    eq: () => chain,
    single: async () => ({ data: name === "assigned_tasks" ? task : null }),
    update: () => {
      writes.push(`update:${name}`);
      return chain;
    },
    insert: async () => {
      writes.push(`insert:${name}`);
      return { error: null };
    },
    then: (resolve: (v: unknown) => void) => resolve({ error: null }),
  };
  return chain;
}

vi.mock("@supabase/supabase-js", () => ({ createClient: () => ({ from: table }) }));
vi.mock("@/lib/reviewLinks", () => ({ cheerApproval: vi.fn(async () => {}) }));
vi.mock("@/lib/fixedPayTaskSync", () => ({ syncFixedPayTaskStatus: vi.fn(async () => {}) }));
vi.mock("@/lib/notifyApproval", () => ({ notifyAssigneesOfApproval: vi.fn(async () => {}) }));
vi.mock("@/lib/telegram", () => ({
  sendTelegram: vi.fn(async () => {}),
  telegramEnabled: () => false,
  esc: (s: string) => s,
}));

import { NextRequest } from "next/server";
import { GET, POST } from "./route";
import { makeApprovalToken } from "@/lib/approvalToken";

const BASE = "https://minuteflow.click/api/assigned-tasks/review-action";

function getRequest(id: number, action: string, token: string) {
  return new NextRequest(`${BASE}?id=${id}&do=${action}&t=${token}`);
}

function postRequest(fields: Record<string, string>) {
  const body = new URLSearchParams(fields);
  return new NextRequest(BASE, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body,
  });
}

beforeEach(() => {
  writes.length = 0;
  task = { id: 7, task_name: "Flyer redesign", status: "submitted" };
});

describe("review-action GET", () => {
  it("shows a confirm page and writes nothing", async () => {
    const token = makeApprovalToken("submission", 7, "approve");
    const res = await GET(getRequest(7, "approve", token));
    const html = await res.text();
    expect(res.status).toBe(200);
    expect(html).toContain("Approve this task?");
    expect(html).toContain('<form method="post">');
    expect(writes).toEqual([]);
  });

  it("escapes the task name instead of running it", async () => {
    task = { id: 7, task_name: "<script>alert(1)</script>", status: "submitted" };
    const token = makeApprovalToken("submission", 7, "approve");
    const html = await (await GET(getRequest(7, "approve", token))).text();
    expect(html).not.toContain("<script>alert(1)</script>");
    expect(html).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
  });

  it("rejects a bad token and an unknown action without writing", async () => {
    const bad = await (await GET(getRequest(7, "approve", "nope"))).text();
    expect(bad).toContain("could not be verified");
    const odd = await (await GET(getRequest(7, "toString", "x"))).text();
    expect(odd).toContain("not valid");
    expect(writes).toEqual([]);
  });

  it("says so, without a button, when the task is already in that state", async () => {
    task = { id: 7, task_name: "Flyer", status: "approved" };
    const token = makeApprovalToken("submission", 7, "approve");
    const html = await (await GET(getRequest(7, "approve", token))).text();
    expect(html).toContain("Already approved");
    expect(html).not.toContain("<form");
  });
});

describe("review-action POST", () => {
  it("makes the change when the token is good", async () => {
    const token = makeApprovalToken("submission", 7, "approve");
    const res = await POST(postRequest({ id: "7", do: "approve", t: token }));
    expect(await res.text()).toContain("is now marked approved");
    expect(writes).toContain("update:assigned_tasks");
    expect(writes).toContain("insert:task_submissions");
  });

  it("refuses a token signed for a different action or task", async () => {
    const forOther = makeApprovalToken("submission", 8, "approve");
    await POST(postRequest({ id: "7", do: "approve", t: forOther }));
    const forRevision = makeApprovalToken("submission", 7, "revision");
    await POST(postRequest({ id: "7", do: "approve", t: forRevision }));
    expect(writes).toEqual([]);
  });

  it("does nothing twice when the task is already in that state", async () => {
    task = { id: 7, task_name: "Flyer", status: "revision_needed" };
    const token = makeApprovalToken("submission", 7, "revision");
    const html = await (await POST(postRequest({ id: "7", do: "revision", t: token }))).text();
    expect(html).toContain("Already revision requested");
    expect(writes).toEqual([]);
  });
});
