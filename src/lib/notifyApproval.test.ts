import { describe, expect, it } from "vitest";
import { buildApprovalNotice } from "./notifyApproval";

describe("buildApprovalNotice", () => {
  it("names the reviewer and the task", () => {
    const n = buildApprovalNotice({ reviewer: "Toni Colina", taskName: "SMC_Processing" });
    expect(n.bell).toBe("Toni Colina approved “SMC_Processing”");
    expect(n.telegram).toBe("✅ <b>Toni Colina</b> approved <b>SMC_Processing</b>");
  });

  it("appends the reviewer's note when there is one", () => {
    const n = buildApprovalNotice({ reviewer: "Toni", taskName: "Reel", note: "  Great work!  " });
    expect(n.bell).toBe("Toni approved “Reel”: Great work!");
    expect(n.telegram).toBe("✅ <b>Toni</b> approved <b>Reel</b>\n\nGreat work!");
  });

  it("truncates a long note to 160 characters plus an ellipsis", () => {
    const n = buildApprovalNotice({ reviewer: "Toni", taskName: "Reel", note: "x".repeat(300) });
    expect(n.bell).toBe(`Toni approved “Reel”: ${"x".repeat(160)}…`);
  });

  it("has no reviewer name when approved from a link", () => {
    const n = buildApprovalNotice({ reviewer: null, taskName: "Reel" });
    expect(n.bell).toBe("“Reel” was approved");
    expect(n.telegram).toBe("✅ <b>Reel</b> was approved");
  });

  it("falls back to 'a task' when the task has no name", () => {
    expect(buildApprovalNotice({ reviewer: "Toni", taskName: null }).bell).toBe("Toni approved “a task”");
    expect(buildApprovalNotice({ reviewer: null, taskName: "" }).bell).toBe("“a task” was approved");
  });

  it("escapes markup in Telegram text so names and notes can't break the message", () => {
    const n = buildApprovalNotice({ reviewer: "A<b>", taskName: "R&D <x>", note: "1 < 2" });
    expect(n.telegram).toBe("✅ <b>A&lt;b&gt;</b> approved <b>R&amp;D &lt;x&gt;</b>\n\n1 &lt; 2");
    // The bell shows plain text, so it isn't escaped.
    expect(n.bell).toBe("A<b> approved “R&D <x>”: 1 < 2");
  });
});
