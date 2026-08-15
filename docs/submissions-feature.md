# Feature: Submissions (Documents/Work Product Log)

## Status update after boss's second voicemail — scope significantly changed
Earlier version of this doc assumed Submissions was a brand-new, freestanding concept.
Boss's follow-up voicemail clarified it's actually **an attachment on an existing task**,
not a new top-level entity. This is a smaller, safer build than originally scoped —
read this whole doc before starting, the plan below supersedes the old draft.

## What she actually wants (paraphrased from voicemail 2)
- A submission happens **inside the existing task**, in the same form/window used to
  create/edit a task (the Task Editor). When a VA finishes work, they open that task and
  either **paste a link** or **attach an image/file** — that's the submission.
- All tasks — whether under an Objective or under Operations — already flow through the
  same pipeline (queued → routed to the VA's dashboard → shows in Assignment/Calendar).
  So submissions naturally follow that same single pipeline; no separate routing needed.
- She wants a **new top-level tab**, at the same level as Assignment / Calendar /
  Objective / Operations — called **"Submissions."**
  - This tab is a **filterable table**: filter by specific date or date range, showing
    what's been submitted.
  - Pulls from both Objective-tasks and Operation-tasks in one place.
- Additionally, inside an **Objective's or Operation's own detail view**, she wants a
  small **"Submissions" button** — click it to see just the submissions for that
  specific project (a pre-filtered view of the same data).

## Existing building blocks to reuse (confirmed in code — don't reinvent)
- **`AssignedTaskStatus` already includes `'submitted'`** as a lifecycle status
  (`src/types/database.ts`). The task already has a natural "this has been submitted"
  state — use it, don't invent a parallel status.
- **`TaskEditor.tsx` already has an `attachmentsExtra` slot** — a prop explicitly built
  for "callers with their own Attachments UI (upload/list/remove)," rendered inside the
  existing "Attachments & Screenshots" section. This is very likely the intended place
  to add link-paste / file-attach UI for a submission — check this first before adding
  any new UI section to the task form.
- **`FixedPayTaskAttachment` is an existing attachment pattern** (`task_id`, `filename`,
  `storage_path`, `file_size`, `mime_type`, `uploaded_by`, `uploaded_at`, `url`). A new
  submissions-attachment table should likely mirror this shape for consistency, rather
  than inventing a different structure.
- **`AssignedTask.link`** already exists as a field — verify in the live UI whether this
  is already used for something else (e.g. a reference link set when the task is
  created) before assuming it's free to repurpose as "submission link." If it's already
  used, a new field (e.g. `submission_link`) is needed instead.
- **Pay periods already exist** (`period_start`/`period_end` pattern from
  `FinancialSummaryTab.tsx`) — reuse this pattern for the date-range filter on the new
  Submissions tab, don't invent a new period concept.

## Remaining open questions (smaller list now — confirm before building)
1. Is `AssignedTask.link` already used for something else? (Check live UI/existing
   tasks with a link set.) Determines whether we reuse it or add a new field.
2. Can a task have **multiple** attachments/links as its submission, or just one?
3. Does setting status to `submitted` require an attachment/link to be present, or can
   a VA mark something submitted with neither (edge case worth deciding up front)?

## Draft plan
1. **Confirm question 1 first** — cheapest thing to check, changes the schema decision.
2. **Schema** (new table, mirroring `FixedPayTaskAttachment`, or a new
   `submission_link` column on `AssignedTask` — exact shape depends on Q1/Q2 above).
   This is still a live-DB schema change — needs sign-off before running, per
   `docs/dev-workflow-rules.md`. Smaller and lower-risk than the original draft, but
   still not something to run unreviewed.
3. **Wire into `TaskEditor` via `attachmentsExtra`** — build the link-paste/file-attach
   UI as a component passed into that slot, not by modifying `TaskEditor` internals.
4. **New "Submissions" tab** in the Productivity sub-nav (`ProductivitySubNav.tsx`),
   alongside Assignment/Calendar/Objective/Operations — a filterable table view,
   reading from `AssignedTask` rows where `status = 'submitted'` (or wherever the
   submission data ends up living per step 2), filterable by date/date range.
5. **"Submissions" button inside Objective/Operations detail view** — same table
   component as step 4, pre-filtered to `project_id` of the current Objective/Operation.

## Hard rules
- No schema/migration work until question 1 (and ideally 2–3) are confirmed.
- Reuse `attachmentsExtra` — don't fork or duplicate `TaskEditor`'s attachment UI.
- Follow the `FixedPayTaskAttachment` shape for any new attachment table, for
  consistency with the rest of the codebase.
- Stay on `feature/objective` (or discuss with boss whether this deserves its own
  `feature/submissions` branch, since it touches the shared task pipeline used by both
  Objectives and Operations).
- Files: confirm storage approach matches whatever `FixedPayTaskAttachment` already
  uses (it uses `storage_path`, i.e. Supabase Storage) — this is a *different* pattern
  from the screenshot rule (screenshots → Google Drive only). Don't conflate the two;
  verify which pattern applies to submission attachments specifically before building.

## Acceptance criteria (once built)
- [ ] A VA can submit a link and/or attachment from within the existing Task Editor,
      via the `attachmentsExtra` slot.
- [ ] Submitting sets/reflects the task's `submitted` status.
- [ ] New "Submissions" tab shows a filterable table (by date/date range) of all
      submissions across Objectives and Operations.
- [ ] A "Submissions" button inside an Objective/Operation detail view shows only that
      project's submissions (same table, pre-filtered).
- [ ] No duplicate/parallel attachment system created — reuses existing patterns.
- [ ] `npm run lint` and `npm run build` pass.
