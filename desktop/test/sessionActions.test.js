const test = require("node:test");
const assert = require("node:assert/strict");
const {
  clockIn,
  performClockOut,
  closeTaskAndClockOut,
  startTask,
  closeAllOpenLogs,
  _resetForTests,
} = require("../src/taskManager");
const { makeState, makeMockSupabase } = require("./mockSupabase");

function makeDeps(state, overrides = {}) {
  const supabase = makeMockSupabase(state);
  return {
    supabase,
    webApiClient: { patchAssignedTaskStatus: async () => true },
    currentUser: { id: "va-1", username: "va1", fullName: "VA One", department: null, position: null },
    getSessionRow: async () => {
      const { data } = await supabase.from("sessions").select("*").eq("user_id", "va-1").maybeSingle();
      return data;
    },
    getOrgTimezone: async () => "America/New_York",
    ...overrides,
  };
}

test("clockIn creates a Clock In log and an active session", async () => {
  _resetForTests();
  const state = makeState();
  const deps = makeDeps(state);

  const result = await clockIn(deps);
  assert.ok(result.ok, result.error);
  assert.equal(result.activeTask.task_name, "Clock In");
  assert.equal(result.activeTask.category, "Planning");

  const log = state.time_logs.find((l) => l.task_name === "Clock In");
  assert.ok(log, "Clock In time_log should exist");
  assert.equal(log.account, "Virtual Concierge");

  const session = state.sessions.find((s) => s.user_id === "va-1");
  assert.equal(session.clocked_in, true);
  assert.equal(session.active_task.task_name, "Clock In");
});

test("clockIn and performClockOut share one lock: concurrent calls only let one through", async () => {
  _resetForTests();
  const state = makeState();
  state._insertDelay = () => new Promise((r) => setTimeout(r, 20));
  const deps = makeDeps(state);

  const [a, b] = await Promise.all([clockIn(deps), performClockOut(deps)]);
  const results = [a, b];
  const succeeded = results.filter((r) => r.ok);
  const rejected = results.filter((r) => !r.ok);
  assert.equal(succeeded.length, 1);
  assert.equal(rejected.length, 1);
  assert.match(rejected[0].error, /already in progress/i);
});

test("performClockOut closes orphaned open logs, writes mood/day rating, and adds a Clocked Out log", async () => {
  _resetForTests();
  const state = makeState();
  const deps = makeDeps(state);

  // Simulate a currently-active task that was never explicitly closed.
  await clockIn(deps);
  state.time_logs.push({
    id: 999,
    user_id: "va-1",
    category: "Task",
    task_name: "Orphan",
    start_time: new Date().toISOString(),
    end_time: null,
  });

  const result = await performClockOut(deps, { mood: "good", dayRating: 4, dayRatingNote: "It was a pretty good day overall" });
  assert.ok(result.ok, result.error);

  const orphan = state.time_logs.find((l) => l.id === 999);
  assert.ok(orphan.end_time, "orphaned open log should have been closed");

  const session = state.sessions.find((s) => s.user_id === "va-1");
  assert.equal(session.clocked_in, false);
  assert.equal(session.active_task, null);
  assert.equal(session.mood, "good");
  assert.equal(session.day_rating, 4);

  const moodLog = state.mood_logs.find((m) => m.user_id === "va-1");
  assert.ok(moodLog, "mood_logs row should have been written");
  assert.equal(moodLog.mood, "good");

  const clockedOutLog = state.time_logs.find((l) => l.category === "Clock Out");
  assert.ok(clockedOutLog, "Clocked Out boundary log should exist");
});

test("closeTaskAndClockOut requires status and at least one memo, same as the web app's disabled condition", async () => {
  _resetForTests();
  const state = makeState();
  const deps = makeDeps(state);
  await clockIn(deps);

  const noStatus = await closeTaskAndClockOut(deps, { clientMemo: "done" });
  assert.equal(noStatus.ok, false);
  assert.match(noStatus.error, /status is required/i);

  const noMemo = await closeTaskAndClockOut(deps, { status: "Completed" });
  assert.equal(noMemo.ok, false);
  assert.match(noMemo.error, /at least one memo/i);

  const shortRatingNote = await closeTaskAndClockOut(deps, {
    status: "Completed",
    clientMemo: "wrapped up",
    dayRating: 3,
    dayRatingNote: "too short",
  });
  assert.equal(shortRatingNote.ok, false);
  assert.match(shortRatingNote.error, /at least 5 words/i);
});

test("closeTaskAndClockOut closes the active task with memo, then clocks out", async () => {
  _resetForTests();
  const state = makeState();
  const deps = makeDeps(state);
  await clockIn(deps);

  const result = await closeTaskAndClockOut(deps, {
    status: "Completed",
    clientMemo: "Wrapped up the Clock In placeholder task",
  });
  assert.ok(result.ok, result.error);

  const clockInLog = state.time_logs.find((l) => l.task_name === "Clock In");
  assert.ok(clockInLog.end_time, "the active task's log should be closed");
  assert.equal(clockInLog.client_memo, "Wrapped up the Clock In placeholder task");

  const session = state.sessions.find((s) => s.user_id === "va-1");
  assert.equal(session.clocked_in, false);
});

test("startTask with oldTaskClose writes status+memo to the OLD task before switching", async () => {
  _resetForTests();
  const state = makeState();
  const deps = makeDeps(state);
  await clockIn(deps);

  const result = await startTask(deps, {
    task_name: "New Task",
    account: "Acct",
    project: "Proj",
    category: "Task",
    oldTaskClose: { status: "On Hold", clientMemo: "Pausing this one" },
  });
  assert.ok(result.ok, result.error);

  const clockInLog = state.time_logs.find((l) => l.task_name === "Clock In");
  assert.ok(clockInLog.end_time, "old task should be closed");
  assert.equal(clockInLog.progress, "on_hold");
  assert.equal(clockInLog.client_memo, "Pausing this one");

  const openLogs = state.time_logs.filter((l) => l.end_time == null);
  assert.equal(openLogs.length, 1);
  assert.equal(openLogs[0].task_name, "New Task");
});

test("closeAllOpenLogs caps an overnight straggler at 23:59:59.999 of its start day instead of running to now", async () => {
  _resetForTests();
  const state = makeState();
  const supabase = makeMockSupabase(state);
  // 3 days ago, so this is stable regardless of the machine's local timezone
  // (never accidentally lands on "now"'s calendar day).
  const staleStart = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString();
  state.time_logs.push({ id: 1, user_id: "va-1", category: "Task", start_time: staleStart, end_time: null });
  state._nextId = () => 2;

  const now = new Date().toISOString();
  await closeAllOpenLogs(supabase, "va-1", now);

  // Same local-time computation the implementation uses (dashboard/page.tsx's
  // closeOpenNonBreakLogs does `new Date(start_time).setHours(23,59,59,999)`,
  // i.e. end-of-day in the machine's local timezone, not the org timezone) —
  // asserting against that keeps this test correct on any runner's clock.
  const expectedEndOfDay = new Date(staleStart);
  expectedEndOfDay.setHours(23, 59, 59, 999);

  const log = state.time_logs.find((l) => l.id === 1);
  assert.equal(log.end_time, expectedEndOfDay.toISOString());
  assert.notEqual(log.end_time, now, "should NOT have been closed at `now` — that's the overnight bug this guards against");
  // Duration should be a matter of hours (to end of its own start day), not ~3 days (to `now`).
  assert.ok(log.duration_ms < 24 * 60 * 60 * 1000, `duration should be capped to its own day, got ${log.duration_ms}ms`);
});
