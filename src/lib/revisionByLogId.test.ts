import { describe, it, expect } from "vitest";
import { computeRevisionByLogId, type RevisionLogInput } from "@/lib/revisionByLogId";

// Neil's real situation: he logs essentially everything under the same
// generic name+account, so the name+account guess collapses 100+ separate
// tasks into one identity. Task 4027 got a real revision; task 4147 (a
// brand-new, unrelated submission) never did — but shared the guess's key.
const NEIL = "2be89118-034a-4632-a611-87c9b6b16742";
const NAME = "MinuteFlow Work";
const ACCOUNT = "Virtual Concierge";

const revisions = [{ assigned_task_id: 4027, created_at: "2026-09-17T00:45:12.066Z" }];

const revisedTasks = [
  { id: 4027, task_name: NAME, account: ACCOUNT, created_at: "2026-09-17T00:28:27.334Z" },
];

const revisedTaskAssignees = [{ assigned_task_id: 4027, va_id: NEIL }];

describe("computeRevisionByLogId", () => {
  it("tags the actually-revised task's own log", () => {
    const logs: RevisionLogInput[] = [
      { id: 6698, user_id: NEIL, task_name: NAME, account: ACCOUNT, start_time: "2026-09-17T01:00:00.000Z" },
    ];
    const map = computeRevisionByLogId(logs, revisions, revisedTasks, revisedTaskAssignees, []);
    expect(map.get(6698)).toBe(1);
  });

  it("the name+account guess alone leaks the badge onto an unrelated later log (the bug)", () => {
    // log 6950 belongs to task 4147, a completely different, never-revised
    // task — but shares 4027's name+account, so the guess alone tags it too.
    const logs: RevisionLogInput[] = [
      { id: 6950, user_id: NEIL, task_name: NAME, account: ACCOUNT, start_time: "2026-09-23T02:04:12.000Z" },
    ];
    const guessOnly = computeRevisionByLogId(logs, revisions, revisedTasks, revisedTaskAssignees, []);
    expect(guessOnly.get(6950)).toBe(1); // demonstrates the bug when no exact data is available
  });

  it("an exact assignees match clears the false positive on an unrevised task's own log", () => {
    const logs: RevisionLogInput[] = [
      { id: 6950, user_id: NEIL, task_name: NAME, account: ACCOUNT, start_time: "2026-09-23T02:04:12.000Z" },
    ];
    // We know for certain, via assigned_task_assignees, that log 6950 is
    // task 4147's own log — and 4147 has never been revised.
    const exactAssignees = [{ assigned_task_id: 4147, va_id: NEIL, log_id: 6950 }];
    const map = computeRevisionByLogId(logs, revisions, revisedTasks, revisedTaskAssignees, exactAssignees);
    expect(map.has(6950)).toBe(false);
  });

  it("both the revised task's log and an unrelated same-named log resolve correctly together", () => {
    const logs: RevisionLogInput[] = [
      { id: 6698, user_id: NEIL, task_name: NAME, account: ACCOUNT, start_time: "2026-09-17T01:00:00.000Z" },
      { id: 6950, user_id: NEIL, task_name: NAME, account: ACCOUNT, start_time: "2026-09-23T02:04:12.000Z" },
    ];
    const exactAssignees = [
      { assigned_task_id: 4027, va_id: NEIL, log_id: 6698 },
      { assigned_task_id: 4147, va_id: NEIL, log_id: 6950 },
    ];
    const map = computeRevisionByLogId(logs, revisions, revisedTasks, revisedTaskAssignees, exactAssignees);
    expect(map.get(6698)).toBe(1);
    expect(map.has(6950)).toBe(false);
  });

  it("does not tag a log for a different person even under the same name+account", () => {
    const someoneElse = "11111111-1111-1111-1111-111111111111";
    const logs: RevisionLogInput[] = [
      { id: 7001, user_id: someoneElse, task_name: NAME, account: ACCOUNT, start_time: "2026-09-23T02:04:12.000Z" },
    ];
    const map = computeRevisionByLogId(logs, revisions, revisedTasks, revisedTaskAssignees, []);
    expect(map.size).toBe(0);
  });

  it("a log with no revisions in the system at all gets no entry", () => {
    const logs: RevisionLogInput[] = [
      { id: 1, user_id: NEIL, task_name: "Something Else", account: "Other Account", start_time: "2026-09-23T00:00:00.000Z" },
    ];
    const map = computeRevisionByLogId(logs, [], [], [], []);
    expect(map.size).toBe(0);
  });
});
