import { describe, expect, it } from "vitest";
import { isReservedTaskName } from "./utils";

describe("isReservedTaskName", () => {
  it("catches the system's own marker names, case-insensitively and with surrounding whitespace", () => {
    expect(isReservedTaskName("Clock In")).toBe(true);
    expect(isReservedTaskName("clock in")).toBe(true);
    expect(isReservedTaskName("  Clocked In  ")).toBe(true);
    expect(isReservedTaskName("CLOCK OUT")).toBe(true);
    expect(isReservedTaskName("Clocked Out")).toBe(true);
  });

  it("leaves real task names alone", () => {
    expect(isReservedTaskName("Planning/Sorting")).toBe(false);
    expect(isReservedTaskName("Fix Website bugs and issues")).toBe(false);
    expect(isReservedTaskName("")).toBe(false);
  });
});
