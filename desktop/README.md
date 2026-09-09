# MinuteFlow Desktop

An Electron companion app for MinuteFlow. Built to do the one thing the Chrome
extension (`../extension/`) structurally cannot: capture a screenshot of the
**whole screen or any window**, not just the active browser tab.

## What it does (v1 / MVP)

- **Sign in** with the same MinuteFlow email/password as the web app.
- **Clock In / Break / Clock Out**, writing to the same `sessions` and
  `time_logs` tables the web dashboard uses — a shift started here looks
  identical in Reports/Activity Log to one started on the web. Ported from
  `src/app/(app)/dashboard/page.tsx` and `src/contexts/SessionContext.tsx`,
  including the duplicate-active-log guard and the overnight-log-capping
  safety net (see `src/lib/clock.ts` for the file-by-file mapping).
- **Assigned Tasks** — shows your `on_queue` / `in_progress` tasks and their
  per-task to-do list (TD1, TD2, …), same visual pattern as
  `AssignedTasksWidget.tsx`. **Start** on an `on_queue` task closes whatever
  log is currently open, begins tracking a new one for it, and flips the
  assignee row to `in_progress` — mirrors `handlePlayAssignedTask` +
  `startTask()` in the web dashboard for the standard (non-fixed-pay) case;
  see `src/lib/startTask.ts`. Fixed-pay tasks aren't supported yet (Start is
  disabled for them — their web flow is a different instant one-shot log with
  no timer). No task-switch wizard (no memo prompt for whatever was running
  before), no Accept/Submit, no to-do editing yet.
- **Capture Now** — grabs the entire primary display via Electron's
  `desktopCapturer` + `getUserMedia` (main process → preload → renderer) and
  uploads it to `/api/upload-screenshot`. **Screenshots go to Google Drive
  only** — same endpoint, same rule as everywhere else in this app (see
  CLAUDE.md's screenshot rule). There is no Supabase Storage path here, and
  none should ever be added.

## What it deliberately does NOT do yet

- **No Accept / Submit on tasks, no to-do editing.** Those still go through
  Next.js API routes (`/api/assigned-tasks/[id]/todos`, and the submit flow)
  that authenticate via the web app's cookie-based Supabase session
  (`src/lib/supabase/server.ts`), which this app has no browser cookies to
  present for. Start works (see above) because `PATCH /api/assigned-tasks/[id]`
  now *also* accepts a bearer token as a fallback when there's no cookie
  session — added specifically for this app, see "Bearer-token auth" below.
  The same approach would unlock Accept/Submit/to-do edits too; not done yet
  because each has more surface than Start (Submit needs the attachment-upload
  flow SubmitWorkModal drives; to-do edits are multiple routes).
- **No automatic/scheduled capture, no idle detection, no local retry queue.**
  The Chrome extension (`../extension/background.js`) already owns the
  5-minute auto-capture cadence, idle/lock detection, and offline-safe upload
  queue for anyone who has it installed. This app's capture is manual
  ("Capture Now") for now — see AGENTS.md's task-sizing note if extending it
  to full parity.
- **No full Break-flow wizard.** Break/End Break here just flips
  `sessions.active_task`, the same simplified version `SessionContext.tsx`
  uses on non-dashboard pages — not the dashboard's memo-collection wizard for
  the paused task.

## Running it

```bash
npm install
npm run dev
```

This starts the Vite dev server and launches Electron pointed at it.

```bash
npm run build   # type-check + Vite production build (dist/)
npm start        # run the built app with plain `electron .`
npm run dist      # electron-builder — produces a Windows installer in release/
```

## Architecture notes

- **Auth**: signs in directly against Supabase Auth (`/auth/v1/token`), the
  same flow `extension/supabase.js` uses — not the web app's cookie session.
  The refresh token is encrypted at rest via Electron's `safeStorage` (OS
  keychain/DPAPI) in `electron/main.js`, read/written through a narrow
  `contextBridge` API in `electron/preload.js` (`window.mfDesktop`).
- **Reads/writes**: `src/lib/db.ts` is a small PostgREST client, authenticated
  as the signed-in user — Postgres RLS enforces the same scoping a VA gets
  from the web app's own client-side Supabase calls.
- **Screen capture**: `electron/main.js` exposes `desktopCapturer.getSources`
  over IPC; `src/lib/screenshot.ts` picks the primary screen, grabs one frame
  via `getUserMedia`, and uploads the PNG.
- **Colors/typography**: `src/styles/globals.css` copies the token block from
  `src/app/globals.css` verbatim (see AGENTS.md — no new colors, no new
  patterns). If the web app's palette changes, mirror the change here.

## Bearer-token auth (touches the main web app, not just this folder)

`src/lib/supabase/server.ts`'s `createClient()` now takes an optional bearer
token; when given, it's set as the Supabase client's `Authorization` header so
`.from()` calls run under that user's RLS. `PATCH /api/assigned-tasks/[id]`
reads an `Authorization: Bearer <token>` header off the request and passes it
through (to both `createClient()` and `supabase.auth.getUser(token)` — the
auth client only recognizes a token passed explicitly, it doesn't fall back to
that header on its own). A web request never sends this header, so the
existing cookie-based path is completely unaffected; this is additive, not a
replacement. `desktop/src/lib/tasks.ts`'s `setAssignedTaskStatus()` sends the
desktop app's own Supabase access token this way — same endpoint, same body
shape as the web app's `src/lib/assignedTaskStatus.ts`, so Start stays the one
shared write path rather than a second hand-rolled one (see that file's own
comment on why that mattered before).
