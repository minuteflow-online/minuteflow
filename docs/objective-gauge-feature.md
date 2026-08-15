# Feature: Objective Progress Gauge (Shared Meter with Per-VA Markers)

## ⚠️ Design correction — read before building
An earlier version of this doc (and an earlier elicitation answer in this chat) assumed
**separate small gauges, one per VA**. Boss clarified with a concrete Basecamp example
this is wrong — see below. This version supersedes that assumption.

## What she actually wants (clarified via Basecamp screenshot example)
Boss pointed to Basecamp's "Move the Needle" feature as a visual reference — **but
explicitly wants it different in one key way**:
- In Basecamp, the needle is **manually dragged** by a person self-reporting status
  (On track / Some risk / Concerned).
- She wants ours to be **automatic** — computed from real data (subtask completion),
  not manually set by anyone.
- **One big meter per Objective** (not one gauge per VA).
- **Each VA assigned to the Objective shows up as their own marker/pin positioned along
  that same shared arc**, based on their individual progress. Think multiple runners on
  one race track, each at their own position — not separate tracks per runner, and not
  a single averaged team needle either. Every VA's position is visible simultaneously
  on the same gauge.

## Priority note (unchanged)
Still explicitly **last priority** per the original voicemail. Part C ("Where They Are"
text/bar display, already built in `VAProjectsTab.tsx`) comes first and is done. This
gauge is a visual layer on top of that same data — build it only when boss/Neil decide
it's time, not before.

## Data layer — already built, reuse it
`VAProjectsTab.tsx` already computes `vaProgress`, a memoized array of
`{ vaId, name, total, completed }` per VA (per-node, not rolled up into nested
sub-objectives — matches the earlier agreed decision). The percentage for each VA's pin
position is simply `completed / total * 100`, already derivable from this same data
(see how `pct` is computed inline in the existing "Where They Are" render loop —
reuse that exact calculation, don't recompute differently).

## Visual design
- **Semicircle arc gauge** (like Basecamp's), SVG-based, no new dependencies.
- **Track**: a single arc from 0% (left) to 100% (right), representing the Objective's
  overall scale.
- **Per-VA markers**: small dots/pins placed along the arc at each VA's own percentage
  position. Each marker should be distinguishable per VA — consider a small avatar
  initial or color-coded dot with a name label/tooltip, matching existing avatar-circle
  patterns already used elsewhere in the app (e.g. the "NP" circle in the top nav).
- **No single "needle"** in the traditional sense — since there's no single value to
  point at (each VA has their own value). If boss also wants an overall
  Objective-level aggregate indicator (e.g. average of all VAs, or % of all subtasks
  done regardless of assignee) shown as a distinct needle *in addition to* the VA
  markers, confirm this — don't assume it, it wasn't stated explicitly.
- Color logic (reuse from earlier draft): red/terracotta under 50%, amber 50–99%, sage
  at 100% — apply per-marker, based on that VA's own percentage.

## Open question to confirm before building
- [ ] Does she want an overall Objective-level indicator on the same gauge (e.g. "team
      average" or "% of all subtasks done"), in addition to individual VA markers? Her
      description focused entirely on individual VA positions ("like a race") — don't
      add a team-average needle unless she confirms she wants one too.

## Hard rules (unchanged from original)
1. Do not edit `ProductivityMeterWidget.tsx` — unrelated existing feature.
2. No Supabase schema changes — reads existing subtask/status data via `vaProgress`.
3. Do not modify task-assignment or subtask-creation logic in `VAProjectsTab.tsx` —
   only add a new gauge component that reads `vaProgress`, don't alter how it's computed.
4. Do not touch `main`. Stay on `feature/objective` (or whatever branch is current).
5. No new npm dependencies — plain SVG.
6. Match existing color tokens from `AGENTS.md`'s design system reference.

## Files to create
- `src/components/ObjectiveGauge.tsx` — new, isolated, presentational component.
  - Props: `{ vaProgress: { vaId: string; name: string; total: number; completed: number }[] }`
    (reuse the exact shape already produced in `VAProjectsTab.tsx` — no reshaping needed).
  - Pure/dumb component: no data fetching inside it, just renders markers from the
    array it's given.

## Files to modify (once built)
- `src/components/VAProjectsTab.tsx` — render `<ObjectiveGauge vaProgress={vaProgress} />`
  near/instead of (TBD, confirm with Neil) the existing "Where They Are" bars — likely
  the gauge becomes a visual replacement or companion to those bars, not a third
  separate section. Decide placement when this work actually starts.

## Acceptance criteria
- [ ] Gauge renders one shared arc per Objective, with a marker per VA at their correct
      position.
- [ ] Markers update correctly as VA progress changes (0%, partial, 100%).
- [ ] No visual/behavior change to any other tab or component.
- [ ] No new dependencies added.
- [ ] `npm run build` succeeds with no new errors/warnings.