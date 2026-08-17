# Dev Workflow Rules — Neil's Claude Code Sessions

## Important: this file is separate from `CLAUDE.md` / `AGENTS.md`
This repo already has `CLAUDE.md` and `AGENTS.md`, which describe a **different, automated
agent pipeline** ("Jun" the implementer, "Manny" the orchestrator, CRM tickets, Telegram
bot updates, a VPS at `/home/redbot/manny-bot/`). That pipeline is not this workflow —
**do not** follow its commit-gate signals (`JUN_DONE`, `JUN_QUESTION`), Telegram posting
steps, or CRM ticket API calls. Those require infrastructure/secrets this environment
doesn't have and aren't relevant to a human-driven local session.

**What IS worth reusing from `AGENTS.md`:** the MinuteFlow color palette, badge/card/button
patterns, and the "App Flows — Do Not Break These" section. Read those for design
consistency, but treat them as reference material, not instructions to execute.

## Who's driving
This is a **human-in-the-loop** session. Neil reviews every step before it's committed.
Claude Code should pause and show its work at natural checkpoints rather than completing
an entire feature unsupervised.

## Non-negotiable rules
1. **Never touch `main` directly.** Confirm the current branch with `git status` before
   writing any file. If not on the expected feature branch, stop and say so.
2. **Never `git push` or open a pull request** unless Neil explicitly says to. Local
   commits only — pushing is a manual, deliberate action Neil does himself.
3. **Never touch Supabase schema, migrations, or RLS policies**, and never run raw SQL
   against the live database. This is a live production app — schema changes need a
   human decision, not an agent one.
4. **Never modify `.env`, secrets, API keys, or deploy configuration.**
5. **Never edit `CLAUDE.md` or `AGENTS.md`** — those belong to the Jun/Manny automation,
   not this workflow. If a new rule needs to be added for *this* workflow, add it here
   instead.
6. **Stay inside the stated file scope.** If a task says "modify X, create Y," don't
   also refactor, rename, or "clean up" unrelated files. If something looks broken but
   is outside scope, report it — don't fix it unprompted (see "Reporting issues" below).
7. **No new dependencies without asking first.** If a task seems to need a new npm
   package, stop and ask before installing.
8. **Match existing patterns exactly.** Before building any new UI, find the closest
   existing component and copy its structure, spacing, and class names. Don't invent a
   new visual pattern when one already exists for a similar purpose.

## Standard workflow for any task
1. Confirm branch (`git status`, `git branch`).
2. State a short plan (files to create, files to modify, what stays untouched) before
   writing code.
3. Build/modify in small steps. Pause after each meaningful step for review — don't
   chain the entire feature into one uninterrupted run.
4. Run `npm run lint` and `npm run build` before considering any step "done."
5. Before committing, show `git status` / `git diff --stat` so Neil can see exactly
   what changed.
6. Commit locally with a clear message. Stop. Wait for the next instruction.

## Keeping your branch in sync with `main` (do this often)

Since teammates — including Toni directly — push real work to `main` regularly, your
branch can fall behind fast. Stale branches lead to wasted work (see: the Submissions
feature, already built on `main` before this branch found out). Sync **before starting
any new task**, and periodically during longer sessions.

### Quick check — is `main` ahead of you?
```powershell
git fetch origin
git log main..origin/main --oneline
```
Empty output = you're already caught up, skip the rest. Non-empty = new commits exist,
proceed below. (If a pager opens, press `q` to exit.)

### Sync routine
```powershell
git checkout main
git pull origin main
git checkout feature/objective
git merge main
```
- If this opens an editor for a merge commit message, just save and exit with the
  default message (`Esc` then `:wq` then `Enter` in Vim), or avoid the editor entirely
  next time by committing with `git commit --no-edit` if it stops mid-merge.
- If merge conflicts appear (git will clearly list "Unmerged paths"), **stop and ask
  before resolving** — don't guess on a conflict resolution alone.
- After merging, **restart the dev server** (`Ctrl+C`, then `npm run dev`) — hot reload
  can get confused by a large merge. If `package.json`/`package-lock.json` changed in
  the merge, run `npm install` first.

### When to run this
- At the start of every new work session, before writing any code.
- Before starting a new feature/task, even mid-session.
- Anytime you're about to ask "does X already exist?" — check `main` first, it might
  already be answered.

### Claude Code should do this too
Add to the kickoff prompt (see `docs/claude-code-prompt-template.md`) — Claude Code
should run the "quick check" above at the start of any session and flag it if `main`
is ahead, rather than assuming the branch is current.

## Reporting issues found along the way
If something looks broken, inconsistent, or risky while working (e.g. a landmine like
the ones documented in `AGENTS.md`'s Invoice System section), **report it, don't silently
fix it** — unless fixing it is the explicit task. Flag it clearly, e.g.:

> ⚠️ Found while working: `X` appears to do `Y`, which looks like it could cause `Z`.
> Not fixing this now since it's outside scope — flagging for a separate ticket/task.

## Definition of done (for any task)
- [ ] Correct branch confirmed at start.
- [ ] Diff is limited to the agreed file scope — verified with `git diff --stat`.
- [ ] No new dependencies added without explicit approval.
- [ ] `npm run lint` and `npm run build` both pass.
- [ ] No Supabase schema/migration changes.
- [ ] `.env` / secrets untouched.
- [ ] Nothing pushed, no PR opened — local commit only.
- [ ] Design matches an existing pattern (colors, spacing, component structure).