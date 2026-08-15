# Feature: Objective Foundation — Nesting, Cards, and Progress ("Where They Are")

## Status update (after live testing, [DATE])
Verified directly in the app by Neil. This significantly narrows the remaining work —
see "What's actually left to build" below before starting anything.

| Part | Status | Notes |
|------|--------|-------|
| A — Nested Objectives | ✅ **Done** | Confirmed working live: "+" on an Objective creates a child with "Nested under: X (make top-level)" shown in the form. No build work needed. |
| B — Cards | ⚠️ **Mostly done, one open question** | A rich subtask list already exists per Objective (status badge, task name, VA, account, due date, billing type, Edit button, plus an Add Subtask form with Basics/Schedule/Details/Assignment/Attachments sections). Functionally this already covers "cards attached to an objective, clickable." Open question: does boss want this list restyled into a Basecamp-style kanban card grid (columns like Scheduled/Recorded/Editing/Approved/Done), or is the existing list acceptable? **Show her the screenshots before doing any visual rework** — don't rebuild this speculatively. |
| C — "Where they are" (VA progress) | ❌ **Confirmed missing — this is the real build task** | Boss explicitly confirmed she wants this: a way to see, per VA, their progress on an Objective. This is the actual scoped work below. |

## What's actually left to build: Part C only

Boss confirmed this is specifically what she wants added — a way for her to see VA
progress on an Objective. Build this next; don't touch A or B unless her answer on the
Part B visual question requires it.

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
