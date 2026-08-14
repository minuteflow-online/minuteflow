const test = require("node:test");
const assert = require("node:assert/strict");
const { getTodayTrackedMs, listQueuedTasks } = require("../src/taskManager");
const { makeState, makeMockSupabase } = require("./mockSupabase");

test("getTodayTrackedMs sums only today's time_logs for this user", async () => {
  const state = makeState();
  const tz = "America/New_York";
  const today = new Date().toLocaleDateString("en-CA", { timeZone: tz });
  state.time_logs.push(
    { id: 1, user_id: "va-1", session_date: today, duration_ms: 60000 },
    { id: 2, user_id: "va-1", session_date: today, duration_ms: 30000 },
    { id: 3, user_id: "va-1", session_date: "2000-01-01", duration_ms: 999999 }, // stale day, excluded
    { id: 4, user_id: "va-2", session_date: today, duration_ms: 999999 } // different user, excluded
  );
  const supabase = makeMockSupabase(state);

  const totalMs = await getTodayTrackedMs(supabase, "va-1", tz);
  assert.equal(totalMs, 90000);
});

test("listQueuedTasks filters to on_queue only, with table/detail fields plus embedded to-dos", async () => {
  const rows = [
    {
      id: 1,
      status: "completed",
      log_id: null,
      updated_at: "2026-08-10T00:00:00.000Z",
      assigned_tasks: {
        id: 101,
        task_name: "Old task",
        task_detail: "detail",
        task_notes: "notes",
        category: "Task",
        account: "Acct",
        project: "Proj",
        due_date: "2026-08-01",
        start_date: "2026-07-28",
        created_at: "2026-07-27T00:00:00.000Z",
        task_todos: [],
      },
    },
    {
      id: 2,
      status: "on_queue",
      log_id: null,
      assigned_tasks: {
        id: 102,
        task_name: "Queued task",
        task_todos: [
          { id: 2, text: "second", sort_order: 1 },
          { id: 1, text: "first", sort_order: 0 },
        ],
      },
    },
    {
      id: 3,
      status: "in_progress",
      log_id: 55,
      assigned_tasks: { id: 103, task_name: "Active task" },
    },
  ];
  const webApiClient = { fetchAssignedTasksSelf: async () => rows };

  const tasks = await listQueuedTasks(webApiClient);
  assert.equal(tasks.length, 1, "only the on_queue row should be returned");
  assert.equal(tasks[0].status, "on_queue");
  assert.equal(tasks[0].task_name, "Queued task");
  assert.equal(tasks[0].assignedTaskId, 102);
  assert.deepEqual(
    tasks[0].todos.map((t) => t.text),
    ["first", "second"],
    "todos should be sorted by sort_order, not insertion order"
  );
});
