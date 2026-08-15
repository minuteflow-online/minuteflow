# Feature: Per-VA Progress Gauge on Objectives

## Context
MinuteFlow is a **live, in-use production app**. This work must happen entirely on the
`feature/objective` branch and must never modify `main` directly. Treat everything in
this repo as working code that other people depend on right now — prefer adding new
files over editing shared ones, and never touch anything outside the scope below.

## What we're building
On the Productivity → Objective tab, each Objective currently shows a list of VAs with
status badges (see `src/components/ObjectiveProgressView.tsx`). We're adding a small
circular/semicircle "gauge" (like a speedometer needle) next to each VA, showing that
VA's individual completion percentage on that Objective's subtasks.

- **Progress calculation (v1):** `completed / total subtasks * 100` for that VA's
  subtasks under the Objective. Treat `completed`, `approved`, and `paid` statuses as
  "done." Exclude `cancelled` tasks from both numerator and denominator.
- **Layout:** one small gauge per VA (not one shared team gauge). This replaces or sits
  alongside the existing per-VA status badges — your call on layout, but don't remove
  the underlying status data, just present it better.
- **Visual style:** semicircle arc gauge with a needle, similar to a car speedometer.
  Must use the existing Tailwind CSS variables already defined in
  `src/app/globals.css` (e.g. `--color-sage`, `--color-amber`, `--color-terracotta`,
  `--color-sand`, `--color-espresso`) — do not introduce new hardcoded colors.

## Hard rules — do not violate
1. **Do not edit `src/components/ProductivityMeterWidget.tsx`.** That's an unrelated
   existing feature (time-budget bar). Do not repurpose or rename it.
2. **Do not touch Supabase schema, migrations, or RLS policies.** This feature reads
   existing task/status data only — no new tables or columns needed for v1.
3. **Do not modify task-assignment or subtask-creation logic** in
   `src/components/VAProjectsTab.tsx`. You may only *read* the data it already
   produces/fetches, not change how tasks are created, assigned, or scored.
4. **Do not touch `main`.** All commits happen on `feature/objective`. Do not merge,
   rebase onto, or push to `main` under any circumstance — that's a human decision.
5. **Do not modify unrelated pages** (Dashboard, Time Log, Reports, Portal, Calendar,
   Assignment, Operations tabs). Scope is strictly the Objective tab and the two new
   files below.
6. **No new npm dependencies** for the gauge — build it with plain SVG. This avoids
   adding new attack surface / bundle weight for a simple visual.

## Files to create
- `src/components/ObjectiveGauge.tsx` — new, isolated, presentational component.
  - Props: `{ pct: number; label?: string; size?: "sm" | "md" }`
  - Pure/dumb component: **no data fetching, no Supabase calls inside it.** Takes a
    number 0–100 and renders the gauge. This makes it independently testable.
  - Color logic: red/terracotta under 50%, amber 50–99%, sage at 100%.
  - Should render cleanly at `size="sm"` (used per-VA in a row) — this is the primary
    use case for v1.

## Files to modify (minimally)
- `src/components/ObjectiveProgressView.tsx`
  - Where it already computes/loops over each VA's task counts, derive
    `pct = completed / total * 100` (guard against divide-by-zero → show 0%).
  - Render `<ObjectiveGauge pct={pct} label={va.name} size="sm" />` next to/above the
    existing status badge row. Keep the existing badges — don't delete them, this is
    additive.

## Workflow — do this in order, and pause for review between steps
1. Confirm you're on `feature/objective` (not `main`) before writing anything. If not,
   stop and ask.
2. Build `ObjectiveGauge.tsx` in isolation. Show me the component code and a brief
   description of the SVG approach before wiring it into any real page.
3. Wire it into `ObjectiveProgressView.tsx` with the minimal diff described above. Show
   me the diff before committing.
4. Run `npm run lint` and `npm run build` locally to confirm nothing else breaks.
5. Commit with a clear message (e.g. `feat: add per-VA progress gauge to Objective view`).
   Do not push to `origin` — I'll review and push myself.
6. Stop. Do not open a PR, do not merge, do not touch `main`. Wait for my go-ahead.

## Acceptance criteria
- [ ] Gauge renders correctly for 0%, partial, and 100% completion.
- [ ] No visual/behavior change to any other tab or component.
- [ ] `ProductivityMeterWidget.tsx` is untouched (check with `git diff main --stat`).
- [ ] No new dependencies added to `package.json`.
- [ ] `npm run build` succeeds with no new errors/warnings.
- [ ] Diff is limited to: `ObjectiveGauge.tsx` (new) and `ObjectiveProgressView.tsx`
      (modified) — verify with `git status` before committing.
