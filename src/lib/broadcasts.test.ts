import { describe, expect, it } from "vitest";
import { canReadBroadcast, isAudience, isRecipient, memberEmploymentTypes } from "./broadcasts";

const member = (over: Partial<Parameters<typeof isRecipient>[1]> = {}) => ({
  id: "u1",
  role: "va",
  employment_type: null,
  position: null,
  pay_rate_type: null,
  is_active: true,
  ...over,
});

describe("memberEmploymentTypes", () => {
  it("reads full and part time from the position, including legacy labels", () => {
    expect(memberEmploymentTypes(member({ position: "Full Time" })).has("full_time")).toBe(true);
    expect(memberEmploymentTypes(member({ position: "Part-time VA" })).has("part_time")).toBe(true);
  });

  it("reads hourly and per task from the pay rate type", () => {
    expect(memberEmploymentTypes(member({ pay_rate_type: "hourly" })).has("hourly")).toBe(true);
    expect(memberEmploymentTypes(member({ pay_rate_type: "per_task" })).has("per_task")).toBe(true);
    expect(memberEmploymentTypes(member({ position: "Output Based" })).has("per_task")).toBe(true);
  });

  it("still honours an invitation's employment_type", () => {
    expect(memberEmploymentTypes(member({ employment_type: "part_time" })).has("part_time")).toBe(true);
  });
});

describe("isRecipient by employment type", () => {
  const rows = ["hourly", "full_time", "part_time"].map((value) => ({ type: "employment_type", value }));

  it("includes members whose type comes only from position or pay rate", () => {
    expect(isRecipient(rows, member({ position: "Full Time" }))).toBe(true);
    expect(isRecipient(rows, member({ position: "Part Time" }))).toBe(true);
    expect(isRecipient(rows, member({ pay_rate_type: "hourly" }))).toBe(true);
  });

  it("leaves out types that weren't picked", () => {
    expect(isRecipient(rows, member({ position: "Output Based", pay_rate_type: "per_task" }))).toBe(false);
  });
});

describe("isAudience", () => {
  const everyone = [{ type: "all", value: "all" }];

  it("leaves out the broadcast's author", () => {
    expect(isAudience(everyone, member({ id: "toni" }), "toni")).toBe(false);
  });

  it("keeps every other recipient", () => {
    expect(isAudience(everyone, member({ id: "u1" }), "toni")).toBe(true);
    expect(isAudience(everyone, member({ id: "u1" }), null)).toBe(true);
  });

  it("never includes a client (employer) account, however it was targeted", () => {
    const client = member({ id: "c1", role: "client" });
    expect(isAudience(everyone, client, "toni")).toBe(false);
    expect(isAudience([{ type: "individual", value: "c1" }], client, "toni")).toBe(false);
    expect(isAudience([{ type: "role", value: "client" }], client, "toni")).toBe(false);
  });
});


describe("canReadBroadcast", () => {
  const va = { id: "va", role: "va", employment_type: null, is_active: true };
  const admin = { ...va, id: "adm", role: "admin" };
  const toVa = [{ type: "individual", value: "va" }];
  const memo = { status: "published", category: "memo", created_by: "adm" };
  const now = new Date("2026-11-25T12:00:00Z");

  it("lets the audience read a published memo, not someone it wasn't sent to", () => {
    expect(canReadBroadcast(memo, toVa, va, false, now)).toBe(true);
    expect(canReadBroadcast(memo, toVa, { ...va, id: "other" }, false, now)).toBe(false);
  });

  it("hides drafts and future scheduled broadcasts from the audience", () => {
    expect(canReadBroadcast({ ...memo, status: "draft" }, toVa, va, false, now)).toBe(false);
    expect(canReadBroadcast({ ...memo, status: "scheduled", scheduled_at: "2026-11-26T00:00:00Z" }, toVa, va, false, now)).toBe(false);
    expect(canReadBroadcast({ ...memo, status: "scheduled", scheduled_at: "2026-11-24T00:00:00Z" }, toVa, va, false, now)).toBe(true);
  });

  it("keeps a coaching note from admins it isn't shared with, but not from the person it's for", () => {
    const note = { ...memo, category: "coaching_notes", created_by: "toni", shared_with: ["adm"] };
    expect(canReadBroadcast(note, toVa, { ...admin, id: "neil" }, true, now)).toBe(false);
    expect(canReadBroadcast(note, toVa, admin, true, now)).toBe(true);
    expect(canReadBroadcast(note, toVa, { ...admin, id: "toni" }, true, now)).toBe(true);
    expect(canReadBroadcast(note, toVa, va, false, now)).toBe(true);
  });
});
