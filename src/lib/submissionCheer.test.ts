import { describe, it, expect } from "vitest";
import { submissionCheer, approvalCheer } from "@/lib/submissionCheer";

const MENTION = '<a href="tg://user?id=123">Arianne</a>';

describe("submissionCheer", () => {
  it("names the work that was handed in", () => {
    const line = submissionCheer(MENTION, "Logo revisions v2");
    expect(line).toContain("“Logo revisions v2”");
    expect(line).toContain(MENTION);
  });

  it("leads with a bold headline so it carries weight in a busy chat", () => {
    for (let i = 0; i < 40; i++) {
      const line = submissionCheer(MENTION, "Some task");
      expect(line.split("\n")).toHaveLength(2);
      expect(line).toMatch(/^\S+ <b>[^<]+<\/b>\n/u);
    }
  });

  it("still marks the moment when the task has no name", () => {
    for (const empty of [undefined, null, "", "   "]) {
      const line = submissionCheer(MENTION, empty);
      expect(line).toContain(MENTION);
      expect(line).not.toContain("{task}");
      expect(line).not.toContain("“”");
    }
  });

  it("escapes a task name, which is free text", () => {
    const line = submissionCheer(MENTION, "R&D <urgent>");
    expect(line).toContain("R&amp;D &lt;urgent&gt;");
    // The mention's own markup must survive — it arrives already built.
    expect(line).toContain(MENTION);
  });

  it("does not leave an unfilled placeholder in any combination", () => {
    for (let i = 0; i < 200; i++) {
      const line = submissionCheer(MENTION, i % 2 ? "A task" : null);
      expect(line).not.toMatch(/\{(name|task)\}/);
    }
  });

  it("varies — a hundred draws are not all the same line", () => {
    const seen = new Set(
      Array.from({ length: 100 }, () => submissionCheer(MENTION, "A task"))
    );
    expect(seen.size).toBeGreaterThan(20);
  });
});

describe("approvalCheer", () => {
  it("gets the same bold shape, so approval does not read smaller", () => {
    for (let i = 0; i < 40; i++) {
      const line = approvalCheer(MENTION);
      expect(line.split("\n")).toHaveLength(2);
      expect(line).toMatch(/^\S+ <b>[^<]+<\/b>\n/u);
      expect(line).toContain(MENTION);
      expect(line).not.toMatch(/\{name\}/);
    }
  });
});
