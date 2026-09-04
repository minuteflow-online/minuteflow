import { describe, it, expect } from "vitest";
import { meetingClock } from "@/lib/teamDigest";

// Half the team is twelve hours from Eastern, so a meeting time without a zone
// is a coin flip. "06:00" also reads as a timestamp rather than an appointment.

describe("meetingClock", () => {
  it("renders the standing Saturday meeting", () => {
    expect(meetingClock("06:00:00")).toBe("6:00 AM ET");
  });

  it("handles afternoons", () => {
    expect(meetingClock("13:30:00")).toBe("1:30 PM ET");
    expect(meetingClock("18:05")).toBe("6:05 PM ET");
  });

  it("gets both noon and midnight right", () => {
    // The two the 12-hour clock always breaks on.
    expect(meetingClock("12:00:00")).toBe("12:00 PM ET");
    expect(meetingClock("00:00:00")).toBe("12:00 AM ET");
  });

  it("falls back rather than printing NaN on something unexpected", () => {
    expect(meetingClock("later")).toBe("later");
  });
});
