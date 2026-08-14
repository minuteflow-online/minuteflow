# MinuteFlow — Desktop App Spec

**Purpose:** A native desktop app (Windows + Mac) that VAs install and log into, which:
1. Logs them in with their normal MinuteFlow account
2. Takes occasional screenshots while they're clocked in
3. Tracks idle vs. active status

---

## 1. What already exists (reuse this, don't rebuild it)

The browser extension already solves the screenshot half of this problem — same backend, same rules apply to the desktop app:

- **Upload endpoint:** `/api/upload-screenshot` — receives the image, sends it to Google Drive, and records a `task_screenshots` row with just the Drive file ID.
- **Hard rule (from AGENTS.md/CLAUDE.md):** Screenshots go to **Google Drive only, never Supabase Storage.** This applies to the desktop app too — same endpoint, same rule, no exceptions.
- **Local-first upload pattern:** the extension saves a screenshot locally first, then uploads, and only deletes the local copy once Drive confirms receipt — this survives network drops without losing data. Worth copying this pattern for the desktop app.
- **Heartbeat pattern:** the extension pings the server periodically so admins can see it's alive, via an `extension_heartbeats`-style table. The desktop app should do the same, so it shows up correctly in the Admin "Live Team Monitor" you saw earlier.
- **Login:** the web app uses Supabase's standard browser auth client. The desktop app can use the same approach (Supabase has a version of this made for Electron/desktop apps), meaning **VAs log in with the exact same email/password** they already use for the web app — no separate account system needed.

---

## 1a. Layout decision: focused mini-dashboard, NOT the full web app (confirmed with boss)

**Correction from an earlier version of this spec:** we initially considered embedding the entire web app inside the desktop window (Slack/Claude-style). Boss has now clarified she wants the **Hubstaff-style pattern instead** — a small, focused window, not the full app.

**What the desktop app should actually show:**
- The VA's current **queued/assigned tasks** — same data as the web app's "Assigned Tasks" panel, pulled live from the same source (`/api/assigned-tasks?selfOnly=true` already exists and is used by the web dashboard — reuse it, don't duplicate).
- A way to **start ("clock in to") a task** from the queue.
- The **active timer** while a task is running.
- **Switch task** — same concept as the web app's task-switching, simplified.
- **Clock out / close task** — ends the current task.

**What it should NOT show:** admin panel, invoices, reports, team page, portal, full task management, scheduling. Scheduling and queueing tasks happens in the **web app** (browser) — the desktop app is a focused *execution* tool for whatever's already been queued, not a management tool.

**Why this matters to her (her own words, paraphrased):** the goal is to help VAs **stay focused** — the desktop app should be simple on purpose, not a smaller copy of everything.

**Build approach:** this rules out embedding `localhost:3000` — go back to building small, custom Electron screens (like the original login/dashboard shell already built), styled with the MinuteFlow palette, but now showing real queued-task data instead of a placeholder. This is closer to Hubstaff's actual approach: a lightweight native agent, not a wrapped website.

## 1b. Sync, single-active-task rule, and quality requirements (confirmed with boss)

**Sync with the web app:** Automatic, by design — the desktop app reads/writes the same Supabase tables (`assigned_tasks`, `time_logs`, `sessions`) via the same APIs the web app already uses. A task queued on the web shows up on the desktop app's next refresh, and vice versa. No separate sync mechanism needs to be built.

**Single active task rule:** Only one task can be active at a time. Starting a new task automatically ends/closes the current one — there is no separate "manually end this task, then separately start the next" flow. This mirrors the web app's existing task-switching behavior (see `TaskEntryForm.tsx`) exactly — **reuse that logic/pattern, don't reinvent it.**

**Bug-prevention requirements (explicit, based on issues already found in this codebase during code review):**
1. **Avoid the race-condition pattern found in task-claiming** (`src/app/api/claimable-tasks/route.ts`) — that code checks "is a slot available," then inserts as two separate steps with nothing enforcing atomicity in between, which can let two actions succeed when only one should. The single-active-task rule must be enforced safely — e.g., checked and closed as close to atomically as possible, not just prevented in the UI (a user could otherwise trigger two "start task" actions in quick succession and end up with two active tasks).
2. **Avoid the session_date drift bug found in `capture-alerts/route.ts`** — that route computed its own date instead of using the app's shared, timezone-aware date logic (`getCorrectSessionDate` in `dashboard/page.tsx`), causing entries to get mis-dated near midnight. Any new task-start/task-end logic in the desktop app must use that same shared date logic, not a new inline `new Date()` calculation.
3. Before considering this feature done, explicitly test: rapidly starting two tasks in a row (does it cleanly end the first and start the second, or create two active tasks?), and starting a task near midnight in the org's timezone (does it get the correct date?).

## 1c. Live sync fix + full Clock In / Log a Task / Clock Out parity (added after live testing, Aug 12)

**What testing revealed:**
- The desktop app only fetches task/session state once (on load or manual Refresh). Actions taken in the web app (logging a task, ending a task) don't appear on desktop until manually refreshed, and vice versa.
- What looked like "desktop won't stop the timer" was actually two separate issues: (a) the sync gap above, and (b) a genuine, separate server-side bug where Clock Out fails silently for manager-role accounts (a row-level-security permission error on the `sessions` table) — **this second one is not a desktop app bug and has been escalated separately.** The desktop app was actually correctly reflecting real (unchanged) server state in that case.
- The desktop app currently only supports starting *already-queued* tasks. It should instead mirror the full Clock In → Log a Task → Clock Out loop from the web app, not just "start what's pre-queued."

**Fix 1 — Real-time sync (desktop side):**
The web app already uses Supabase Realtime elsewhere in the codebase (`.channel(...)` + `postgres_changes`, used for messages and capture-requests — see `dashboard/page.tsx` around line 648). The desktop app should use the same pattern: subscribe to `postgres_changes` on `time_logs` and `sessions` filtered to the logged-in user's `user_id`, so it updates live when those rows change — no manual refresh needed.

> **Note:** the web app itself does *not* currently subscribe to realtime changes on `time_logs`/`sessions` — so if the desktop app starts a task, the web dashboard won't show it live either, without the web app also getting a similar subscription added. That's a change to the *main app*, not the desktop app, and should be coordinated with your boss/Manny rather than done unilaterally from here, since it touches shared, actively-developed files.

**Fix 2 — Full Clock In / Log a Task / Clock Out on desktop, mirroring the web app's actual two-layer model:**
The web app has two layers, not one — worth mirroring exactly rather than simplifying, to avoid confusing behavior differences between web and desktop:
1. **Session level ("Clocked In")** — started via the top-level Clock In button, ends via Clock Out. This is the overall "I'm working" boundary for the day.
2. **Task level (the active task)** — started via the Log a Task form (Account, Project, Task, Category, Client Notes), ends automatically when a new task is logged, or when Clock Out is pressed (which opens a confirmation step requiring task status + a memo, exactly like the web app).

**Desktop UI should include:**
- Clock In button (session start)
- Log a Task form: Account, Project, Task, Category, Client Notes — same fields/validation as the web app's `TaskEntryForm.tsx`, reusing its logic rather than rebuilding validation from scratch
- Active task display with live timer
- Clock Out button, with the same confirm-with-status-and-memo step the web app uses (`handleCloseTaskAndClockOut`) — reuse that logic/validation, don't reinvent simplified rules

## 1d. Layout redesign: Hubstaff-style two-panel window (Aug 13)

Boss shared a reference screenshot of the actual Hubstaff desktop app and wants the MinuteFlow desktop app's layout to follow the same structure. Also: **make the window bigger** — current size is too small/cramped for this layout.

**Reference layout, translated to MinuteFlow's actual concepts:**

**Left panel (narrower):**
- Large timer display at the top (`00:00:00` style, big and bold)
- Current active task name below the timer (or "No active task" placeholder)
- Large circular Play/Start button, centered
- A stats row below it (Hubstaff shows "No limits / Today: 0:00" — MinuteFlow equivalent: today's total tracked time, similar to the web dashboard's "Xh Ym tracked today")
- A search box to filter projects/accounts
- A list below that: Accounts, each expandable to show their Projects — clicking a project selects it as the current context for starting work (this replaces Hubstaff's project-tree with MinuteFlow's Account → Project structure)

**Right panel (wider):**
- Header: "Tasks" (or similar) with the currently selected project as a subtitle
- Filter row: a status filter dropdown, a category filter dropdown, a "show completed" checkbox, and a search box
- "Log a new task" input row (mirrors Hubstaff's "Create a to-do" input) — though for MinuteFlow this likely opens the full Log a Task form (Account/Project/Task/Category/Notes) rather than a single text field, since our task model has more required fields than Hubstaff's simple to-do
- A table of tasks: columns for Task name and a relevant date (Created, or Start/Due Date, matching what's already in `assigned_tasks`), each row with a small play button to start that task directly, plus edit/delete icons where relevant
- Selecting a row shows task details in a panel below the table (task name, last changed date, notes/description, and action buttons like "Complete")

**Bottom status bar:** "Last updated at [time]" and a task count summary (e.g., "Showing X of Y tasks") — small, unobtrusive, matches the reference.

**Style notes:**
- Keep MinuteFlow's existing color palette (cream/sand/espresso/sage) — don't adopt Hubstaff's dark title bar/blue accent colors, just the *structural layout* (two-panel split, timer placement, table+detail-panel pattern).
- This is a significant layout change from the current single-column design — worth treating as its own build task, separate from any further logic changes, so the diff is easy to review.

**What stays the same (don't rebuild):** all the underlying logic already built and tested — Clock In/Log a Task/Clock Out flow, the single-active-task rule, realtime sync, session date handling. This is a **visual/layout restructuring only**, wiring the same existing functions into a new arrangement.

## 1e. Major course correction: To-Do items, not task creation (Aug 13, from boss's voicemail)

**Boss's voicemail (transcribed) makes the actual intent clear, and it's a real change from what's been built so far.** Key points, direct from the transcript:

> "We only want to see the dashboard... it only shows the on queue items... anything that they will add here has to do, it needs to be connected to the existing tasks already that's on queue."

**What this means, concretely:**

1. **Remove the "Log a New Task" form entirely from the desktop app.** Creating brand-new tasks (Account/Project/Task/Category from scratch) is explicitly **not** the desktop app's job anymore. Task creation now happens only in the web app: **Productivity → Assignment → Create Task**, which has a full field set (Account, Objective, Task Name, Category, Schedule, Client Detail, Notes, Assignment, and a **To-Do List** section) and auto-assigns to the creating VA when a regular VA account creates it.

2. **Add a "To-Do" feature instead — scoped to tasks already on queue.** Confirmed this is a real, already-built backend feature: the web app's Create Task panel has a dedicated **To-Do List** section (see screenshot reference, Aug 13) with the description: *"Internal only — tracks sub-steps and time per item, shows in internal reports. Doesn't affect the client memo."* This is backed by a real `task_todos` table and CRUD API added in the recent 73-commit batch (`f0f1e8f`: migration adding `task_todos`, `time_logs.todo_label`; `3faf9c4`: "Add task_todos CRUD API and client helpers"). The desktop app should let a VA pick one of their on-queue tasks and add a to-do item to it — reusing this real API, not building a parallel system.

3. **Filter the right panel (task list) to "On Queue" status only** — not the full status list (Pending/Submitted/Reviewing/etc.) built in the previous iteration. Boss's words: *"they only need to see what's on queue, what they are going to work on... their focus area."*

4. **Filter the left panel (Account/Project tree) to only show accounts/projects with at least one On Queue task.** If an account has nothing queued, it shouldn't appear at all. Boss's words: *"if there is an account that doesn't have a task it should not show on the left side."*

5. **If a VA wants to work on something not currently queued, that's explicitly treated as a planning gap — not something to fix from the desktop app.** Boss's words: *"if they're thinking of a to-do that doesn't have a task yet, then there is a system problem there — they need to go back to the webpage."* The desktop app should not offer any way to create a new task, even a lightweight one — only to add to-dos under what's already queued.

**Revised right-panel structure:**
- Filterable table of **On Queue** tasks only (drop the full status filter, or keep it but default/lock to On Queue — worth clarifying with boss which she prefers)
- Selecting a task shows its detail panel, including its existing to-dos (if any) and a way to **add a new to-do** (text input, linked to that specific task) — reusing the real `task_todos` API
- The big Play button / row Play icons still start a task exactly as before (that part of the existing build doesn't change)

**What stays exactly the same (already built, still correct):** Clock In/Clock Out, starting a task, single-active-task rule, realtime sync, session date handling, Close Task modal. Only the "create new work" surface changes — replaced by "add a to-do to existing queued work."

## 2. What's genuinely new (not just a port of the extension)

**Real activity/idle detection.** The browser extension can only tell if it's "running" — it has no way to see mouse/keyboard activity outside the browser tab. A desktop app can, because it runs at the operating-system level. This is the actual value of building a desktop app instead of just improving the extension.

**Two ways to build this, very different in scope:**

| Approach | What it does | Privacy impact | Complexity |
|---|---|---|---|
| **Idle detection only** | Detects "no input for X minutes" → marks user idle. Does NOT know *what* was typed or clicked. | Low — standard practice, used by most time trackers | Low — built into the desktop app framework, no extra tools needed |
| **Detailed activity logging** | Tracks specific keystrokes and mouse movement patterns (sometimes used for "activity score" percentages) | High — this is effectively input monitoring and needs to be clearly disclosed to the team, and may have legal implications depending on where VAs are located | Higher — needs extra system-level permissions and more careful engineering |

**Confirmed with boss: Idle detection only.** No keystroke or detailed input logging needed — just active vs. idle status. This is the simpler, less invasive path, and it's now locked in as the scope.

---

## 3. Platform-specific notes

- **Windows:** Straightforward — no special permission prompts needed for idle detection or screenshots.
- **Mac:** macOS requires the user to explicitly grant a **Screen Recording** permission before an app can take screenshots. VAs on Mac will see a one-time system permission prompt the first time they try to capture a screenshot — this is expected macOS behavior, not a bug, but worth telling the team about in onboarding so it doesn't look broken.
- **Windows:** No equivalent OS-level permission gate — Windows doesn't require the user to grant explicit system permission for screenshot capture the way Mac does. Recommended anyway: add an **in-app consent notice** on first login (both platforms) explaining that the app takes periodic screenshots and tracks idle/active status while clocked in — not an OS requirement, just good practice for transparency and consistency across platforms.

---

## 4. Suggested tech approach

- **Electron** is the standard choice for this kind of app — lets you build with the same web technologies (React, the styling you already have) wrapped in a native window, and works across Windows + Mac from one codebase.
- Electron has a built-in way to check system idle time without needing extra invasive tools — good fit if the answer to the activity question is "idle detection only."
- Screenshot capture, upload logic, and heartbeat pattern get translated from the extension's JavaScript into the Electron app — conceptually the same logic, different packaging.

---

## 5. Suggested build order

1. **Basic shell first** — a desktop window that can log in with an existing MinuteFlow account and show the same dashboard (or a simplified version of it). Confirms the login/auth reuse works before adding anything else.
2. **Screenshot capture** — port the extension's capture-and-upload logic, respecting the Google Drive rule.
3. **Heartbeat** — so the app shows up as "active" in the Admin panel, same as the extension does.
4. **Idle detection** — once confirmed with your boss that this is the right scope, add idle/active status tracking.
5. **Packaging/distribution** — build installers for Windows and Mac so the team can actually install it (this is its own separate piece of work, worth planning for once the core app works).

---

## 7. Parked items (not urgent, revisit later)

- **📌 PINNED — Logout scope behavior:** Confirmed that logging out on the web app uses Supabase's default "global" scope, meaning it eventually logs out the desktop app too — but not instantly. The desktop app keeps working until its current access token naturally expires (~1 hour typically), then fails to refresh and gets logged out. Open question for your boss: is "eventually logs out" acceptable, or should the desktop app detect a remote logout immediately (via Supabase's `SIGNED_OUT` auth event)? Stashed while focus shifts to the desktop app redesign — revisit once that's settled.

## 6. Open questions (still to confirm with your boss)

1. ~~Idle detection only, or detailed activity tracking?~~ ✅ **Resolved — idle detection only.**
2. Should the desktop app fully replace the browser extension eventually, or run alongside it?
3. ~~Full dashboard mirror or simplified view?~~ ✅ **Resolved — focused mini-dashboard (queued tasks + timer only), Hubstaff-style. Not a copy of the full app.**