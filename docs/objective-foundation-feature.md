# Feature: Objective Foundation — Nesting, Cards, and Progress ("Where They Are")

## Status update (after live testing, [DATE])
Verified directly in the app by Neil. This significantly narrows the remaining work —
see "What's actually left to build" below before starting anything.

| Part | Status | Notes |
|------|--------|-------|
| A — Nested Objectives | ✅ **Done** | Confirmed working live: "+" on an Objective creates a child with "Nested under: X (make top-level)" shown in the form. No build work needed. |
| B — Cards | 🔧 **Confirmed: build kanban grid** | Boss confirmed she wants the existing subtask list restyled into a Basecamp-style kanban card grid (columns like the "Scheduled / Recorded / Editing / Approved / Done" example from her Basecamp reference). This is now a real, scoped build task — see "Part B build plan" below. |
| C — "Where they are" (VA progress) | ❌ **Confirmed missing — this is the real build task** | Boss explicitly confirmed she wants this: a way to see, per VA, their progress on an Objective. This is the actual scoped work below. |

## Part B build plan — Kanban card grid for Subtasks

### Goal
Replace (or add as a view toggle — TBD, see open question) the current flat subtask
list with a kanban-style board: columns by status, each subtask shown as a clickable
card within its status column.

### What already exists to build on
- The subtask data itself: `subtasks` array already fetched per selected Objective in
  `VAProjectsTab.tsx`, each with `status`, task name, assignee, account, due date, etc.
  No new data-fetching needed — this is a rendering change.
- `AssignedTaskStatus` enum (`unassigned | pending | on_queue | in_progress | submitted
  | reviewing | revision_needed | approved | completed | paid | cancelled`) — this is
  more granular than Basecamp's 5-column example. Don't invent new statuses; the
  columns should map to this existing enum. Decide column grouping before building —
  e.g. does `reviewing` and `revision_needed` each get their own column, or get grouped
  together? This affects layout — confirm with boss/Neil, don't guess silently.
- Existing status badge colors (documented in `AGENTS.md`'s design system section) —
  reuse these exact colors for consistency, don't invent a new column-color scheme.
- The existing **Edit** button behavior on each subtask row — clicking a card should
  open the same edit flow (`TaskEditor`), just triggered from a card instead of a list
  row.

### Answers from boss (confirmed [DATE])
- **Replace vs. toggle**: Kanban is an **additional option**, not a replacement — build
  a toggle between list view and board view. List view must keep working exactly as-is.
- **Cards = tasks**: Confirmed — "cards" are the existing subtasks/tasks, same entity,
  just displayed differently in board view.
- **Drag-and-drop**: **Yes, required** — cards must be draggable between columns, and
  dragging a card to a column changes its status accordingly.
- **Column/status grouping**: "We will choose what status go to kanban" — **needs one
  follow-up clarification before building**, see below.

### Still open — one follow-up needed before starting
Boss answered: columns should be **Pending → In Progress → Submitted → Reviewed →
Approved → Completed** (6 columns, hardcoded — not a configurable settings screen).
This resolves the "hardcoded vs. settings UI" question from before: it's (a), a
one-time decision.

**Remaining gap — needs one more quick confirm before building**: her 6 labels don't
map 1:1 onto the actual `AssignedTaskStatus` enum (11 values:
`unassigned, pending, on_queue, in_progress, submitted, reviewing, revision_needed,
approved, completed, paid, cancelled`). Three things to resolve:

- [ ] Do `unassigned` and `on_queue` tasks show under **Pending** too, or are they
      excluded from the board (only shown once picked up)?
- [ ] Where does `revision_needed` go? Not in her list — but it's an action-needed
      state (task was reviewed and sent back), so silently dropping it risks hiding
      those tasks from the board. Best guess: it likely belongs back in **Submitted**
      or as part of **Reviewed** — confirm rather than assume.
- [ ] `paid` and `cancelled` — assumed excluded (board is for active work), but confirm
      this is intentional, not an oversight in her answer.

Suggested one-line follow-up to send: *"Quick follow-up on the board columns — where
should tasks that got sent back for revision (revision_needed) show up? And should
on_queue/unassigned tasks appear under Pending, or only show once someone's picked
them up?"*

### Hard rules specific to this part
- Do not change the underlying `AssignedTaskStatus` enum or how status transitions work
  elsewhere in the app (Time Log, Dashboard, Reports all depend on these same values).
  This is a display-only change.
- Reuse `TaskEditor` for the click-to-edit flow — don't build a second edit UI.
- No new npm dependencies for drag-and-drop unless explicitly confirmed as in-scope —
  a simpler click-only version may be enough for v1.

---

## Part C — VA progress display (✅ done)

Boss confirmed this is specifically what she wants added — a way for her to see VA
progress on an Objective. Built and committed on `feature/objective`
(`VAProjectsTab.tsx`, commit `fb9c46c`) as the "Where They Are" card. Kept below for
reference — no more work needed here except the repositioning follow-up noted in the
status table update log (moving it above the edit form for immediate visibility).

### Requirements
- For each VA assigned to an Objective, show their progress on that Objective's
  subtasks — using the same completed/total logic already computed in
  `ObjectiveProgressView.tsx`.
- This is the **data/display layer that the eventual progress needle will consume**
  (see `docs/objective-gauge-feature.md`), but build the correct numbers and a plain
  display first — the visual gauge is still explicitly last priority per the voicemail.
- Should work per sub-objective too (once nested), not just top-level Objectives.

### Where to build it
- Likely lives inside the same Objective detail view shown in the screenshots —
  probably as a new section (e.g. below "Assigned VAs" or near "Subtasks"), showing
  each assigned VA with something like "3 of 5 completed" or a percentage.
- Reuse `ObjectiveProgressView.tsx` if it's already rendered somewhere in this flow, or
  extend it if it's a separate, not-yet-wired-in component. Confirm which is the case
  before writing new code — don't duplicate logic that already exists.

### Explicitly not in scope for this task
- The visual needle/gauge (separate spec, still deprioritized).
- Any rework of the subtask list into a kanban grid (pending boss's answer on Part B).
- Any change to how subtasks are created/assigned (`TaskEditor`, Basics/Schedule/etc.
  accordion) — read from this data, don't modify how it's produced.

## Hard rules (same as project-wide rules — see `docs/dev-workflow-rules.md`)
- Stay on `feature/objective`. Never touch `main`.
- No Supabase schema changes needed — this reads existing subtask/status data.
- Don't modify `ProductivityMeterWidget.tsx` or `VAProjectsTab.tsx`'s core task-creation
  logic — extend/read from it, don't rewrite it.
- Match existing UI patterns (colors, badges, cards) from `AGENTS.md`'s design system
  reference section.

## Open question to confirm with boss (not blocking Part C — can build in parallel)
- [ ] Does the existing subtask list satisfy "cards," or does she want a kanban-style
      card grid instead? Show her the screenshots first.

## Acceptance criteria for Part C
- [ ] Each VA assigned to an Objective shows a correct completed/total (or %) figure.
- [ ] Works for sub-objectives, not just top-level ones.
- [ ] No visual/behavior regressions to the existing subtask list or Objective form.
- [ ] `npm run lint` and `npm run build` pass.