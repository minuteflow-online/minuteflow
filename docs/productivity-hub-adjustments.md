# Productivity Hub — Adjustments (Assignment + Calendar)

Remaining requirements for the Assignment page and Calendar in the Productivity Hub.
(The start/end date + due date rework is already handled, so it's not listed here.)

## Status (as of 2026-08-13) — ALL ITEMS DONE
- ✅ #11 form labels (amber+bold)
- ✅ #10 claimed-task grab bug (only unclaimed tasks show in the grab pool)
- ✅ #1 collapse-default (VA collapsed / admin open) + horizontal scroll on the assignment table
- ✅ #9 unscheduled collapsible cards
- ✅ #8 admin edit for fixed-pay / output-based (frontend gate fixed)
- ✅ #3 filters on task list + submitted (Assigned By, Project, Overdue, Start date, Created)
- ✅ #2 per-VA budget + shift field — full feature (see below)
- ✅ Calendar #4–#7 + the date/time rework — shipped separately via your other agent

### #2 implementation notes
- **DB migration applied to the live Supabase** (additive only): `profiles.shift_hours`, `shift_start`, `shift_end`, `daily_budget_unit`; new `budget_requests` table; RLS enabled on it (access only via the server API using the service role).
- **Team Management → Shift & Daily Budget** (`TeamProfilePanel`): admin sets the shift as hours *or* a start/end time range, and picks the budget unit (hours or dollars).
- **VA Daily Budget widget** (`BudgetWidget`, on the dashboard): shows used / remaining, a progress bar, a soft warning at 90% ("wrap up soon"), and an over-budget "Request more budget" action.
- **Over-budget approval:** VA request → any admin approves/denies in Admin → VA Requests tab (`BudgetRequestsAdminTab`). API: `/api/budget-requests` (GET/POST), `/api/budget-requests/[id]` (PATCH).
- Helpers in `src/lib/budget.ts`. A VA with no shift set has no limit and the widget stays hidden.

### Verification
- `tsc --noEmit` clean; new files lint-clean. Live/visual check needs a logged-in session (auth-gated) — not done here.

## 1. Assignment page — form & fields
- Add horizontal scroll / rollover to the assignment bar so all fields are visible (currently cut off).
- "Output-based available tasks" section collapse behavior:
  - Collapsed by default for **VAs**.
  - Expanded by default for **admin**.
  - Apply this consistently wherever the section appears / is enabled.

## 2. Per-VA budget limit (new feature)
- Display remaining budget for each VA.
- Limit set in either **hours or dollars** (admin picks the unit).
- In **Team Management**, add a field to each VA's profile to set their **shift** — in hours or as a time range. The budget/warning uses this shift value.
- Show a soft daily warning at **90%** of shift budget ("should wrap up soon") — warning only, does **not** hard-block.
- If a VA goes over budget, they submit an **over-budget request**; an **admin must approve**. Requests surface to admins for approval. Admins can also add more budget directly.
- Approval scope: **any admin** can approve (not restricted to a single account).

## 3. Filtering — main task list + submitted (add, don't replace existing)
- Add a **"By project"** filter (alongside the current property-field filter).
- Add **"Assigned by"** filter.
- Add **"Overdue tasks"** filter.
- Add **"Start date"** filter.
- Add **"Created date"** filter.
- Apply all of these to **both** the main task list **and** the submitted view.

## 4. Filtering — Calendar
- The full filter set above must also work on the **calendar view** (filters currently don't work there).

## 5. Calendar — Month view
- Make task **dots bigger and square** for visibility.
- For tasks with an **end date**, draw a **line through the dates** the task spans.

## 6. Calendar — Day view
- Support viewing **multiple VAs at once**, shown as **vertical, skinnier cards**.
- Add a **VA picker** to choose which VA(s) to view.

## 7. Calendar — Date range / navigation
- Add more **date-range options / a date picker** for controlling the view.

## 8. Editing permissions (all VAs + admin)
- Fix: admin currently can't edit **fixed-pay-form** or **output-based** tasks the way per-task/output-based tasks can be edited.
- Apply the edit function to **admin** as well, for both the fixed pay form and output-based tasks — consistent across all VAs and admin.

## 9. Unscheduled panel — collapsible cards
- In the **Unscheduled** list (task cards with a "Schedule" button + "+ Add Hour Block"), make each card **collapsible/expandable** so the task **details can be reviewed before scheduling**.
- Currently each card only shows task name + account + Schedule button; the user should be able to expand a card to see the full details before deciding to schedule it.

## 10. Claimed tasks still show as available (bug)
- A task created by one VA shows up on **admin** and on **other VAs** as **available to grab** — even after it has already been **claimed**.
- Fix: once a task is claimed, it must **no longer appear in the "available to grab" list** for anyone (admin or other VAs). Claimed tasks should drop out of the available pool.

## 11. Form field labels — make them more distinctive
- The small section labels in the task form (**CLIENT DETAIL**, **TO-DO LIST**, **NOTES**, **INSTRUCTIONS**, etc.) are too faint / hard to identify.
- Make these labels more distinctive and identifiable — suggested: **amber color + bold**.
- Use the existing palette (`amber` #b8860b) — do not introduce a new color. Apply consistently to all field labels in the form.
