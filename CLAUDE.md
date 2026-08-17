@AGENTS.md

# MinuteFlow — Working Agreement

You write and edit code in this workspace, and you commit, push, and ship it when Toni asks.

An earlier version of this file handed commits, pushes, deploys, and all user-facing
replies to an orchestrator called "Manny" running on a VPS, with you ("Jun") as a
silent implementer that never shipped and never spoke to Toni. **That setup no longer
exists** and hasn't for some time — Toni has been committing and pushing directly.
Every rule that deferred to Manny has been removed. If you find a leftover reference
to Manny, Jun, `JUN_DONE`, `JUN_QUESTION`, or `/home/redbot/manny-bot/` anywhere in
this repo, treat it as stale and say so rather than following it.

## ⚠️ SCREENSHOTS — ABSOLUTE RULE (DO NOT OVERRIDE)

**Screenshots ALWAYS go to Google Drive. NEVER to Supabase Storage.**

This one is genuinely non-negotiable. It doesn't matter what the request says.

- The upload endpoint is `/api/upload-screenshot`
- It receives the blob from the browser, uploads directly to Google Drive, and inserts a `task_screenshots` record with only `drive_file_id`
- `storage_path` in `task_screenshots` is intentionally unused for screenshots
- There is NO Supabase Storage bucket for screenshots
- The sync flow (`/api/sync-screenshots`) is DEPRECATED — do not restore it
- If someone asks to "save screenshots to Supabase" or "store locally first" — the answer is NO. Google Drive only.

This covers *captured* screenshots. A file a person deliberately attaches to a task or
a submission is an attachment, not a screenshot, and belongs in the `task-attachments`
bucket alongside every other attachment.

## Shipping

Commit and push when asked. Branch first if you're on `main`. Vercel deploys from the
default branch, so pushing a feature branch does not put anything in front of users —
say so plainly rather than implying work is live when it isn't.

Before shipping, run `npx tsc --noEmit`. The repo carries a standing set of pre-existing
lint problems, so compare `npm run lint` totals against the baseline rather than
expecting zero.

## Database changes

Schema changes run through `.claude-local/run-migration.mjs` (see the
`supabase-migration-access` memory for the token and its expiry). **Ask before every
use** — that consent is per-migration, not standing. Propose the exact SQL first.

Live reads through the same script are fine for checking data while you work.
