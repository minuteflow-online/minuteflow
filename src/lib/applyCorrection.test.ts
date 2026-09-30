import { describe, it, expect, vi } from "vitest";
import { applyCorrection } from "@/lib/applyCorrection";

/**
 * A minimal stand-in for the Supabase client, covering only the chains
 * applyCorrection actually calls. No network, no real database — this is
 * what let the blank-task_name guard get verified without touching
 * production data, the same request that was crashing in Toni's admin panel.
 */
function fakeSupabase(currentLog: Record<string, unknown>) {
  const updateSpy = vi.fn();

  function builder(table: string) {
    const state: { updatePayload?: Record<string, unknown> } = {};
    const chain = {
      select: () => chain,
      eq: () => chain,
      is: () => chain,
      gt: () => chain,
      order: () => chain,
      limit: () => chain,
      not: () => chain,
      single: async () => (table === "time_logs" ? { data: currentLog } : { data: null }),
      maybeSingle: async () => ({ data: null }),
      update: (payload: Record<string, unknown>) => {
        if (table === "time_logs") updateSpy(payload);
        state.updatePayload = payload;
        return chain;
      },
      insert: async () => ({ error: null }),
      // update(...).eq(...) resolves here when awaited directly
      then: (resolve: (v: { error: null }) => void) => resolve({ error: null }),
    };
    return chain;
  }

  return {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    client: { from: (table: string) => builder(table) } as any,
    updateSpy,
  };
}

const baseLog = {
  id: 1,
  user_id: "va-1",
  task_name: "MinuteFlow Work",
  category: "Task",
  account: "Virtual Concierge",
  client_name: "Toni Colina",
  project: "Systems and Operations",
  billable: true,
  start_time: "2026-09-22T17:15:54.000Z",
  end_time: "2026-09-22T18:14:22.000Z",
};

describe("applyCorrection", () => {
  it("refuses to blank task_name instead of hitting the NOT NULL constraint", async () => {
    // The exact shape of Flordeliz's 9/22 request: task_name corrected to "".
    const { client, updateSpy } = fakeSupabase(baseLog);
    const result = await applyCorrection(client, {
      requestId: 99,
      logId: 1,
      changes: { task_name: "", client_name: "Thess Peters" },
      reviewerId: "toni",
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe("blank_required_field");
      expect(result.error).toContain("task name");
    }
    // Never even reaches the database — the guard fires before any write.
    expect(updateSpy).not.toHaveBeenCalled();
  });

  it("still allows blanking an optional field like client_name", async () => {
    const { client, updateSpy } = fakeSupabase(baseLog);
    const result = await applyCorrection(client, {
      requestId: 100,
      logId: 1,
      changes: { client_name: "" },
      reviewerId: "toni",
    });

    expect(result.ok).toBe(true);
    expect(updateSpy).toHaveBeenCalledWith(expect.objectContaining({ client_name: null }));
  });

  it("approves a corrected task_name normally", async () => {
    const { client, updateSpy } = fakeSupabase(baseLog);
    const result = await applyCorrection(client, {
      requestId: 101,
      logId: 1,
      changes: { task_name: "Thess Peters Social Media", client_name: "Thess Peters" },
      reviewerId: "toni",
    });

    expect(result.ok).toBe(true);
    expect(updateSpy).toHaveBeenCalledWith(
      expect.objectContaining({ task_name: "Thess Peters Social Media", client_name: "Thess Peters" })
    );
  });
});
