import { describe, expect, it } from "vitest";
import { isAudience, isRecipient, memberEmploymentTypes } from "./broadcasts";

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
});
