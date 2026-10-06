import { describe, expect, it } from "vitest";
import { canManageFixedPayAttachments } from "./fixedPayAttachmentAccess";

const base = { isAdminLike: false, userId: "va-1", claimedBy: null, createdBy: null };

describe("canManageFixedPayAttachments", () => {
  it("lets admins, managers and task_management holders through regardless of owner", () => {
    expect(canManageFixedPayAttachments({ ...base, isAdminLike: true, claimedBy: "someone-else" })).toBe(true);
  });

  it("lets the VA who claimed the task manage its files", () => {
    expect(canManageFixedPayAttachments({ ...base, claimedBy: "va-1" })).toBe(true);
  });

  it("lets the VA who created the task manage its files", () => {
    expect(canManageFixedPayAttachments({ ...base, createdBy: "va-1" })).toBe(true);
  });

  it("refuses a VA who neither claimed nor created the task", () => {
    expect(canManageFixedPayAttachments({ ...base, claimedBy: "va-2", createdBy: "va-3" })).toBe(false);
  });

  it("refuses when the task has no owner at all", () => {
    expect(canManageFixedPayAttachments(base)).toBe(false);
  });

  it("refuses an empty user id even if the task's owner columns are also empty strings", () => {
    expect(canManageFixedPayAttachments({ ...base, userId: "", claimedBy: "", createdBy: "" })).toBe(false);
  });
});
