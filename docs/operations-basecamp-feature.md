# Feature: Operations as a Basecamp-style workspace

Direction from Toni (via the Basecamp "Making a Podcast" reference): an **Operation** should
open as a project workspace with Message Board, To-dos, Card Table, Docs & Files, Calendar,
and Chat — the same six tiles Basecamp shows.

Companion to [`productivity-hub-scope.md`](./productivity-hub-scope.md) Part II, which captured
the same idea scoped to **Objective**. This file is the build plan, and it takes one position
that Part II did not: **build every tile kind-agnostic**. Objective and Operation are the same
`projects` row with a different `kind`; they already share one component (`VAProjectsTab`).
Building the workspace twice would be the single most expensive mistake available here.

---

## Answers from Toni (2026-08-18) — decided, don't re-ask

| # | Question | Answer | Effect on this plan |
|---|---|---|---|
| 1 | Chat: per-Operation, or general VA-to-VA? | **General** | **Chat leaves the Operations scope entirely.** It becomes a separate team-messaging feature, not a workspace tile. Biggest single scope cut here. |
| 2 | Docs & Files: file cabinet, or editable docs? | **File cabinet** ("First") | Build the upload/download/organize version on `task-attachments`. No editor dependency. |
| 3 | To-dos: group by task, or by VA? | **By task** — "like basecamp it's a objective to do. doesn't matter who is assigned" | Group under the parent task. Assignee is not the grouping key. |
| 4 | Who sees what? | **VAs see only what pertains to them; Admin / Specialist / Manager and above see all.** Toni is Founder. | Maps to the existing `hasBroadAdminAccess()` — see "Visibility model" below. |
| 5 | Roll out to Objective too? | **Operations first** | Still build kind-agnostic; just don't render the workspace on the Objective page yet. |

## Visibility model (from answer 4)

`hasBroadAdminAccess()` in `src/lib/financialAccess.ts` already encodes exactly the tier Toni
described — it returns true for `admin`, `manager`, `specialist`, `ceo`, `founder` (and
`coordinator`). **Use it; don't write a new role check.** `VAProjectsTab` already receives its
result as the `isAdmin` prop.

Two things to nail down before Phase 3:

- **`coordinator`** is in that helper but Toni didn't name it. Assume it stays in (it's the
  existing behavior everywhere else in the app) and confirm in passing.
- **"Pertains to them" is Operation-level, not task-level.** A VA assigned to an Operation
  (`project_va_access`) sees that Operation and everything in it — every task on the board, every
  message on the board. That is already how the code behaves: the VA subtask path at
  `/api/assigned-tasks?projectId=` returns *all* tasks with that `project_id`, not just the
  caller's. It's also required for the Message Board to work at all — announcements everyone can
  see is the point. Worth one line of confirmation with Toni, but don't narrow it on a guess.

---

## Where Operations actually stands today

Verified in code, not assumed. Much of the boss's list already exists.

| Piece | State | Where |
|---|---|---|
| Operations as first-class records | Done | `projects` rows with `kind='operation'`; `ProjectKind` in `src/types/database.ts:720` |
| Optional link to the Objective it supports | Done | `Project.linked_objective_id`; "Supports: X" badge at `VAProjectsTab.tsx:544` |
| Tree with nesting, create/edit, assigned VAs | Done | `VAProjectsTab.tsx` (`kind="operation"`), `project_va_access` |
| **Recurring tasks attached to an Operation** | ✅ Done (2026-08-19) | `project_id` on `recurring_task_templates`; cron carries it onto every generated task — see Phase 1 below |
| **Workspace tile grid** | ✅ Done (2026-08-19) | `OperationTileGrid.tsx` + `VAProjectsTab.tsx` — Message Board, Recurring, Subtasks, Docs & Files as clickable tiles |
| **Card Table (kanban)** | Done | `SubtaskBoardView.tsx` + `src/lib/subtaskStatusColumns.ts`; the Subtasks tile's Board View |
| **Calendar filter by Objective/Operation** | Kind-level filter done; deep-link from a tile still open | `calendar/page.tsx` — "All / Operations only / Objectives only" quick buttons |
| **Message Board** | ✅ Done (2026-08-19) | `project_messages` + `project_message_comments`; `ProjectMessageBoard.tsx` — posts, threaded comments, edit, avatars, per-post thread view |
| **To-dos rollup** | Parts exist, tile not built | `task_todos` table + API (`assigned-tasks/[id]/todos`); no per-Operation rollup view yet |
| **Docs & Files** | ✅ Done (2026-08-19) | `project_files`; `ProjectFiles.tsx` — upload/download/delete, type filter, filename search |
| **Chat** | Out of scope | See "Out of scope: Chat" below — Toni's answer 1 made this a separate, non-Operations feature |

The honest summary for the boss, updated: **everything is done except the To-dos tile and the
Calendar deep-link.** Phase 1 — the thing that actually makes an Operation an Operation, the
recurring-task link — was the one broken piece when this doc was first written, and it's now
fixed, shipped, and confirmed against production.

---

## The gap that defines Operations

Toni's definition: *"Operations is like the Objective, but it just contains the recurring tasks."*

**Regular tasks already can.** `TaskEditor.tsx:1236-1265` renders **"Link to Objective"** and
**"Link to Operations"** dropdowns in the Assignment section — real `projects` rows, setting
`project_id`, with a mutual-exclusion rule ("picking one clears the other"). Every surface that
uses `TaskEditor` — Assignment page, Calendar's Add Task, admin panel, output-based tasks, the
Operation's own Add Subtask — gets this for free.

**Recurring templates are the sole exception**, because their form isn't `TaskEditor`. The drawer
in `RecurringTemplatesManager.tsx` is a separate hand-built form that imitates the layout (its own
subtitle: *"Matches the task sidebar layout"*). It rebuilds Account / Objective / Task name /
Category by hand and has no equivalent of the Link-to-Operation field.

So this is not a missing concept — the concept is built and working. **It is one missing field on
one form, plus the plumbing behind it.** Three facts, each verified:

1. `recurring_task_templates` has `account` and `project` — but `project` is a **text project tag**
   (from `project_tags`, surfaced by `/api/task-form-options` as `{id: number, project_name}`).
   There is **no `project_id`** pointing at a `projects` row.
2. `/api/cron/recurring-tasks/route.ts:185` inserts generated `assigned_tasks` with
   `account` and `project` text — and **never sets `project_id`**.
3. The Operation detail panel lists its subtasks via
   `/api/assigned-tasks?projectId=<uuid>`, which filters on `project_id`.

Net effect: **a recurring task generated by the cron can never appear under the Operation it
belongs to.** The Operations page shows "No subtasks yet" while the recurring work runs happily
somewhere else. Everything else on the boss's list is additive polish on top of a container that
isn't holding its contents yet.

**This is why Phase 1 is Phase 1.** Building a Message Board onto an Operation whose task list is
permanently empty is decorating a room with no floor.

---

## Sequence

| Phase | What | Size | Why here |
|---|---|---|---|
| **1** | Recurring tasks belong to the Operation | M — **✅ shipped and confirmed 2026-08-19** | The feature's actual definition. Everything else assumes an Operation has contents. |
| **2** | Workspace shell — tiles instead of one form | S — **✅ shipped 2026-08-19 (PR #67)** | Cheap, kind-agnostic, and it's the frame every later tile plugs into. |
| **3** | Message Board | M — **✅ shipped 2026-08-19 (PR #67, #70)** | Highest-value net-new tile; Toni named it first. Grew beyond the original scope — see below. |
| **4** | To-dos rollup | S–M (~2 d) — **not started** | Mostly assembly over data that already exists. Grouped by task (answer 3). |
| **5** | Calendar scoping | S — **kind filter shipped 2026-08-18**; deep-link into a tile still open (Phase 2's shell exists now, so this is unblocked whenever picked up) | Filter already exists; needs an Objective/Operation **kind** filter + deep-link from a workspace. |
| **6** | Docs & Files — file cabinet | M — **✅ shipped 2026-08-19 (PR #68)** | Shape settled by answer 2; reuses the attachment API almost verbatim. |

Message Board ended up bigger than scoped: edit-in-place for posts and comments (not just
delete), author avatars (reusing `AvatarUpload`'s look, read-only), and a proper per-post
thread page — click a post, it opens full with its own back button, matching Basecamp's
actual pattern rather than the inline-expand originally planned. Docs & Files picked up a
type filter (Images/Documents/Spreadsheets/Other) and a filename search, the two pieces of
Basecamp's filter bar that actually map to a flat, no-folders file list.

**~11–15 days for the whole Operations workspace.** Chat is no longer part of it (answer 1) —
see "Out of scope" below.

Phases 3–6 are independent of each other once 1 and 2 land, so they can be reordered on Toni's
say-so without rework.

## Out of scope: Chat

Answer 1 was "general," meaning team-wide VA-to-VA messaging rather than per-Operation chat.
That takes it out of this plan entirely — it's a separate feature that happens to have been
mentioned alongside Operations, and it should get its own doc and its own schedule.

Worth recording for whoever picks it up: the `messages` table already exists with
`sender_id` / `target_user_id`, and a realtime channel is already wired at
`dashboard/page.tsx:697`. But today it is **one-way admin→VA notification** — an admin sends
from the admin panel (`admin/page.tsx:1209`), the VA sees a dismissible banner, marks it read,
and it's gone. Real chat needs conversation threads, replies, VA→VA permission, unread counts,
and message history (only *unread* messages are fetched today). So the table is a starting
point, not a shortcut.

---

## Phase 1 — Recurring tasks belong to the Operation

### Status — ✅ Closed out (2026-08-19)
Built, shipped, and confirmed end to end. The first attempt (2026-08-18 cron run) generated
a task with `project_id = null` — the fix existed only in a local dev server at that point,
not on the `main` branch Vercel's cron actually runs. Diagnosed via a direct SQL check
(`assigned_tasks.project_id` vs. the template's `project_id` — task null, template set),
traced to the code never having been committed/pushed, then merged via PR #61/#62. The
2026-08-19 8 PM EDT run, now against the deployed fix, generated "Workspace Update" due
Aug 20 **with `project_id` set** — confirmed live on `minuteflow.click` in the Operation's
Subtasks list.

| Step | Verified |
|---|---|
| Migration run on production (`project_id` column + index) | ✅ |
| "Link to Operations" picker on the template form, styled like `TaskEditor`'s | ✅ |
| Template saved with the link; Operation column shows it in the table | ✅ |
| Operation's own page shows its linked templates (new "Recurring" section) | ✅ |
| `npx tsc --noEmit` / `npm run lint` | ✅ Clean; lint at baseline |
| **Generated task carries `project_id` and appears in the Operation's List/Board/Calendar** | ✅ **Confirmed 2026-08-19** — "Workspace Update" (due Aug 20) shows in Test Operation's Subtasks on production |

Also fixed in passing, at Toni's request: the pre-existing "Objective" mislabel on the old
text-tag field (BASICS section of the task form, and the recurring template form/table) is
now correctly labelled **"Project"**. That field was never a real Objective — see "The gap
that defines Operations" below for how this was discovered. Renamed in
`TaskEditor.tsx`, `RecurringTemplatesManager.tsx`, `assignment/page.tsx`, and
`TaskAssignmentsAdminTab.tsx`. Display-only; no data changed.

### Goal
Creating a recurring template from inside an Operation makes every generated task show up in
that Operation's List View, Board View, and Calendar filter.

### Schema (needs approval — propose before running)
```sql
ALTER TABLE recurring_task_templates
  ADD COLUMN project_id uuid REFERENCES projects(id) ON DELETE SET NULL;

CREATE INDEX idx_recurring_templates_project_id
  ON recurring_task_templates(project_id);
```
Nullable on purpose: every existing template keeps working untouched, unattached to any
Operation. No backfill — old templates stay where they are unless someone edits them.

### Code
- `src/types/database.ts` — add `project_id: string | null` to `RecurringTaskTemplate`.
- `src/app/api/recurring-task-templates/route.ts` — accept and persist `project_id` on POST and
  PATCH (alongside the existing `account` / `project` handling at lines 259 and 326); support
  `?projectId=<uuid>` on GET.
- `src/app/api/cron/recurring-tasks/route.ts` — add `project_id: template.project_id ?? null`
  to the `assigned_tasks` insert. **This one line is the fix.** Everything else is plumbing so a
  human can set the value.
- `src/components/RecurringTemplatesManager.tsx` — new optional "Link to Operations" picker.
  **Copy `TaskEditor.tsx:1230-1266` rather than designing one** — same label, same
  `— None —` option, same bordered `bg-cream/40` container, same mutual-exclusion rule if an
  Objective link is offered too. The pattern is proven and users already know it from the task
  form. Careful: the prop already called `formObjectives` is **project tags** (`id: number`), not
  `projects` (`id: uuid`). Don't overload it — add a separate `operations: Project[]` prop. When
  the manager renders inside a selected Operation, pre-fill and lock the picker (`TaskEditor`'s
  `lockedProjectId` shows the wording for that case too).
- `src/components/VAProjectsTab.tsx` — a "Recurring" section on the Operation detail listing that
  Operation's templates. Reuse the existing section-card and task-list-item patterns.
- `src/app/(app)/productivity/operations/page.tsx` — the top-level "Recurring Templates" tab stays
  as the cross-Operation list; the per-Operation view is the new one.

### Acceptance
Create an Operation → add a daily recurring template inside it → run the cron → the generated
task appears in that Operation's List View, in Board View under Pending, and passes the
calendar's project filter for that Operation. Confirm the generated row actually carries
`project_id` before calling it done.

### Watch for
Generated tasks land with `status: 'pending'` and `due_date: tomorrow`. A daily template on a
long-running Operation piles up cards fast. Ask the boss whether the Operation's board should
default to a rolling window (e.g. last 30 days) before this reaches a real Operation.

---

## Phase 2 — Workspace shell

### Goal
Selecting an Operation shows a tile grid — the Basecamp layout — instead of one long details
form. Tiles summarize and link into the full view.

### Approach
New `src/components/ProjectWorkspace.tsx`, taking `{ project, kind, currentUserId, isAdmin }`.
`VAProjectsTab` keeps the left tree and renders `ProjectWorkspace` on the right in place of
today's detail panel. **Ship it behind a view toggle** — the same move the team already made for
List/Board — so nothing that works today can regress.

Because it takes `kind`, Objective can get the identical workspace later at no extra cost —
but per answer 5, **Operations only for now**. Build the component kind-agnostic; simply don't
render it from the Objective page until Toni says so.

### Layout
Five tiles, not the Basecamp screenshot's six — Chat is out (answer 1). Three columns on
desktop, one on mobile: `Message Board | To-dos | Card Table` over `Docs & Files | Calendar`.
Each tile is the existing section card (`rounded-xl border border-sand bg-white p-4 space-y-3`)
with the uppercase `text-walnut` section label. No new colors, no new patterns — the palette in
`AGENTS.md` is the whole set.

Unbuilt tiles render as an empty state ("Nothing posted yet"), never as a broken or hidden tile.
That way the boss sees the full shape on day one and can re-prioritize what fills in first.

---

## Phase 3 — Message Board

### Goal
Announcements and updates scoped to one Operation. **Who can post: the VAs assigned to that
Operation** (rows in `project_va_access`), plus its creator and admins. Threaded comments under
each post.

### Schema (needs approval)
```sql
CREATE TABLE project_messages (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id   uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  author_id    uuid NOT NULL REFERENCES profiles(id),
  title        text NOT NULL,
  body         text NOT NULL,
  category     text,                    -- 'announcement' | 'update' | 'fyi' | null
  pinned       boolean NOT NULL DEFAULT false,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  deleted_at   timestamptz
);

CREATE TABLE project_message_comments (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  message_id   uuid NOT NULL REFERENCES project_messages(id) ON DELETE CASCADE,
  author_id    uuid NOT NULL REFERENCES profiles(id),
  body         text NOT NULL,
  created_at   timestamptz NOT NULL DEFAULT now(),
  deleted_at   timestamptz
);

CREATE INDEX idx_project_messages_project ON project_messages(project_id, created_at DESC);
CREATE INDEX idx_project_message_comments_message ON project_message_comments(message_id, created_at);
```
Deliberately **not** reusing `messages` — that table is `target_user_id`/`sender_id` 1:1 DM
plumbing wired to a realtime channel on the dashboard. Overloading it would break notifications.

### API
`src/app/api/project-messages/route.ts` — GET (`?projectId=`), POST, PATCH, DELETE (soft).
Authorization mirrors `src/app/api/projects/route.ts`: service client for the query, gated on
`hasBroadAdminAccess` **or** membership in `project_va_access` **or** `projects.created_by`.
Write that membership check once as a helper — Phases 4–7 all need the same rule.

Attachments reuse the `task-attachments` bucket, same shape as
`assigned-tasks/[id]/attachments`. Screenshots remain Drive-only; that rule is untouched here.

### UI
`src/components/ProjectMessageBoard.tsx`. The closest existing precedent is `SubmissionLines.tsx`
(threaded entries, collapsed by default) — read it and lift its structure rather than inventing a
post card. The tile shows the newest 4 posts (author, title, one-line preview); clicking opens
the full board.

---

## Phase 4 — To-dos rollup

### Goal
The Basecamp To-dos tile: the Operation's tasks with their checklists, grouped, checkable inline.

### No schema needed
`task_todos` already exists with a full API (`assigned-tasks/[id]/todos`, `.../[todoId]`) and is
already selected alongside tasks in `/api/assigned-tasks` (line 97). `src/lib/taskTodos.ts` holds
the shared logic.

### Build
`src/components/ProjectTodosTile.tsx`, fed by the `subtasks` array `VAProjectsTab` already
fetches — no new data call. Group by task, show each task's todos as checkboxes, check/uncheck
through the existing todo API with optimistic update and rollback (copy the pattern from
`handleBoardStatusChange`, `VAProjectsTab.tsx:443`).

### Grouping — settled
**Group by task**, per answer 3: *"like basecamp it's a objective to do. doesn't matter who is
assigned."* Assignee is not the grouping key and doesn't need to appear in the tile at all.
Note this overrides `productivity-hub-scope.md` Part II, which assumed a per-person rollup.

---

## Phase 5 — Calendar scoping

Smallest phase, because `calendar/page.tsx` already filters by project and already labels each
option "(Operation)" or "(Objective)".

What's missing:
1. ✅ **Built 2026-08-18.** A kind-level filter — "All / Operations only / Objectives only" quick
   buttons above the existing per-project checklist, in `calendar/page.tsx`'s filter popover.
   Derives the Operation/Objective id sets from `allProjects` (already fetched) and sets/clears
   `projectFilter` in one click; goes through the same draft → Apply flow every other filter
   uses, so nothing about the existing filter model changed. This is what the boss actually
   asked for — "filtered by objective or operations."
2. A deep link: the Calendar tile in the workspace opens `/productivity/calendar?project=<id>`
   with that filter pre-applied. Requires reading the filter from the query string on mount.
   **Still pending** — there's no workspace tile to link from until Phase 2 ships.
3. Agenda (list) view — still net-new, still optional. Defer unless asked.

---

## Phase 6 — Docs & Files (file cabinet)

Settled by answer 2: **file storage — upload, download, organize.** Not editable in-app
documents. No rich-text editor, no versioning, no new dependency.

Reuses the `task-attachments` bucket and the same upload/signed-URL shape as
`assigned-tasks/[id]/attachments`. Screenshots stay on Drive — that rule is untouched.

### Schema (needs approval)
```sql
CREATE TABLE project_files (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id   uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  filename     text NOT NULL,
  storage_path text NOT NULL,           -- task-attachments bucket
  file_size    bigint,
  mime_type    text,
  uploaded_by  uuid REFERENCES profiles(id),
  uploaded_at  timestamptz NOT NULL DEFAULT now(),
  deleted_at   timestamptz
);
```

---

## Cross-cutting rules for this build

- **Kind-agnostic, always.** Every component takes `kind` / `project`. Operation-only behavior is
  a conditional, never a forked file — so Objective can be switched on later (answer 5) without
  a rewrite.
- **Use `hasBroadAdminAccess()` for the admin tier.** It already matches answer 4 exactly. Don't
  hand-roll a role list in a new route.
- **One membership helper.** "Can this user see/post to this project?" gets written once and
  imported by every new route. Six routes with six slightly different rules is how the permissions
  bug gets in.
- **Toggle, don't replace.** The workspace ships beside the existing detail panel, as List/Board
  did. Nothing that works today regresses.
- **Palette is closed.** Cards, badges, buttons, inputs all come from `AGENTS.md`.
- **One migration per phase**, proposed as exact SQL and approved before it runs. Approval is never
  standing.
- **`npx tsc --noEmit` before every push**; compare `npm run lint` to the standing baseline rather
  than expecting zero.

---

## Still open

The five big ones are answered above. What's left is small and phase-local — none of it blocks
starting Phase 1.

**Blocks Phase 1**
1. When a recurring template is attached to an Operation, should the generated tasks also inherit
   the Operation's `account`? (Today the template carries its own.)
2. Long-running Operations accumulate daily tasks indefinitely. Rolling window on the board, or
   show everything?

**Blocks Phase 3**
3. Should a VA be able to **edit or delete** their own Message Board post after others have
   commented on it?
4. Do posts need email notification (Resend is already wired for broadcasts), or in-app only?

**Confirm in passing**
5. `coordinator` sits inside `hasBroadAdminAccess()` but Toni named only "admin specialist
   manager and above." Assume it stays; mention it next time it comes up.
6. A VA assigned to an Operation sees everything in it (all tasks, all posts), not just their own
   items — that's existing behavior and the Message Board requires it. Confirm, don't narrow.

**Renaming (worth raising separately — this one is already live)**
7. The old text project tag is labelled **"Objective"** in three places:
   `RecurringTemplatesManager.tsx:708` (table column), `:833` (form field), and
   `TaskEditor.tsx:917` (form field).

   That last one means **the collision already exists in production**: `TaskEditor` shows
   "Objective" (text tag, Basics) *and* "Link to Objective" (real project row, Assignment) on the
   same form. Phase 1 doesn't create this problem — it inherits it, and would spread it to a
   second form.

   Fix is a rename of the old field to **"Project"** in those three spots — display-only, no data
   change, since the column is already `project`. Small diff, but a visible label move on forms
   people use daily, so it needs Toni's yes rather than being slipped in with Phase 1.
