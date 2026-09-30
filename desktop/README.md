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
- **Assigned Tasks** — shows your `on_queue` / `in_progress` /
  `revision_needed` tasks and their per-task to-do list (TD1, TD2, …), same
  visual pattern as `AssignedTasksWidget.tsx`. A task sent back for revision
  shows an amber "Revision Needed" badge, the red **R / R2 / R3** revision
  count badge, and a **Rework** button that puts it back on your queue (same
  `setAssignedTaskStatus` write path as Start) so you can Start it again;
  fixed-pay tasks also show their `$rate` badge. Long task names wrap under
  the badges instead of being squeezed. **Not ported: Cancel Grab** for
  fixed-pay tasks (`DELETE /api/fixed-pay-tasks/:id/grab` has no bearer-token
  or CORS support yet — same treatment the other desktop routes got). **Start** on an `on_queue` task closes whatever
  log is currently open, begins tracking a new one for it, and flips the
  assignee row to `in_progress` — mirrors `handlePlayAssignedTask` +
  `startTask()` in the web dashboard for the standard (non-fixed-pay) case;
  see `src/lib/startTask.ts`. Fixed-pay tasks aren't supported yet (Start is
  disabled for them — their web flow is a different instant one-shot log with
  no timer). **Drag-to-reorder** within a status group, same as the web
  widget (grip handle, same `/api/assigned-tasks/reorder` endpoint) — see
  `src/lib/tasks.ts`'s `compareTasks`/`reorderAssignedTasks`. **Submit** on an
  `in_progress` task opens the same checklist + word-count-bar modal as web's
  `SubmitWorkModal.tsx` (attach files, a message, a link, or any combination —
  see `src/lib/submissions.ts`'s `submissionMeetsBar`), and files upload
  straight to Supabase Storage via a signed slot exactly like web does, so a
  multi-file submission never rides through the API route's body (Vercel's
  4.5MB cap). No `@supabase/supabase-js` here though — see
  `desktop/src/lib/submissions.ts`'s comment for why that upload is a raw
  `fetch` instead of the SDK call web uses. The server decides the resulting
  status (`submitted`, or auto-`completed`/`approved` for logged categories or
  tasks that skip review) the same way it does for web; if the submitted task
  was the one actively being clocked, its open log is closed the same way
  Start/clock-out already do (no task-switch wizard here, same simplification
  as Break — see `src/contexts/SessionContext.tsx`'s comment on the
  dashboard's memo-collection wizard this skips). No task-switch wizard, no
  Accept (a `pending` task doesn't show here yet — only `on_queue`/
  `in_progress`/`revision_needed` do), no to-do editing yet.
- **Capture Now** — grabs the entire primary display via Electron's
  `desktopCapturer` + `getUserMedia` (main process → preload → renderer) and
  uploads it to `/api/upload-screenshot`. **Screenshots go to Google Drive
  only** — same endpoint, same rule as everywhere else in this app (see
  CLAUDE.md's screenshot rule). There is no Supabase Storage path here, and
  none should ever be added.
- **Minimizes to the system tray instead of quitting** — closing the window
  (X, Alt+F4) hides it rather than exiting the app, same as any other
  background tracker; a shift timer isn't useful if closing the window stops
  it. The tray icon's context menu has "Open MinuteFlow" and "Quit" (clicking
  the tray icon itself also reopens the window). The first time a session
  hides to tray it shows a one-time balloon explaining where the window went.
  Real quitting — from the tray's Quit item — **still warns if you're clocked
  in**, the same native "You're still clocked in" dialog with Quit Anyway /
  Cancel as before, the desktop equivalent of the web app's `beforeunload`
  warning in `TopNav.tsx`. The renderer reports clocked-in state to the main
  process via `window.mfDesktop.setClockedIn()` (App.tsx) since main can't
  read React state directly; see `electron/main.js`'s `close` handler and its
  `isQuitting` flag (set by `before-quit`, which only fires on a real quit —
  not on the window's own `close` event — so the X button reliably hides
  rather than exits).
- **Launch at startup** — an opt-in checkbox in the top bar
  ("Launch at startup") reads and writes the OS's own login-item
  registration (`app.getLoginItemSettings()`/`setLoginItemSettings()`), not
  anything this app tracks itself — so it stays correct even if changed
  outside the app (Windows' own Startup tab). Off by default.
- **Notification bell** — top-bar bell icon with an unread badge, mirroring
  `NotificationBell.tsx` (the web app's top-nav bell) exactly: every
  notification including DMs (broader than the Message Board's Comments tab
  below, which excludes DMs on purpose — that's `DashboardMessagePanel.tsx`'s
  narrower dashboard-panel feed, this is the full bell), grouped runs of the
  same sender+kind collapsed into one summary line, mark-read (individual +
  mark all). A DM notification is clickable — opens Message Board → Personal
  → that conversation; a task/submission-linked one just marks read (no
  Submissions page in this app yet to send it to). See
  `src/lib/notificationBell.ts`. **Native OS toast + taskbar flash** for a
  genuinely new unread item — the one thing a desktop app can do that a
  browser tab can't as reliably (fires even while the window isn't focused).
  Toasts use the standard web `Notification` API directly in the renderer
  (Electron implements it natively, no IPC needed); the taskbar flash goes
  through `window.mfDesktop.flashFrame()` since only the main process can
  reach the window — see `electron/main.js`'s `mf:flash-frame` handler.
- **Message Board** — a "To-Do / Message Board" tab strip above the right
  panel switches to a Messages panel with its own inner tabs, mirroring
  `DashboardMessagePanel.tsx`: same amber tab pills, same "+ New Topic"/
  "+ New message" buttons, same row cards, same avatar circles.
  - **General** — the team-wide board (`project_id` null). Read topics,
    start one, reply. Goes through `/api/project-messages` (+ its
    `/comments` sub-route) rather than direct table writes, so
    `notifyMentions()` (bell + Telegram for anyone @mentioned) still fires —
    see `src/lib/messageBoard.ts`.
  - **Personal** — direct messages and group chats. List conversations
    (unread counts, last-message preview, unread rows highlighted), open one,
    reply, start a new 1:1 or group by picking teammates. Goes through
    `/api/conversations` (+ its `/messages` and (`PATCH`/`DELETE`) `/:id`
    sub-routes) and `/api/team-members`, so `notifyOne()` (bell + Telegram)
    still fires on send — see `src/lib/conversations.ts`. **Delete a message**
    (sender-only, soft-deleted) and **delete a whole conversation** (any
    member — a DM has no single author the way a General topic does) via
    Delete links/buttons. **Archive/unarchive** a conversation is per-viewer —
    it hides it from your own list only, with an "Archived (N)" toggle to
    read it back. Typing "@" in the DM composer opens a picker scoped to that
    conversation's own members (plus `@everyone`/`@all`, also scoped to just
    this chat, not the whole company — see `notifyMentions`'s `restrictToIds`
    on the web side) — picking a name inserts it, same as the web composer.
    Any real @Full Name/`@everyone`/`@all` mention, typed or picked, gets
    highlighted when rendered, in both Personal and General
    (`highlightMentions` in `src/lib/linkify.tsx`). General's own composer
    still has no "@" picker (typing "@" there doesn't open one) — the
    notification itself already fires either way, since `notifyMentions()`
    runs server-side on whatever text you send.
  - **Comments** — the notification feed (submission comments, @mentions,
    job orders, new DMs), read-only. Reads the `messages` table directly
    (RLS-scoped, same as tasks/sessions) rather than through an API route —
    the web widget does the same — see `src/lib/notifications.ts`.
  - **Attachments and clickable links** — a topic, reply, or DM can carry a
    pasted/dragged/picked file or a link, same "+ Attach" picker as web
    (`src/components/AttachmentComposer.tsx`, ported to
    `desktop/src/components/AttachmentComposer.tsx`). An image attachment
    previews inline; anything else shows a filename chip; a link shows a
    chip too. A bare `https://` URL typed into plain message text is
    auto-linked (`src/lib/linkify.tsx`). Goes through
    `/api/message-attachments`, same bearer-token/CORS treatment as
    everything else here. Attachment images preview via a Supabase Storage
    signed URL, a different origin from the app's own API calls — `img-src`
    in `electron/main.js`'s CSP allows it explicitly. No delete/remove yet.
  - **Editing** — the author of a General topic or reply, and the sender of
    a DM, can edit their own words in place via an "Edit" link next to the
    timestamp (admins can also edit any topic or reply, same as web). An
    edited item picks up an italic "· edited" label. Uses the same PATCH
    routes as web (`/api/project-messages`, its `/comments` sub-route, and
    `/api/conversations/:id/messages`), which already carried the
    bearer-token/CORS treatment from earlier PRs — no new backend work
    needed. See `editTopic`/`editComment` in `src/lib/messageBoard.ts` and
    `editMessage` in `src/lib/conversations.ts`. General still has no
    delete/pin/archive of its own (Personal's above is separate).
  - Not in this version: Admin oversight (beyond edit-any-post), per-project
    boards, @mention autocomplete *for composing* (see Personal above),
    General's own delete/pin/archive, marking a notification read, realtime
    (all four tabs poll instead — see each lib file's poll interval).

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

`npm run dist` uses `build/icon.ico` (copied from the web app's own
`src/app/favicon.ico` — see AGENTS.md, no new visual assets) for the window,
taskbar, tray, and installer icon, and an NSIS installer configured to let
the installer choose its install directory and add Desktop/Start Menu
shortcuts (see `package.json`'s `build.nsis`). On at least one Windows dev
machine this has failed locally with `EPERM: operation not permitted, rename
...win-unpacked.tmp -> ...win-unpacked` right after Electron's binary is
unpacked — a known electron-builder-on-Windows issue, usually antivirus
real-time scanning racing the rename. Retrying (after deleting `release/`)
sometimes clears it; otherwise it needs an AV exclusion or an elevated
terminal, neither of which this app should set on its own.

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
