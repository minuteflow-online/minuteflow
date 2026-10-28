import { describe, it, expect } from "vitest";
import { findCaptureGaps, formatGapMinutes } from "@/lib/screenshotGaps";

const at = (hhmm: string) => `2026-09-30T${hhmm}:00.000Z`;

describe("findCaptureGaps", () => {
  it("finds nothing when slots land every 5 minutes", () => {
    const shots = ["01:31", "01:36", "01:41", "01:46"].map(at);
    expect(findCaptureGaps(shots, { start_time: at("01:31"), end_time: at("01:46") })).toEqual([]);
  });

  it("finds the long stretch with no screenshot and no marker (Precious, Sept 30)", () => {
    const shots = ["01:31", "01:43", "03:37", "03:42"].map(at);
    const gaps = findCaptureGaps(shots, { start_time: at("01:31"), end_time: at("03:42") });
    expect(gaps).toHaveLength(1);
    expect(gaps[0]).toMatchObject({ start: at("01:43"), end: at("03:37"), minutes: 114 });
  });

  it("does not call a single late slot a gap", () => {
    const shots = ["01:00", "01:11"].map(at); // 11 minutes: within two slots
    expect(findCaptureGaps(shots, { start_time: at("01:00"), end_time: at("01:11") })).toEqual([]);
  });

  it("counts a marker as a record, so a slot that explained itself is not a gap", () => {
    // Same times as a real screenshot — a marker row is just another entry in the list.
    const shots = ["02:00", "02:05", "02:10", "02:15"].map(at);
    expect(findCaptureGaps(shots, { start_time: at("02:00"), end_time: at("02:15") })).toEqual([]);
  });

  it("flags time between the last record and the task's end", () => {
    const gaps = findCaptureGaps([at("04:00")], { start_time: at("04:00"), end_time: at("04:40") });
    expect(gaps).toHaveLength(1);
    expect(gaps[0].minutes).toBe(40);
  });

  it("claims nothing about an open task after its last record", () => {
    expect(findCaptureGaps([at("04:00")], { start_time: at("04:00"), end_time: null })).toEqual([]);
  });

  it("ignores a pause, which is not captured either", () => {
    expect(findCaptureGaps([at("05:00")], { start_time: at("05:00"), end_time: at("06:00"), category: "Pause" })).toEqual([]);
  });

  it("still reports a gap on an ordinary task of the same length", () => {
    const gaps = findCaptureGaps([at("05:00")], { start_time: at("05:00"), end_time: at("06:00"), category: "Task" });
    expect(gaps).toHaveLength(1);
    expect(gaps[0].minutes).toBe(60);
  });

  it("ignores a break, which is deliberately not captured", () => {
    expect(findCaptureGaps([at("05:00")], { start_time: at("05:00"), end_time: at("06:00"), category: "Break" })).toEqual([]);
  });
});

describe("findCaptureGaps when the date filter cuts a task", () => {
  const t = (iso: string) => new Date(iso).getTime();

  it("does not call the hidden part before the first loaded shot a gap", () => {
    // Task started 8:03 PM; "Today" only loaded records from midnight on.
    const shots = ["2026-10-20T04:02:11.000Z", "2026-10-20T04:02:56.000Z"];
    const log = { start_time: "2026-10-20T00:03:18.000Z", end_time: null };
    const loaded = { start: t("2026-10-20T04:02:11.000Z"), end: t("2026-10-20T04:02:56.000Z") };
    expect(findCaptureGaps(shots, log, undefined, loaded)).toEqual([]);
    // Without the loaded span the same input is flagged: the bug this guards against.
    expect(findCaptureGaps(shots, log)).toHaveLength(1);
  });

  it("still flags a real gap at the start of a task the page fully loaded", () => {
    const shots = ["2026-09-30T10:31:46.000Z"];
    const log = { start_time: "2026-09-30T07:46:04.000Z", end_time: "2026-09-30T10:38:39.000Z" };
    const loaded = { start: t("2026-09-01T00:00:00.000Z"), end: t("2026-10-19T00:00:00.000Z") };
    const gaps = findCaptureGaps(shots, log, undefined, loaded);
    expect(gaps).toHaveLength(1);
    expect(gaps[0].minutes).toBe(166); // 7:46:04 -> 10:31:46 = 165m42s
  });

  it("ignores a task end that falls after the newest loaded record", () => {
    const shots = ["2026-10-19T20:00:00.000Z"];
    const log = { start_time: "2026-10-19T20:00:00.000Z", end_time: "2026-10-19T23:00:00.000Z" };
    const loaded = { start: t("2026-10-19T00:00:00.000Z"), end: t("2026-10-19T20:00:00.000Z") };
    expect(findCaptureGaps(shots, log, undefined, loaded)).toEqual([]);
  });

  it("still finds gaps between two shots inside a cut task", () => {
    const shots = ["2026-10-20T04:00:00.000Z", "2026-10-20T04:30:00.000Z"];
    const loaded = { start: t("2026-10-20T04:00:00.000Z"), end: t("2026-10-20T04:30:00.000Z") };
    expect(findCaptureGaps(shots, { start_time: "2026-10-20T00:00:00.000Z", end_time: null }, undefined, loaded)).toHaveLength(1);
  });
});

describe("formatGapMinutes", () => {
  it("reads like the rest of the page", () => {
    expect(formatGapMinutes(114)).toBe("1h 54m");
    expect(formatGapMinutes(47)).toBe("47m");
    expect(formatGapMinutes(120)).toBe("2h");
  });
});
