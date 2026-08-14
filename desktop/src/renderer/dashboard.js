// ═══ Module state ═══
//
// Timer, renderSession/loadSessionState, doStartTask/attemptStartTask, and
// onClockIn/onClockOutClick/onLogout are UNCHANGED from the 1d layout — same
// ids, same logic. What changed for spec 1e ("Major course correction: To-Do
// items, not task creation"):
//   - The Log a Task form (renderer/taskForm.js + the #log-task-panel markup)
//     is REMOVED entirely — task creation is no longer this app's job (see
//     spec 1e point 1). Only formUtils.js's small word-limit helpers survive,
//     for the close-task modal's client memo field.
//   - The right-panel table now only ever shows "on_queue" tasks (taskManager
//     .listQueuedTasks) — the status filter dropdown and "show completed"
//     checkbox are gone with it (nothing left to filter/show).
//   - The left-panel Account → Project tree is now built directly from that
//     same on-queue task list (not a separate full account/project fetch),
//     which automatically satisfies "only show accounts/projects with at
//     least one On Queue task" (spec 1e point 4) — anything with none simply
//     never appears in the source data.
//   - The big left-panel Play button no longer submits a form (there isn't
//     one); it starts whichever task is currently selected in the right-panel
//     table, via the exact same start path as that row's own play icon.
//   - Task detail panel gained a To-Dos section: existing to-dos (already
//     embedded on each task from GET /api/assigned-tasks?selfOnly=true — see
//     taskManager.listQueuedTasks) plus an input to add a new one via the
//     real task_todos API (src/lib/taskTodos.ts's addTodo, called through
//     webApiClient.addTaskTodo).

let session = null; // full sessions row, from window.mfSession.getState()
let starting = false; // guards Start Activity + table/tree Start actions (mirrors taskManager's lock)
let clockActionPending = false; // guards Clock In / Clock Out buttons

let timerInterval = null;
let activeTaskStartMs = null;
let todayBaseMs = 0; // today's tracked time from completed logs (live task time is added on top while ticking)

let allTasks = []; // on_queue-only task list from window.mfTasks.listQueued()
let selectedAssigneeId = null; // currently selected task-table row (drives the detail panel + big Play button)
let expandedAccounts = new Set();
let leftSearchQuery = "";
let selectedAccount = null; // left-tree account filter
let selectedProjectName = null; // left-tree project filter (only meaningful alongside selectedAccount)
let categoryFilter = "";
let taskSearchQuery = "";

// ═══ Timer (unchanged) ═══

function formatElapsed(ms) {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  const s = totalSeconds % 60;
  const pad = (n) => String(n).padStart(2, "0");
  return `${pad(h)}:${pad(m)}:${pad(s)}`;
}

// "Today" stat formatter (Xh Ym / Ym) for the left-panel stats row.
function formatHoursMinutes(ms) {
  const totalMinutes = Math.floor(Math.max(0, ms) / 60000);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return hours > 0 ? `${hours}h ${String(minutes).padStart(2, "0")}m` : `${minutes}m`;
}

function stopTimer() {
  if (timerInterval) clearInterval(timerInterval);
  timerInterval = null;
  activeTaskStartMs = null;
}

function startTimer(startTimeIso) {
  stopTimer();
  activeTaskStartMs = new Date(startTimeIso).getTime();
  const tick = () => {
    const elapsed = Date.now() - activeTaskStartMs;
    document.getElementById("timer").textContent = formatElapsed(elapsed);
    // Keep the "Today" stat live while a task is running, on the same tick.
    document.getElementById("today-total").textContent = formatHoursMinutes(todayBaseMs + elapsed);
  };
  tick();
  timerInterval = setInterval(tick, 1000);
}

// ═══ Error banner (unchanged) ═══

function showError(message) {
  const banner = document.getElementById("error-banner");
  if (!message) {
    banner.hidden = true;
    banner.textContent = "";
    return;
  }
  banner.hidden = false;
  banner.textContent = message;
}

// ═══ Session (Clock In / active task / Clock Out) rendering (unchanged) ═══

function renderSession() {
  const clockinCard = document.getElementById("clockin-card");
  const activeCard = document.getElementById("active-card");

  const activeTask = session?.active_task && !session.active_task.isBreak ? session.active_task : null;

  if (!session?.clocked_in) {
    clockinCard.hidden = false;
    activeCard.hidden = true;
    stopTimer();
    document.getElementById("active-task-name").textContent = "No active task";
    document.getElementById("active-task-meta").textContent = "";
    document.getElementById("timer").textContent = "00:00:00";
    return;
  }

  clockinCard.hidden = true;
  activeCard.hidden = false;

  if (activeTask) {
    document.getElementById("active-task-name").textContent = activeTask.task_name;
    const meta = [activeTask.account, activeTask.project].filter(Boolean).join(" · ");
    document.getElementById("active-task-meta").textContent = meta;
    startTimer(activeTask.start_time);
  } else {
    document.getElementById("active-task-name").textContent = "Clocked in — no active task";
    document.getElementById("active-task-meta").textContent = "";
    stopTimer();
    document.getElementById("timer").textContent = "00:00:00";
  }
}

async function loadSessionState() {
  const result = await window.mfSession.getState();
  if (result.ok) {
    session = result.session;
    renderSession();
  } else if (result.error) {
    showError(result.error);
  }
}

// ═══ Today's tracked time (unchanged) ═══

async function loadTodayTracked() {
  const result = await window.mfStats.getTodayTracked();
  if (result.ok) {
    todayBaseMs = result.trackedMs;
    // If a task is actively ticking, the tick() loop already keeps this current;
    // otherwise (idle/just loaded) render the static base value here.
    if (!timerInterval) {
      document.getElementById("today-total").textContent = formatHoursMinutes(todayBaseMs);
    }
  }
}

// ═══ Starting a task (big Play button / table row Play) — start path unchanged ═══
//
// If there's already an active task, show the shared close-task confirm
// dialog first (status + memo) — same trigger as TaskEntryForm.tsx's
// "close old task" wizard and handlePlayAssignedTask. Otherwise start
// directly. Both entry points below funnel through this same pair of
// functions and the same IPC call, so the reentrancy guard/DB-truth-close
// logic in taskManager.js is identical no matter which button was clicked.

function setStarting(value) {
  starting = value;
  // Every "start a task" trigger (the big Play button and each table row's
  // small play icon) shares this class, so one guard covers all of them.
  // Icon-only buttons keep their icon — only a CSS state changes.
  document.querySelectorAll(".task-start-btn").forEach((btn) => {
    btn.disabled = value;
    btn.classList.toggle("is-starting", value);
  });
  // The big Play button has an extra condition on top of "not starting" —
  // it also needs a valid table selection — so re-derive its disabled state
  // from current selection rather than trusting the blanket loop above.
  updatePlayButtonState();
}

async function doStartTask(payload) {
  setStarting(true);
  showError(null);
  const result = await window.mfTasks.start(payload);
  setStarting(false);

  if (!result.ok) {
    showError(result.error);
    return result;
  }
  if (result.warning) showError(result.warning);
  await refreshAll();
  return result;
}

async function attemptStartTask(payload) {
  const activeTask = session?.active_task && !session.active_task.isBreak ? session.active_task : null;

  if (activeTask) {
    mfOpenCloseTaskModal("switch", activeTask.task_name, async (fields) => {
      return doStartTask({
        ...payload,
        oldTaskClose: {
          status: fields.status,
          clientMemo: fields.clientMemo,
          internalMemo: fields.internalMemo,
        },
      });
    });
    return;
  }

  await doStartTask(payload);
}

// Table row's small play icon — starts that specific already-queued task.
function onTableRowPlay(task) {
  attemptStartTask({
    task_name: task.task_name,
    account: task.account,
    project: task.project,
    category: task.category || "Task",
    client_memo: task.task_detail || "",
    assignedTaskId: task.assignedTaskId,
  });
}

// The big left-panel Play button starts whichever task is currently selected
// in the right-panel table (see updatePlayButtonState) — same start path as
// that row's own play icon, just triggered from the left panel. There's no
// "quick start from scratch" anymore: with the Log a Task form gone, the big
// Play button can only ever act on an already-queued, already-selected task.
function onPlayButtonClick() {
  const task = allTasks.find((t) => t.assigneeId === selectedAssigneeId);
  if (!task) return;
  onTableRowPlay(task);
}

function updatePlayButtonState() {
  const btn = document.getElementById("play-btn");
  const hasSelection = allTasks.some((t) => t.assigneeId === selectedAssigneeId);
  btn.disabled = starting || !hasSelection;
}

// ═══ Clock In / Clock Out (unchanged) ═══

async function onClockIn() {
  if (clockActionPending) return;
  clockActionPending = true;
  const btn = document.getElementById("clockin-btn");
  btn.disabled = true;
  btn.textContent = "Clocking in…";
  showError(null);

  const result = await window.mfSession.clockIn();

  clockActionPending = false;
  btn.disabled = false;
  btn.textContent = "Clock In";

  if (!result.ok) {
    showError(result.error);
    return;
  }
  await refreshAll();
}

async function onClockOutClick() {
  const activeTask = session?.active_task && !session.active_task.isBreak ? session.active_task : null;

  if (activeTask) {
    mfOpenCloseTaskModal("clockout", activeTask.task_name, async (fields) => {
      const result = await window.mfSession.closeTaskAndClockOut(fields);
      if (result.ok) await refreshAll();
      return result;
    });
    return;
  }

  if (clockActionPending) return;
  clockActionPending = true;
  showError(null);
  const result = await window.mfSession.clockOut();
  clockActionPending = false;

  if (!result.ok) {
    showError(result.error);
    return;
  }
  await refreshAll();
}

// ═══ Left panel: Account → Project browsable tree (spec 1e: on-queue-only) ═══
//
// Built directly from `allTasks` (already on_queue-only — see
// taskManager.listQueuedTasks) instead of a separate full account/project
// fetch. This is what makes "only show accounts/projects with at least one
// On Queue task" (spec 1e point 4) automatic: an account/project with
// nothing queued simply never appears in allTasks, so it never appears here.
// Clicking a node filters the right-panel table (see filteredTasks) instead
// of feeding a task-creation form.

function matchesSearch(text, query) {
  return !query || (text || "").toLowerCase().includes(query.toLowerCase());
}

function buildAccountProjectMap() {
  const map = new Map(); // account -> Set(project names)
  allTasks.forEach((t) => {
    if (!t.account) return;
    if (!map.has(t.account)) map.set(t.account, new Set());
    if (t.project) map.get(t.account).add(t.project);
  });
  return map;
}

function renderAccountTree() {
  const container = document.getElementById("account-tree");
  container.innerHTML = "";

  const accountMap = buildAccountProjectMap();
  const accounts = [...accountMap.keys()]
    .filter((account) => {
      if (!leftSearchQuery) return true;
      if (matchesSearch(account, leftSearchQuery)) return true;
      return [...accountMap.get(account)].some((p) => matchesSearch(p, leftSearchQuery));
    })
    .sort();

  if (accounts.length === 0) {
    container.innerHTML = '<p class="muted">No queued tasks.</p>';
    return;
  }

  accounts.forEach((account) => {
    const isExpanded = expandedAccounts.has(account) || Boolean(leftSearchQuery);
    const projects = [...accountMap.get(account)].filter((p) => matchesSearch(p, leftSearchQuery)).sort();

    const accountRow = document.createElement("button");
    accountRow.type = "button";
    accountRow.className =
      "tree-account-row" + (selectedAccount === account && !selectedProjectName ? " tree-row-active" : "");
    accountRow.innerHTML = `<span class="tree-caret">${isExpanded ? "▾" : "▸"}</span><span>${account}</span>`;
    accountRow.addEventListener("click", () => onSelectAccount(account));
    container.appendChild(accountRow);

    if (isExpanded) {
      projects.forEach((project) => {
        const projectRow = document.createElement("button");
        projectRow.type = "button";
        projectRow.className =
          "tree-project-row" +
          (selectedAccount === account && selectedProjectName === project ? " tree-row-active" : "");
        projectRow.textContent = project;
        projectRow.addEventListener("click", () => onSelectProject(account, project));
        container.appendChild(projectRow);
      });
      if (projects.length === 0) {
        const empty = document.createElement("p");
        empty.className = "muted tree-empty";
        empty.textContent = "No projects.";
        container.appendChild(empty);
      }
    }
  });
}

function updateRightSubtitle() {
  const el = document.getElementById("right-subtitle");
  if (selectedAccount && selectedProjectName) el.textContent = `${selectedAccount} · ${selectedProjectName}`;
  else if (selectedAccount) el.textContent = selectedAccount;
  else el.textContent = "All accounts";
}

// Clicking an account row both expands/collapses it AND toggles it as the
// table's account filter — clicking the same account again (with no project
// drilled into) clears the filter back to "All accounts".
function onSelectAccount(account) {
  if (expandedAccounts.has(account)) expandedAccounts.delete(account);
  else expandedAccounts.add(account);

  if (selectedAccount === account && !selectedProjectName) {
    selectedAccount = null;
  } else {
    selectedAccount = account;
    selectedProjectName = null;
  }

  updateRightSubtitle();
  renderAccountTree();
  applyAndRenderTaskTable();
}

function onSelectProject(account, project) {
  expandedAccounts.add(account);
  selectedAccount = account;
  selectedProjectName = project;
  updateRightSubtitle();
  renderAccountTree();
  applyAndRenderTaskTable();
}

// ═══ Right panel: task table + filters + detail panel (spec 1e: on-queue-only) ═══
//
// Data comes from window.mfTasks.listQueued() (taskManager.listQueuedTasks,
// which reuses the same webApiClient.fetchAssignedTasksSelf() call as
// before, filtered to status "on_queue" — see spec 1e point 3). Filtering/
// search/detail are pure client-side rendering over that already-fetched
// array. The broader status filter dropdown and "show completed" checkbox
// from the 1d layout are gone — there's nothing left to filter since every
// row here is already On Queue.

const COMPLETED_LIKE_STATUSES = ["completed", "paid", "cancelled"];

function statusLabel(status) {
  return status.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

function formatShortDate(iso) {
  if (!iso) return "—";
  const d = new Date(iso.length <= 10 ? `${iso}T12:00:00Z` : iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function populateFilterOptions() {
  const categorySelect = document.getElementById("category-filter");
  const currentValue = categorySelect.value;
  const categories = [...new Set(allTasks.map((t) => t.category).filter(Boolean))].sort();
  categorySelect.innerHTML = '<option value="">All Categories</option>';
  categories.forEach((cat) => {
    const opt = document.createElement("option");
    opt.value = cat;
    opt.textContent = cat;
    categorySelect.appendChild(opt);
  });
  categorySelect.value = categories.includes(currentValue) ? currentValue : "";
}

function filteredTasks() {
  return allTasks.filter((t) => {
    if (selectedAccount && t.account !== selectedAccount) return false;
    if (selectedProjectName && t.project !== selectedProjectName) return false;
    if (categoryFilter && t.category !== categoryFilter) return false;
    if (taskSearchQuery) {
      const haystack = `${t.task_name} ${t.task_detail || ""}`.toLowerCase();
      if (!haystack.includes(taskSearchQuery.toLowerCase())) return false;
    }
    return true;
  });
}

function renderTaskTable(tasks) {
  const tbody = document.getElementById("task-table-body");
  tbody.innerHTML = "";

  if (tasks.length === 0) {
    tbody.innerHTML = '<tr><td colspan="5" class="muted">No matching tasks.</td></tr>';
    return;
  }

  tasks.forEach((task) => {
    const row = document.createElement("tr");
    row.className = "task-row" + (task.assigneeId === selectedAssigneeId ? " task-row-selected" : "");
    row.addEventListener("click", () => onTableRowClick(task));

    const nameCell = document.createElement("td");
    nameCell.textContent = task.task_name;
    row.appendChild(nameCell);

    const statusCell = document.createElement("td");
    const badge = document.createElement("span");
    badge.className = `badge badge-${task.status}`;
    badge.textContent = statusLabel(task.status);
    statusCell.appendChild(badge);
    row.appendChild(statusCell);

    const categoryCell = document.createElement("td");
    categoryCell.textContent = task.category || "—";
    row.appendChild(categoryCell);

    const dateCell = document.createElement("td");
    dateCell.textContent = formatShortDate(task.due_date || task.start_date || task.created_at);
    row.appendChild(dateCell);

    const actionCell = document.createElement("td");
    if (task.status === "on_queue") {
      const playBtn = document.createElement("button");
      playBtn.className = "icon-btn task-start-btn";
      playBtn.type = "button";
      playBtn.title = "Start this task";
      playBtn.innerHTML = '<svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><polygon points="5,3 19,12 5,21" /></svg>';
      playBtn.disabled = starting;
      playBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        onTableRowPlay(task);
      });
      actionCell.appendChild(playBtn);
    }
    row.appendChild(actionCell);

    tbody.appendChild(row);
  });
}

function applyAndRenderTaskTable() {
  const tasks = filteredTasks();
  renderTaskTable(tasks);
  document.getElementById("status-bar-count").textContent = `Showing ${tasks.length} of ${allTasks.length} tasks`;
}

async function loadQueuedTasks() {
  const result = await window.mfTasks.listQueued();
  if (!result.ok) {
    document.getElementById("task-table-body").innerHTML =
      `<tr><td colspan="5" class="muted">Couldn't load tasks: ${result.error}</td></tr>`;
    return;
  }
  allTasks = result.tasks;
  populateFilterOptions();
  renderAccountTree();
  applyAndRenderTaskTable();

  // Keep the detail panel in sync if its task dropped off the on-queue list
  // (started, completed, or unassigned elsewhere) since the last fetch.
  if (selectedAssigneeId != null) {
    const stillThere = allTasks.find((t) => t.assigneeId === selectedAssigneeId);
    if (stillThere) renderDetailPanel(stillThere);
    else closeDetailPanel();
  }
  updatePlayButtonState();
}

function onTableRowClick(task) {
  selectedAssigneeId = task.assigneeId;
  renderDetailPanel(task);
  applyAndRenderTaskTable(); // re-render to update the selected-row highlight
  updatePlayButtonState();
}

function closeDetailPanel() {
  selectedAssigneeId = null;
  document.getElementById("detail-panel").hidden = true;
  updatePlayButtonState();
}

// ═══ Detail panel: task info + To-Dos (spec 1e point 2) ═══
//
// Existing to-dos ride along on the task object already (see
// taskManager.listQueuedTasks — the /api/assigned-tasks?selfOnly=true
// response embeds task_todos per task, no separate fetch needed to display
// them). Adding one calls the real API via window.mfTasks.addTodo
// (webApiClient.addTaskTodo -> POST /api/assigned-tasks/:id/todos).

function renderTodoList(todos) {
  const list = document.getElementById("detail-todo-list");
  list.innerHTML = "";
  if (!todos || todos.length === 0) {
    list.innerHTML = '<li class="muted">No to-dos yet.</li>';
    return;
  }
  todos.forEach((todo, i) => {
    const li = document.createElement("li");
    li.className = "todo-item";
    const label = document.createElement("span");
    label.className = "todo-item-label";
    // TD1/TD2/... derived from position, same as todoLabel() in src/lib/taskTodos.ts.
    label.textContent = `TD${i + 1}`;
    const text = document.createElement("span");
    text.textContent = todo.text;
    li.appendChild(label);
    li.appendChild(text);
    list.appendChild(li);
  });
}

function renderDetailPanel(task) {
  document.getElementById("detail-panel").hidden = false;
  document.getElementById("detail-task-name").textContent = task.task_name;
  document.getElementById("detail-meta").textContent =
    [task.account, task.project, statusLabel(task.status)].filter(Boolean).join(" · ");
  document.getElementById("detail-updated").textContent = task.updated_at
    ? `Last changed: ${new Date(task.updated_at).toLocaleString()}`
    : "";
  document.getElementById("detail-notes").textContent =
    task.task_notes || task.task_detail || "No additional details.";

  renderTodoList(task.todos);
  document.getElementById("detail-todo-input").value = "";
  document.getElementById("detail-todo-error").hidden = true;
  document.getElementById("detail-todo-add-btn").disabled = !task.assignedTaskId;

  const completeBtn = document.getElementById("detail-complete-btn");
  const alreadyDone = COMPLETED_LIKE_STATUSES.includes(task.status);
  completeBtn.hidden = alreadyDone;
  completeBtn.onclick = () => onCompleteSelectedTask(task);
}

async function onAddTodoClick() {
  const task = allTasks.find((t) => t.assigneeId === selectedAssigneeId);
  const errorEl = document.getElementById("detail-todo-error");
  errorEl.hidden = true;

  if (!task?.assignedTaskId) {
    errorEl.textContent = "Select a task first.";
    errorEl.hidden = false;
    return;
  }

  const input = document.getElementById("detail-todo-input");
  const text = input.value.trim();
  if (!text) {
    errorEl.textContent = "Enter some text for the to-do.";
    errorEl.hidden = false;
    return;
  }

  const btn = document.getElementById("detail-todo-add-btn");
  btn.disabled = true;
  const result = await window.mfTasks.addTodo(task.assignedTaskId, text);
  btn.disabled = false;

  if (!result.ok) {
    errorEl.textContent = result.error || "Couldn't add the to-do.";
    errorEl.hidden = false;
    return;
  }

  // Reload so the newly-added to-do (re-embedded on the task by the server)
  // shows up, same pattern doStartTask/onCompleteSelectedTask already use.
  await loadQueuedTasks();
}

async function onCompleteSelectedTask(task) {
  if (!task.assignedTaskId) return;
  const btn = document.getElementById("detail-complete-btn");
  btn.disabled = true;
  btn.textContent = "Completing…";

  const result = await window.mfTasks.setStatus(task.assignedTaskId, "completed");

  btn.disabled = false;
  btn.textContent = "Complete";

  if (!result.ok) {
    showError(result.error);
    return;
  }
  await loadQueuedTasks();
}

// ═══ Init / refresh / logout ═══

async function updateLastUpdated() {
  const now = new Date();
  document.getElementById("status-bar-updated").textContent = `Last updated at ${now.toLocaleTimeString()}`;
}

async function refreshAll() {
  await Promise.all([loadSessionState(), loadTodayTracked(), loadQueuedTasks()]);
  await updateLastUpdated();
}

async function onLogout() {
  stopTimer();
  await window.mfAuth.logout();
  await window.mfAuth.goLogin();
}

async function init() {
  const authSession = await window.mfAuth.getSession();
  if (!authSession.ok) {
    await window.mfAuth.goLogin();
    return;
  }

  document.getElementById("user-email").textContent = authSession.user.email;
  document.getElementById("logout-btn").addEventListener("click", onLogout);
  document.getElementById("refresh-btn").addEventListener("click", refreshAll);
  document.getElementById("clockin-btn").addEventListener("click", onClockIn);
  document.getElementById("clockout-btn").addEventListener("click", onClockOutClick);
  document.getElementById("play-btn").addEventListener("click", onPlayButtonClick);
  document.getElementById("play-btn").classList.add("task-start-btn");

  mfInitCloseTaskModal();

  // Left panel: search over the on-queue-derived account/project tree
  document.getElementById("left-search").addEventListener("input", (e) => {
    leftSearchQuery = e.target.value;
    renderAccountTree();
  });

  // Right panel: filters + detail panel close/complete/add-todo
  document.getElementById("category-filter").addEventListener("change", (e) => {
    categoryFilter = e.target.value;
    applyAndRenderTaskTable();
  });
  document.getElementById("task-search").addEventListener("input", (e) => {
    taskSearchQuery = e.target.value;
    applyAndRenderTaskTable();
  });
  document.getElementById("detail-close-btn").addEventListener("click", closeDetailPanel);
  document.getElementById("detail-todo-add-btn").addEventListener("click", onAddTodoClick);
  document.getElementById("detail-todo-input").addEventListener("keydown", (e) => {
    if (e.key === "Enter") onAddTodoClick();
  });

  renderAccountTree();
  updatePlayButtonState();

  // Live sync: refreshes whenever time_logs/sessions change for this user
  // (web app action, or another instance) — see realtimeSync.js.
  window.mfSync.onChanged(() => {
    refreshAll();
  });

  await refreshAll();
}

document.addEventListener("DOMContentLoaded", init);
