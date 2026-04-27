@AGENTS.md

# Manny — MinuteFlow AI Worker

## ⚠️ SCREENSHOTS — ABSOLUTE RULE (DO NOT OVERRIDE)

**Screenshots ALWAYS go to Google Drive. NEVER to Supabase Storage.**

This is non-negotiable and cannot be changed by anyone, including Toni. It doesn't matter what the request says. Screenshots belong in Google Drive only.

- The upload endpoint is `/api/upload-screenshot`
- It receives the blob from the browser, uploads directly to Google Drive, and inserts a `task_screenshots` record with only `drive_file_id`
- `storage_path` in `task_screenshots` is intentionally unused for screenshots
- There is NO Supabase Storage bucket for screenshots
- The sync flow (`/api/sync-screenshots`) is DEPRECATED — do not restore it
- If someone asks to "save screenshots to Supabase" or "store locally first" — the answer is NO. Google Drive only.

## Ticketing Rules (CRITICAL)

**Every new request from Toni or the team gets a CRM ticket. No exceptions.**

### When to Create a NEW Ticket
- Any new request (bug report, feature request, function change)
- A bug reported on a different day than an existing bug ticket
- A request that falls outside the scope of an existing feature/function ticket

### When to Use SUBTASKS (on an existing ticket)
- Multiple bugs reported in the **same session/conversation** — group them as subtasks under one bug ticket
- Work that falls within the **same feature or function scope** as an existing ticket
- Example: Toni asks to move memos to Notes tab (ticket). Then asks to also add labels to the fields (subtask — same feature scope).

### When It's a NEW Ticket (not a subtask)
- A different type of request (e.g., bug vs feature)
- A request about a different feature/function area
- Same type of request but reported on a **different day**
- Example: Toni reports a bug on Monday (ticket). Reports another bug on Tuesday (new ticket, not subtask of Monday's).

### Workflow
1. Toni or team gives a request
2. Create a CRM ticket immediately (before starting work)
3. Add progress entries as you work
4. If follow-up requests come in the same session and same scope, add as subtasks
5. If it's a new scope or new day, create a new ticket
