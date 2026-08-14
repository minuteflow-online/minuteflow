# MinuteFlow Desktop (Electron) — Mini-Dashboard

Focused desktop mini-dashboard per `MinuteFlow_Desktop_App_Spec.md`, most
recently section 1e (Hubstaff-style two-panel layout: Clock In → start an
already-queued task → Clock Out loop, plus per-task to-dos, kept live via
Supabase Realtime — not a copy of the full web app).

## What it does

- Native window (Windows + Mac, via Electron)
- Log in with the **same Supabase auth** as the web app (same project, same
  anon key already used by `src/lib/supabase/client.ts` and
  `extension/supabase.js`) — VAs use their existing MinuteFlow email/password
- Session persists between launches (stored in a local JSON file under
  Electron's userData folder, used as the storage adapter for
  `@supabase/supabase-js`)
- **Clock In** — same "Clock In" / Planning / Set-up / Virtual Concierge
  boundary-marker log the web app creates (ported from `dashboard/page.tsx`'s
  `clockIn`, lines 1030-1138)
- **On Queue tasks only** from `GET /api/assigned-tasks?selfOnly=true` (same
  endpoint `AssignedTasksWidget.tsx` calls), filtered client-side to
  `status: "on_queue"` — task **creation** is explicitly not this app's job
  (spec 1e); that only happens in the web app's Productivity → Assignment →
  Create Task. The left-panel Account/Project tree is built from this same
  on-queue list, so an account/project with nothing queued never appears.
- **Start a task** — big left-panel Play button (starts whatever's selected
  in the table) or a row's own play icon; both funnel through the same
  single-active-task-safe start path
- **To-Dos** — the selected task's detail panel shows its existing to-do
  items (embedded on the task by the API, no extra fetch) and lets you add a
  new one, via the real `task_todos` API (`src/lib/taskTodos.ts`'s
  `addTodo`/`POST /api/assigned-tasks/:id/todos`) — internal-only sub-steps
  scoped to that specific queued task, not a way to create new work
- **Active-task timer**, ticking every second
- **Clock Out**, opening the same status+memo confirm step as
  `handleCloseTaskAndClockOut` (mood + day rating included, same validation)
- **Live sync** — Supabase Realtime `postgres_changes` on `time_logs` and
  `sessions` (see Caveat below), so actions taken on the web app (or another
  desktop instance) show up here without a manual refresh, and vice versa
- Log Out button, back to the login screen

Not implemented yet (later steps in the spec, section 5): screenshot
capture, heartbeat, idle detection, packaging/installers.

## ⚠️ Realtime caveat — can't be resolved from inside `desktop/`

`postgres_changes` only fires for tables added to the Supabase project's
`supabase_realtime` publication. The web app already relies on this for
`messages`/`capture_requests`, but per spec 1c it does **not** currently
subscribe to `time_logs`/`sessions` — so whether those two are in that
publication at all is unconfirmed. Enabling it (Supabase dashboard →
Database → Replication, or an `ALTER PUBLICATION` statement) is a DB-side
project config change, outside what any code under `desktop/` can do, and
outside the "don't touch supabase/migrations" boundary for this build. If
it's off, subscribing still succeeds silently — the callback just never
fires, and the dashboard falls back to whatever's fetched on the next manual
Refresh / app relaunch. The code is correct and ready either way; someone
with dashboard/migration access needs to confirm or enable it.

## Setup

```bash
cd desktop
npm install
npm start
```

Separate Node project (its own `package.json`) from the Next.js web app in
the repo root — doesn't affect `npm run dev`/`build`/`lint` for the web app,
and doesn't read or modify the web app's `.env.local`.

## Tests

```bash
cd desktop
npm test
```

Node's built-in test runner (`node --test`, no extra dependency). Covers:
- `test/taskManager.race.test.js` — single-active-task guarantee, including
  firing two `startTask()` calls concurrently and asserting exactly one wins
- `test/sessionActions.test.js` — `clockIn`/`performClockOut`/
  `closeTaskAndClockOut` behavior and validation (status required, ≥1 memo
  required, day-rating note ≥5 words), the shared `clockIn`/`performClockOut`
  lock, `startTask`'s `oldTaskClose` old-task status/memo write, and
  `closeAllOpenLogs`'s overnight end-of-day capping
- `test/sessionDate.test.js` — `getCorrectSessionDate` edge cases
- `test/webApiClient.cookie.test.js` — the `@supabase/ssr`-compatible cookie
  name/chunking/encoding used to call the web app's API routes

I don't have real VA login credentials, so this is verified with mocked
Supabase/Realtime — not a live click-through of the running app end to end.

## Where the web app's logic was reused, not rebuilt

| Desktop piece | Ported from (web app) |
|---|---|
| `taskManager.clockIn` | `dashboard/page.tsx` `clockIn` (~1030-1138) |
| `taskManager.performClockOut` | `dashboard/page.tsx` `performClockOut` (~1140-1276) |
| `taskManager.closeTaskAndClockOut` | `dashboard/page.tsx` `handleCloseTaskAndClockOut` (~1294-1358) + the Clock Out modal's validation (~3862-3867) |
| `taskManager.startTask` / `closeAllOpenLogs` | `dashboard/page.tsx` `startTask` (~2067-2387) / `closeOpenNonBreakLogs` (~828-898) |
| `taskManager.applyOldTaskClose` | `TaskEntryForm.tsx`'s `submitTask` old-task-update block (~2141-2158 in `dashboard/page.tsx`) |
| `renderer/formUtils.js` | `TaskEntryForm.tsx`'s word-limit constants/helpers (`countWords`/`limitToWords`), the only pieces of the old Log a Task form still needed, now just for the close-task modal's memo field |
| `renderer/closeTaskModal.js` | `TaskEntryForm.tsx`'s "close old task" wizard + `dashboard/page.tsx`'s Clock Out modal — **consolidated into one shared dialog** (see below) |
| `src/sessionDate.js` | `dashboard/page.tsx`'s `getCorrectSessionDate`, verbatim |
| `src/realtimeSync.js` | `dashboard/page.tsx`'s `messages-for-user`/`capture-requests-for-user` `.channel().on("postgres_changes",...)` pattern (~648-661) |
| `src/webApiClient.js` | Calls the exact same API routes `AssignedTasksWidget.tsx`, `assignedTaskStatus.ts`, and `src/lib/taskTodos.ts`'s `addTodo` use |

**Removed in spec 1e** ("Major course correction: To-Do items, not task
creation" — Aug 13 boss voicemail): the Log a Task form (`renderer/taskForm.js`
and its Account/Project/Task/Category creation UI), and the
`/api/task-form-options` plumbing that only existed to feed it
(`forms:getTaskOptions` IPC handler, `mfForms` preload bridge,
`webApiClient.fetchTaskFormOptions`). Creating new work is now exclusively a
web app job (Productivity → Assignment → Create Task); this app only starts
what's already On Queue and adds to-dos under it.

**Deliberate consolidation:** the web app has two near-identical status+memo
confirm modals (TaskEntryForm's "close old task" wizard, and the Clock Out
modal). `closeTaskModal.js` shares **one** dialog for both — same validation
rules as each (status required, ≥1 memo required; Clock Out adds optional
mood + day rating with the same ≥5-word note rule) — rather than duplicating
near-identical UI code. This is a UI simplification, not a rules change.

**Deliberately left out** (not in spec 1c's field list, and each pulls in a
substantially separate flow): fixed-pay task billing/rate + the "log-fixed"
wizard, task rating stars, memo-writing-guide popovers, Break's
pause/resume semantics, and the SCE (browser extension) heartbeat check +
notification-permission request that `clockIn` also does on the web.

**Known, pre-existing web app quirk carried over as-is:** in
`handleCloseTaskAndClockOut`, `clockOutTaskStatus` is required for the
Clock Out confirm button to enable, but is never written to the closed
task's `time_logs.progress` column — `taskManager.closeTaskAndClockOut`
reproduces this exactly (status required to proceed, not persisted), since
the ask here was to reuse the existing logic/validation, not to fix
unrelated behavior found while porting it.

## Structure

```
desktop/
  src/
    main.js                Electron main process: window, Supabase client, IPC handlers, realtime lifecycle
    preload.js               contextBridge — exposes window.mfAuth / mfTasks / mfSession / mfSync
    sessionStore.js           File-based storage adapter for supabase-js session persistence
    webApiClient.js            Calls the web app's API routes (cookie-authenticated)
    taskManager.js              Clock In/Out + task start/switch logic (single-active-task, race-safe)
    realtimeSync.js              postgres_changes subscription on time_logs/sessions
    sessionDate.js                getCorrectSessionDate, ported verbatim from dashboard/page.tsx
    config.js                    Supabase URL/anon key + web app base URL (public values, same as the extension)
    renderer/
      login.html / login.js
      dashboard.html / dashboard.js    Clock In/Out, active timer, On Queue tasks, to-dos
      formUtils.js                      Word-limit helpers shared by the close-task modal
      closeTaskModal.js                  Shared status+memo(+mood/rating) confirm dialog
      styles.css                        MinuteFlow color palette (AGENTS.md)
  test/
    mockSupabase.js
    taskManager.race.test.js
    sessionActions.test.js
    sessionDate.test.js
    webApiClient.cookie.test.js
```
