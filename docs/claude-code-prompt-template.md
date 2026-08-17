# Reusable Claude Code Kickoff Prompt

Copy the block below into Claude Code at the start of any new task on this repo. Fill in
the bracketed parts. Keep the structure — it's what keeps Claude Code scoped and
checkpointed instead of running off and doing too much at once.

---

## Prompt template

```
Before doing anything else, read `docs/dev-workflow-rules.md` in this repo and follow
it for this entire session. Note: this repo also has a CLAUDE.md/AGENTS.md — those
belong to a separate automated pipeline (Jun/Manny) and do NOT apply here except for
the design-system reference (colors, patterns) — do not follow their commit-gate
signals, ticket API calls, or Telegram posting steps.

Confirm which branch you're currently on before writing anything. Expected branch:
[BRANCH NAME, e.g. feature/objective]. If you're not on it, stop and tell me.

Then check if `main` has moved ahead of this branch (`git fetch origin` then
`git log main..origin/main --oneline`). If there are new commits, tell me what they are
before proceeding — don't start building until we've confirmed nothing you're about to
build already exists on `main`.

## Task
[ONE OR TWO SENTENCES: what you want built, in plain language]

## Files in scope
- Create: [file paths, or "TBD — propose based on task"]
- Modify: [file paths, or "TBD — propose based on task"]
- Do NOT touch: [anything explicitly off-limits for this task]

## Reference / spec
[Link to a detailed spec file if one exists, e.g. docs/objective-gauge-feature.md —
or paste specifics inline if it's a small task]

## How to proceed
1. State your plan (files, approach) before writing code. Wait for my go-ahead.
2. Build in small, reviewable steps — don't chain the whole task into one run.
3. Show me the diff before committing.
4. Run lint + build before calling anything done.
5. Commit locally only. Do not push. Do not open a PR.
```

---

## Example: filled in for the Objective gauge feature

```
Before doing anything else, read `docs/dev-workflow-rules.md` in this repo and follow
it for this entire session. Note: this repo also has a CLAUDE.md/AGENTS.md — those
belong to a separate automated pipeline (Jun/Manny) and do NOT apply here except for
the design-system reference (colors, patterns) — do not follow their commit-gate
signals, ticket API calls, or Telegram posting steps.

Confirm which branch you're currently on before writing anything. Expected branch:
feature/objective. If you're not on it, stop and tell me.

## Task
Add a small progress gauge (like a speedometer needle) next to each VA on the
Objective tab, showing their individual completion percentage on that objective's
subtasks.

## Files in scope
- Create: src/components/ObjectiveGauge.tsx
- Modify: src/components/ObjectiveProgressView.tsx (minimal — wire in the gauge only)
- Do NOT touch: ProductivityMeterWidget.tsx, VAProjectsTab.tsx task logic, any
  Supabase schema/migrations

## Reference / spec
See docs/objective-gauge-feature.md for full details (progress calculation, visual
style, hard rules, acceptance criteria).

## How to proceed
1. State your plan before writing code. Wait for my go-ahead.
2. Build ObjectiveGauge.tsx in isolation first — show me before wiring it in.
3. Show me the diff before committing.
4. Run lint + build before calling anything done.
5. Commit locally only. Do not push. Do not open a PR.
```

---

## Tips for reusing this
- Keep the top block (workflow rules + branch check) identical every time — that's
  the safety net.
- Only the "Task," "Files in scope," and "Reference / spec" sections change per task.
- For small fixes/tweaks, you can skip writing a separate spec file and just describe
  the task inline — the template still works.
- If Claude Code ever starts doing something that sounds like the Jun/Manny workflow
  (mentioning tickets, Telegram, `JUN_DONE`, deploying), stop it — that means it picked
  up instructions from `CLAUDE.md`/`AGENTS.md` that don't apply to this session.