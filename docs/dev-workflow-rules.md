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

## Automation directive (from Toni) — and its hard limits
Toni wants routine work automated with AI: syncing, testing, verification, lint/build
checks — all of that should happen without waiting on manual triggers each time. **But
automation applies only to routine, reversible, non-destructive work.** The boundaries
below are not inefficiencies to optimize away — they are deliberate safety gates that
stay in place regardless of how much else gets automated. Confirmed directly by Toni:
*"don't push on main, don't touch anything in main, just do what is asked and intended
to do"* and *"never touch anything confidential or do anything destructive."*

## Hard boundaries — absolute, never automated, no exceptions
These apply even under full automation. If a task seems to require crossing one of
these, stop and ask a human — do not find a workaround, do not "just this once," do
not assume urgency justifies it.

1. **`main` is read-only from this workflow.** Never push to it, never merge into it,
   never edit it directly, never run anything against it that isn't a plain
   `git pull` (read-only sync). Merging *from* `main` into a feature branch is fine
   (per the sync rule above) — the boundary is one-directional: information flows
   from `main` into feature branches, never the other way, and never automatically.
2. **Never push any branch, or open a PR, without an explicit human "go ahead" in that
   session.** Local commits are always fine and can happen freely — pushing is not.
3. **Never touch anything confidential or destructive.** This explicitly includes:
   - Supabase schema, migrations, RLS policies, or raw SQL against the live database
   - `.env` files, secrets, API keys, tokens, credentials of any kind
   - Vercel/deployment configuration, environment variable scopes (Production/Preview/
     Development) — even just changing a variable's *scope* counts as touching a
     secret, not just editing its value
   - Deleting data, deleting files outside the declared task scope, or any action that
     can't be trivially undone with `git revert`/`git reset`
   - `CLAUDE.md` / `AGENTS.md` (belong to a different, retired automation system —
     leave them alone regardless)
4. **"Automate the routine stuff" means:** syncing with `main`, running lint/build/
   type-checks, writing and running tests, verifying UI behavior (once a safe test
   account exists), drafting diffs and commits locally. It does **not** mean removing
   the human checkpoint before anything in the Hard Boundaries list above happens.

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

## Keeping your branch in sync with `main` (mandatory — do this first, every session)

Since teammates — including Toni directly — push real work to `main` regularly, your
branch can fall behind fast. Stale branches lead to wasted work (see: the Submissions
feature, already built on `main` before this branch found out). **This is not
optional or occasional — it is the first thing to do in every single session, before
reading any other file or writing any code.**

### The rule
1. At the very start of a session, before anything else: run the quick check below.
2. If `main` has moved ahead, **do the sync automatically** — don't ask permission
   first, just do it and report what came in afterward. This has become routine and
   low-risk; treat it like checking `git status`, not like a decision that needs
   sign-off.
3. **Exception — stop and ask if the merge produces actual conflicts** (git will
   clearly say "Unmerged paths" / "CONFLICT"). Conflicts are the one case that needs a
   human decision — don't attempt to resolve them alone.
4. After syncing, briefly summarize what came in from `main` (commit messages, files
   touched) so the person knows what changed, especially anything that overlaps with
   what they're about to work on.

### Quick check — is `main` ahead of you?
```powershell
git fetch origin
git log main..origin/main --oneline
```
Empty output = already caught up, skip the rest. Non-empty = new commits exist,
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
  by committing with `git commit --no-edit` if it stops mid-merge.
- After merging, **restart the dev server** (`Ctrl+C`, then `npm run dev`) — hot reload
  can get confused by a large merge. If `package.json`/`package-lock.json` changed in
  the merge, run `npm install` first.

### Claude Code must do this automatically
This is now step 0 of every Claude Code session on this repo — before reading
`docs/objective-foundation-feature.md` or any other file, before proposing a plan,
before touching any code. See `docs/claude-code-prompt-template.md`, which has this
built into the standard opening block.

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