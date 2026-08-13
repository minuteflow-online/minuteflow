# Productivity Hub — Scope & Organization (for later)

Companion to [`productivity-hub-adjustments.md`](./productivity-hub-adjustments.md), which holds the raw
requirements. This file **organizes** those 10 requirement sections into workstreams, sequences them,
and flags the schema/approval dependencies — so the work can be picked up cold without re-deriving context.

> **Status note:** One slice is already in flight — see "In progress" below. Do **not** disturb it.

---

## Objective

Bring the Assignment page and Calendar in the Productivity Hub up to spec: full field visibility,
role-aware defaults, a per-VA budget system, a complete/consistent filter set across all three surfaces
(main list, submitted, calendar), a cleaner date/time model, and richer calendar views. The through-line
is **consistency** — the same filters, the same edit permissions, and the same date/time semantics
everywhere a task appears.

## Surfaces involved (grounded in code)

| Surface | File | Lines |
|---|---|---|
| Assignment page | `src/app/(app)/productivity/assignment/page.tsx` | 2901 |
| Calendar page | `src/app/(app)/productivity/calendar/page.tsx` | 1149 |
| Admin assignments tab | `src/components/TaskAssignmentsAdminTab.tsx` | 2690 |
| Fixed-pay (output-based) tab / panel | `FixedPayTasksTab.tsx` (1199) / `FixedPayTasksPanel.tsx` (921) | — |
| Consolidated task form | `src/components/TaskEditor.tsx` | 798 |
| Team management profile | `src/components/TeamProfilePanel.tsx` (1225), `team/page.tsx` (1881) | — |
| Assigned-tasks API | `src/app/api/assigned-tasks/route.ts` (577), `[id]/route.ts` (789) | — |

Hub tabs live under `src/app/(app)/productivity/` (`ProductivitySubNav.tsx`): Assignment, Calendar,
Objective, Operations. Objective/Operations both render `VAProjectsTab` (`kind="objective"` / `"operation"`).

> **Scope expanded (2026-08-12):** Sections 1–10 above are the *near-term* Assignment/Calendar polish.
> A separate, larger **Objective redesign** is now in play — see
> [Part II — Objective as a Basecamp-style workspace](#part-ii--objective-as-a-basecamp-style-workspace).
> Treat Part II as a distinct, later initiative, not part of the 10-section round.

---

## In progress — do not interfere

**Section 5 (date/time model), backend slice.** Uncommitted diff threads a new `due_time` field through:
- `src/types/database.ts` — `AssignedTask.due_time: string | null`
- `src/app/api/assigned-tasks/route.ts` — GET selects + POST insert
- `src/app/api/assigned-tasks/[id]/route.ts` — GET select, PUT/PATCH read + payload

Remaining for Section 5: the DB column migration (via Manny) and the **UI** — split the date picker
(combined start/end with optional end), give start/end **time** its own field, and make **due date +
due time** fully separate with a single time. Frontend not yet started.

---

## Workstreams

Grouped by what they touch, so shared edits land once.

### A. Date/time model — Section 5  *(foundation; partly started)*
Everything else that renders a task date (calendar dots, deadline markers, daily totals) depends on the
final shape of this model. Land the schema + shared date/time UI **first**.
- **Schema (Manny):** confirm/add `due_time` column on `assigned_tasks`.
- Combined start+end date picker with optional end date.
- Separate start/end **time** field (not shared with date range or due date).
- Fully separate due date + single due **time**.
- Due dates excluded from daily time-block totals but still shown as a deadline marker.
- Touches: `TaskEditor.tsx` (single source for the form), then calendar rendering.

### B. Filtering — Sections 3 + 4  *(largest surface-area workstream)*
Build the filter set once as shared state/logic, then apply to all three surfaces.
- New filters: **By project**, **Assigned by**, **Overdue**, **Start date**, **Created date** — added
  *alongside* the existing property-field filter, not replacing it.
- Apply to **main task list**, **submitted view**, **and calendar** (calendar filters currently don't work).
- Touches: `assignment/page.tsx`, submitted view, `calendar/page.tsx`. Prefer one shared filter module
  consumed by all three to avoid drift.

### C. Per-VA budget system — Section 2  *(new feature; own vertical)*
Largest net-new build; self-contained enough to run in parallel with B once A's schema is settled.
- Per-VA remaining-budget display; unit is **hours or dollars** (admin picks).
- **Shift** field on each VA profile (hours or a time range) in Team Management → drives budget.
- Soft warning at **90%** of shift budget (advisory, never hard-blocks).
- Over-budget flow: VA submits request → **any admin** approves; admins can also add budget directly.
- **Schema (Manny):** shift field on `profiles`; a budget/over-budget-request table + approval status.
- Touches: `TeamProfilePanel.tsx`, `team/page.tsx`, assignment surfaces, new API route(s), admin approval UI.

### D. Calendar views — Sections 6 + 7 + 8
- **Month:** bigger, square task dots; a line spanning the dates of tasks with an end date.
- **Day:** multi-VA view as vertical/skinny cards + a VA picker.
- **Navigation:** more date-range options / a date picker.
- Depends on A (end-date/deadline semantics feed the span line and deadline markers).
- Touches: `calendar/page.tsx`.

### E. Edit-permission fix — Section 9  *(bug fix; low risk, high value)*
- Admin currently can't edit fixed-pay-form / output-based tasks the way per-task ones can. Extend the
  existing edit function to admin for both the fixed-pay form and output-based tasks — consistent across
  all VAs and admin.
- Touches: `FixedPayTasksTab.tsx` / `FixedPayTasksPanel.tsx`, `TaskAssignmentsAdminTab.tsx`, `TaskEditor.tsx`.

### F. Layout/UX polish — Sections 1 + 10  *(independent, small)*
- **1a:** Horizontal scroll/rollover on the assignment bar so all fields show.
- **1b:** "Output-based available tasks" section — collapsed by default for **VAs**, expanded for **admin**,
  everywhere it appears.
- **10:** Unscheduled panel cards become collapsible/expandable to review task details before scheduling
  (today they show only name + account + Schedule button).
- Touches: `assignment/page.tsx` and the unscheduled panel component.

---

## Suggested sequence

1. **A — Date/time model** (finish the started slice: migration + shared UI). Unblocks B's date filters and D's calendar markers.
2. **E + F** in parallel — quick, low-risk wins (edit-permission fix; scroll, role-aware collapse, collapsible unscheduled cards). Good momentum, independent of A.
3. **B — Filtering.** Build shared filter logic, apply to list → submitted → calendar.
4. **D — Calendar views.** Builds on A's end-date/deadline semantics and B's calendar filters.
5. **C — Budget system.** Own vertical; needs its own schema + approval UI. Can start once A's schema lands.

## Schema / approval dependencies (Manny owns all DB work)

- `assigned_tasks.due_time` column — Section 5 / Workstream A.
- `profiles` **shift** field — Section 2 / Workstream C.
- Budget + over-budget-request storage & approval status — Section 2 / Workstream C.

None of the UI workstreams should assume these columns exist until the migration is confirmed live.

## Open questions to resolve before building

- **Budget unit (C):** stored per-VA, or global org default with per-VA override?
- **Shift as time range (C):** how does a time range convert to a budget number (span → hours)? Timezone source?
- **Overdue filter (B):** overdue by due date, end date, or either?
- **Multi-VA day view (D):** cap on simultaneous VAs before the skinny cards stop being legible?

---

# Part II — Objective as a Basecamp-style workspace

Direction set by Toni (2026-08-12) using **Basecamp** as the reference model. Today an **Objective** is a
single details form + a flat subtask list. The target turns each Objective into a **project workspace**: a
tiled dashboard of tools scoped to that objective, sitting under a global shell (Activity / Calendar /
Reports / Everything) with quick-jump navigation.

This is a **large, later initiative** — separate from the 10-section Assignment/Calendar round in Part I.
Captured here so it can be picked up cold. Nothing below is committed to a phase yet.

## Priority legend
- **[Want]** — Toni explicitly likes/wants it.
- **[Nice]** — explicitly called out as nice-to-have.
- **[Derived]** — implied by the model; confirm before building.

## Vocabulary map (Basecamp → MinuteFlow)
| Basecamp | MinuteFlow equivalent |
|---|---|
| Project | **Objective** (`VAProjectsTab kind="objective"`) |
| Project members | Objective's **Assigned VAs** (+ admin) |
| Card Table / cards | Kanban pipeline over the objective's tasks; card ≈ `assigned_task` (detail ≈ `TaskEditor`) |
| To-dos | Objective subtasks + `task_todos` |
| Calendar | Existing **Productivity Hub Calendar**, scoped to the objective |
| Message Board / Chat | net-new (existing `messages` table is 1:1 DM/notification, not project-scoped) |

---

## 1. Per-Objective workspace — the dashboard tiles  *(replaces today's single form)*

A selected Objective opens a **grid of tiles** instead of one long form ("I like how organized this is").
Proposed tiles:

| Tile | What it does | Priority | Status / reuse |
|---|---|---|---|
| **Message Board** | Posts/announcements scoped to the objective (kickoff, FYIs, pitches) | [Want] | Net-new. `messages` table is 1:1 DM — needs objective-scoped posts + comments. |
| **Docs & Files** | Files/docs attached to the objective | [Want] | Partly exists — task attachments API (`assigned-tasks/[id]/attachments`); needs an objective-level file area. Screenshots stay on Drive (hard rule). |
| **To-dos rollup** | The to-do lists of **everyone assigned** to the objective, grouped by person/list | [Want] | Reuse subtasks + `task_todos`; net-new is the per-person rollup view. |
| **Card Table (Kanban)** | Pipeline board (e.g. Scheduled → Recorded → Editing → Approved → Done, + "Not now"). Cards open individually to assignee / due / notes / **subtasks** | [Want] | Board is net-new; card detail ≈ existing `TaskEditor`. Needs a per-objective column/status model. |
| **Calendar + Agenda** | Calendar and Agenda (list) views of the objective's dated tasks — **fed by and synced with the existing Productivity Hub Calendar**, not a separate calendar | [Want] | Reuse `calendar/page.tsx` scoped by objective; **Agenda list view is net-new**. |
| **Chat** | Realtime chat limited to the objective's members | [Want] | Net-new (project-scoped). Supabase realtime already used for `messages`. |

**Confirm-before-build (from earlier, still open):**
- Message Board vs. Docs & Files = **two separate tiles** (assumed), not one merged.
- Objective Calendar must **reflect/sync the existing app Calendar** both ways (assumed).

---

## 2. Global shell & navigation

Top-level destinations that sit **above** individual objectives (Basecamp's top nav):

| Destination | Purpose | Priority |
|---|---|---|
| **Activity** | Cross-cutting activity feed (see §3) | [Want] |
| **Calendar** | Existing Productivity Hub Calendar (already a tab) | have |
| **Reports** | Reports hub (see §4) | [Want] |
| **Everything** | Cross-project rollup: All messages / docs / tasks / comments | [Nice] |

Plus a **jump-to search** — "search or jump to a project, person, or recent page" — with a
**recently-visited** list. [Derived] Command-palette style; ties the hub together.

> Fits the existing `ProductivitySubNav`. Open question: do these become new subnav tabs, a global
> command palette, or both?

---

## 3. Latest Activity feed  *(Want)*

Basecamp "Latest Activity": a timeline of who did what, grouped by day, with **Timeline** and **Wrap-up**
(daily-summary) modes, filterable **by project** and **by person**, and an optional emailed daily summary.

- **Reuse:** `time_logs` already capture per-person work; `ActivityLog.tsx` renders a time-log feed today.
- **Net-new:** a broader event stream (comments, to-dos added/completed, cards moved, members added,
  files posted) — not just time logs. Needs an activity/event source (either derive from existing tables
  or add an events table — **schema decision for Manny**).
- Per-objective activity tile can be the same feed filtered to one objective.

## 4. Reports hub  *(Want; Mission Control is the standout)*

Basecamp "Choose a Report" grid. Priority items for MinuteFlow:

| Report | Priority | Reuse |
|---|---|---|
| **Mission Control** — progress "needle"/gauge per objective ("move the needle") | [Want] | `ProductivityMeterWidget` + `reports/page.tsx` already render a meter/gauge — strong starting pattern. Needs a per-objective progress metric (e.g. % subtasks done). |
| **Upcoming tasks** — to-dos/cards with upcoming due dates | [Derived] | `assigned_tasks` due/start dates. |
| **Overdue to-dos** — what's running late across objectives | [Derived] | Overlaps Part I §3 Overdue filter. |
| **Unassigned tasks** — tasks with no assignee | [Derived] | `assigned_task_assignees` emptiness. |
| **Tasks added/completed** — daily log | [Derived] | status transitions. |
| **Someone's tasks / Someone's activity** — per-person view | [Derived] | filter by `va_id`. |

Home is the existing `reports/page.tsx` (currently time/hours focused) — extend it, don't fork.

## 5. Everything (cross-project rollup)  *(Nice-to-have)*

All messages / All docs & files / All tasks / All comments across every objective. Aggregation views over
the same sources as the per-objective tiles; build after the per-objective tiles exist.

---

## Schema / approval dependencies (Part II — Manny owns all DB work)
- **Message Board + Chat:** objective-scoped posts/comments + a project chat channel (existing `messages`
  is 1:1). New table(s) likely.
- **Activity feed:** an event stream source — derive from existing tables or add an events table.
- **Kanban:** per-objective column/status model for cards.
- **Mission Control:** a defined per-objective progress metric.
- Objective-level **file area** (task attachments exist; objective-level does not).

## Open questions (Part II)
- **Kanban columns:** fixed set, or admin-configurable per objective?
- **Card ↔ task identity:** is a Kanban card exactly an `assigned_task`, or a lighter card type that can promote to a task?
- **Activity source:** derive events from existing tables, or introduce a dedicated events table (cost vs. fidelity)?
- **Mission Control metric:** % subtasks complete, weighted by pay/hours, or a manual "needle" the admin sets?
- **Navigation:** new subnav tabs vs. a global command palette (jump-to search) vs. both?
- **VA vs. admin scope:** which tiles/reports are VA-visible vs. admin-only?

---

## 6. Nested goals, streaks & rollup gauge  *(Want)*

Direction (2026-08-12): Objectives should **nest** — a big goal/project contains sub-goals/sub-projects.
As sub-goals complete, the system **measures progress and builds streaks**, and the parent goal shows a
**gauge** (ties directly to Mission Control, §4).

### What already exists
- **`Project.parent_project_id`** — the hierarchy is **already in the schema**. A project can point at a
  parent project. Objectives are `Project` rows with `kind="objective"`.
- **`Project.linked_objective_id`** — operations can link to the objective they support (a related, softer link).
- Tasks nest under a project via `assigned_tasks.parent_task_id` (task-level, separate from project-level nesting).

### What's missing (the delta)
- **Nesting UI:** `VAProjectsTab` renders objectives as a **flat list** today. Needs a tree/hierarchy view —
  create a sub-objective under a parent, reparent, and navigate parent ⇄ children.
- **Completion concept:** `Project` has only `is_active` (boolean) — **no "completed" status and no completion
  timestamp**. Streaks and "sub-project completed" measurement need one. **Schema (Manny):** add a
  completion status + `completed_at` (and likely a per-user or per-goal streak record, or derive streaks
  from completion history).
- **Streaks:** define what a streak counts (consecutive sub-goals completed? completions per week without a
  miss?) and at what grain (per VA, per goal, per account).
- **Rollup gauge:** parent goal's Mission Control needle is computed from children — e.g. % of sub-goals
  completed, optionally weighted. Reuse `ProductivityMeterWidget`; the gauge in §4 and this rollup are the
  same mechanism at the parent level.

### Open questions
- **Streak definition & grain:** what breaks a streak, and is it per-VA, per-goal, or per-account?
- **Gauge metric:** parent progress = plain % of sub-goals done, or weighted (by pay / hours / priority)?
- **Depth:** just two levels (goal → sub-goal), or arbitrary nesting? `parent_project_id` allows arbitrary;
  confirm the UI should too.
- **Completion trigger:** does a sub-goal auto-complete when all its tasks/subtasks are done, or is it a
  manual admin/VA action?
