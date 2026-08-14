const test = require("node:test");
const assert = require("node:assert/strict");
const { startTask, closeAllOpenLogs, _resetForTests } = require("../src/taskManager");
const { makeState, makeMockSupabase } = require("./mockSupabase");

function makeDeps(state, overrides = {}) {
  return {
    supabase: makeMockSupabase(state),
    webApiClient: { patchAssignedTaskStatus: async () => true },
    currentUser: { id: "va-1", username: "va1", fullName: "VA One", department: null, position: null },
    getSessionRow: async () => null,
    getOrgTimezone: async () => "America/New_York",
    ...overrides,
  };
}

test("rapidly starting two tasks in a row leaves exactly one active", async () => {
  _resetForTests();
  const state = makeState();
  // Artificially widen the window between "read what's open" and "insert the
  // new row" so that, without the reentrancy guard, two concurrent calls
  // would very likely both slip through and both insert.
  state._insertDelay = () => new Promise((resolve) => setTimeout(resolve, 25));
  const deps = makeDeps(state);

  const [resultA, resultB] = await Promise.all([
    startTask(deps, { task_name: "Task A", account: "Acct", project: "Proj" }),
    startTask(deps, { task_name: "Task B", account: "Acct", project: "Proj" }),
  ]);

  const results = [resultA, resultB];
  const succeeded = results.filter((r) => r.ok);
  const rejected = results.filter((r) => !r.ok);

  assert.equal(succeeded.length, 1, "exactly one of the two concurrent Start calls should succeed");
  assert.equal(rejected.length, 1, "the other should be turned away by the reentrancy guard");
  assert.match(rejected[0].error, /already starting/i);

  const openLogs = state.time_logs.filter((log) => log.end_time == null);
  assert.equal(openLogs.length, 1, "exactly one time_log should be left open in the DB");

  const sessionRow = state.sessions.find((s) => s.user_id === "va-1");
  assert.equal(sessionRow.active_task.logId, String(openLogs[0].id), "session.active_task must point at the open log");
});

test("starting a second task sequentially closes the first (task switch, no manual end step)", async () => {
  _resetForTests();
  const state = makeState();
  const deps = makeDeps(state);

  const first = await startTask(deps, { task_name: "Task A" });
  assert.ok(first.ok, first.error);

  const second = await startTask(deps, { task_name: "Task B" });
  assert.ok(second.ok, second.error);

  const openLogs = state.time_logs.filter((log) => log.end_time == null);
  assert.equal(openLogs.length, 1);
  assert.equal(openLogs[0].task_name, "Task B");

  const closedA = state.time_logs.find((log) => log.task_name === "Task A");
  assert.ok(closedA.end_time, "Task A's log should have been closed automatically");
  assert.equal(typeof closedA.duration_ms, "number");
});

test("the reentrancy guard resets after a call finishes, so a later Start still works", async () => {
  _resetForTests();
  const state = makeState();
  const deps = makeDeps(state);

  const first = await startTask(deps, { task_name: "Task A" });
  assert.ok(first.ok);

  // Not concurrent this time — guard should be released again.
  const second = await startTask(deps, { task_name: "Task B" });
  assert.ok(second.ok, second.error);
});

test("closeAllOpenLogs closes multiple stray open logs but leaves Break/Clock Out alone", async () => {
  _resetForTests();
  const state = makeState();
  state.time_logs.push(
    { id: 1, user_id: "va-1", category: "Task", start_time: "2026-08-12T10:00:00.000Z", end_time: null },
    { id: 2, user_id: "va-1", category: "Task", start_time: "2026-08-12T10:05:00.000Z", end_time: null },
    { id: 3, user_id: "va-1", category: "Break", start_time: "2026-08-12T10:10:00.000Z", end_time: null },
    { id: 4, user_id: "va-1", category: "Clock Out", start_time: "2026-08-12T10:12:00.000Z", end_time: null }
  );
  state._nextId = () => 5;
  const supabase = makeMockSupabase(state);

  await closeAllOpenLogs(supabase, "va-1", "2026-08-12T10:20:00.000Z");

  const byId = Object.fromEntries(state.time_logs.map((log) => [log.id, log]));
  assert.ok(byId[1].end_time, "log 1 (Task) should be closed");
  assert.ok(byId[2].end_time, "log 2 (Task) should be closed");
  assert.equal(byId[3].end_time, null, "log 3 (Break) should be left open");
  assert.equal(byId[4].end_time, null, "log 4 (Clock Out) should be left open");
});
