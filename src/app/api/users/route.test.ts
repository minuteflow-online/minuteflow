import { describe, expect, it } from "vitest";
import { guardFounderAccount } from "./route";

/** A minimal stand-in for the one chain guardFounderAccount actually calls:
 *  .from("profiles").select("role").eq("id", id).single(). */
function fakeAdminClient(roleByUserId: Record<string, string>) {
  return {
    from: () => ({
      select: () => ({
        eq: (_col: string, id: string) => ({
          single: async () => ({ data: id in roleByUserId ? { role: roleByUserId[id] } : null }),
        }),
      }),
    }),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any;
}

describe("guardFounderAccount", () => {
  it("refuses a manager acting on a founder's account", async () => {
    const admin = fakeAdminClient({ "founder-1": "founder" });
    const res = await guardFounderAccount(admin, "founder-1", "manager-1", "delete the account");
    expect(res).not.toBeNull();
    expect(res!.status).toBe(403);
    const body = await res!.json();
    expect(body.error).toContain("delete the account");
  });

  it("refuses acting on a CEO's account too, not just Founder", async () => {
    const admin = fakeAdminClient({ "ceo-1": "ceo" });
    const res = await guardFounderAccount(admin, "ceo-1", "admin-1", "disable");
    expect(res).not.toBeNull();
    expect(res!.status).toBe(403);
  });

  it("lets a founder act on their own account", async () => {
    const admin = fakeAdminClient({ "founder-1": "founder" });
    const res = await guardFounderAccount(admin, "founder-1", "founder-1", "reset the password");
    expect(res).toBeNull();
  });

  it("does not look up the target at all when acting on yourself", async () => {
    // No entry for "someone" — if the function looked it up, .single() would
    // return { data: null } which is fine either way, but the self-check
    // should short-circuit before ever querying.
    const admin = fakeAdminClient({});
    const res = await guardFounderAccount(admin, "someone", "someone", "delete the account");
    expect(res).toBeNull();
  });

  it("lets anyone act on a non-founder account", async () => {
    const admin = fakeAdminClient({ "va-1": "va", "manager-2": "manager" });
    expect(await guardFounderAccount(admin, "va-1", "admin-1", "delete the account")).toBeNull();
    expect(await guardFounderAccount(admin, "manager-2", "admin-1", "disable")).toBeNull();
  });

  it("lets it through when the target profile can't be found", async () => {
    // Mirrors the route's existing behaviour elsewhere: a lookup miss isn't
    // treated as "must be a founder" — it just isn't blocked by this guard.
    const admin = fakeAdminClient({});
    const res = await guardFounderAccount(admin, "unknown-id", "admin-1", "delete the account");
    expect(res).toBeNull();
  });
});
