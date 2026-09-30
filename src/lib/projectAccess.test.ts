import { describe, expect, it } from "vitest";
import { filterAccessibleProjectIds } from "./projectAccess";

/** A minimal stand-in for the two lookups canAccessProject makes:
 *  .from("projects").select("created_by").eq("id", id).maybeSingle()
 *  .from("project_va_access").select("va_id").eq("project_id", id).eq("va_id", userId).maybeSingle() */
function fakeServiceClient(opts: {
  ownedBy?: Record<string, string>; // projectId -> created_by
  grantedTo?: Record<string, string[]>; // projectId -> va_ids with access
}) {
  const owned = opts.ownedBy ?? {};
  const granted = opts.grantedTo ?? {};
  return {
    from: (table: string) => {
      if (table === "projects") {
        return {
          select: () => ({
            eq: (_col: string, id: string) => ({
              maybeSingle: async () => ({ data: id in owned ? { created_by: owned[id] } : null }),
            }),
          }),
        };
      }
      if (table === "project_va_access") {
        return {
          select: () => ({
            eq: (_col: string, projectId: string) => ({
              eq: (_col2: string, vaId: string) => ({
                maybeSingle: async () => ({
                  data: (granted[projectId] ?? []).includes(vaId) ? { va_id: vaId } : null,
                }),
              }),
            }),
          }),
        };
      }
      throw new Error(`unexpected table: ${table}`);
    },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any;
}

describe("filterAccessibleProjectIds", () => {
  it("keeps only projects the VA owns or was granted", async () => {
    const client = fakeServiceClient({
      ownedBy: { "p-mine": "va-1" },
      grantedTo: { "p-granted": ["va-1"] },
    });
    const result = await filterAccessibleProjectIds(
      client,
      { role: "va" },
      "va-1",
      ["p-mine", "p-granted", "p-not-mine", "p-unknown"]
    );
    expect(result.sort()).toEqual(["p-granted", "p-mine"]);
  });

  it("returns an empty list when a VA has none of the requested ids", async () => {
    const client = fakeServiceClient({ ownedBy: { "p1": "someone-else" } });
    const result = await filterAccessibleProjectIds(client, { role: "va" }, "va-1", ["p1", "p2"]);
    expect(result).toEqual([]);
  });

  it("gives an admin every requested id, unchanged, without even querying", async () => {
    const client = fakeServiceClient({});
    const result = await filterAccessibleProjectIds(client, { role: "admin" }, "admin-1", ["p1", "p2", "p3"]);
    expect(result).toEqual(["p1", "p2", "p3"]);
  });

  it("also passes through coordinator/specialist, the existing broad-access tier", async () => {
    const client = fakeServiceClient({});
    expect(await filterAccessibleProjectIds(client, { role: "coordinator" }, "c-1", ["p1"])).toEqual(["p1"]);
    expect(await filterAccessibleProjectIds(client, { role: "specialist" }, "s-1", ["p1"])).toEqual(["p1"]);
  });

  it("returns an empty list for an empty input list", async () => {
    const client = fakeServiceClient({});
    expect(await filterAccessibleProjectIds(client, { role: "va" }, "va-1", [])).toEqual([]);
  });
});
