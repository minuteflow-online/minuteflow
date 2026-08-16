<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

# MinuteFlow — Working Context

## Who You Are

You work directly with Toni on MinuteFlow: you research, write the code, run the
checks, and ship it when she asks.

This file previously described a two-agent setup where an orchestrator ("Manny")
did the research, owned all commits and deploys, and relayed every message, while
you ("Jun") only wrote code. **That arrangement is gone.** Any leftover mention of
Manny, Jun, `JUN_DONE`, `JUN_QUESTION`, Telegram WOL updates, or
`/home/redbot/manny-bot/` is stale — flag it rather than following it.

### Still true
- Don't touch `.env`, secrets, or config files
- Don't refactor code outside the task you were asked to do
- Don't invent design — match what's already in the codebase (see the palette below)

---

## Design — Match, Don't Invent

MinuteFlow has a settled visual language. Build from it rather than around it.

1. **Copy the nearest existing component.** Asked to match `AssignedTasksWidget`? Read that file and reuse its card structure, spacing, and color usage rather than writing something new that merely looks similar.
2. **Never introduce new colors.** The palette below is the whole set. If you're unsure which token fits, find the closest existing component and use what it uses.
3. **Never introduce new UI patterns.** Cards, badges, buttons, modals — a pattern for it already exists.
4. **When the spec is silent on appearance,** derive it from an existing component. Ask only if nothing in the codebase settles it.

### MinuteFlow Color Palette (from `src/app/globals.css`)

**Neutrals — use for text, borders, backgrounds:**
| Token | Hex | Use for |
|-------|-----|---------|
| `cream` | #faf7f2 | Page background |
| `parchment` | #f3ede4 | Section dividers, subtle backgrounds |
| `sand` | #e8dfd3 | Borders (cards, inputs, tables) |
| `clay` | #d4c8b8 | Inactive/disabled borders |
| `stone` | #b5a898 | Secondary text, placeholder |
| `bark` | #8b7b6b | Icons, chevrons, tertiary text |
| `walnut` | #6b5b4b | Section labels (uppercase), strong secondary |
| `espresso` | #3d3229 | Primary text, headings |
| `ink` | #2a221a | Darkest text (rare, high emphasis) |
| `white` | #fffdf9 | Card backgrounds |

**Accents — use for status, actions, highlights:**
| Token | Hex | Soft version | Use for |
|-------|-----|-------------|---------|
| `terracotta` | #c2694f | `terracotta-soft` #f0ddd5 | Errors, warnings, count badges |
| `sage` | #6b8f71 | `sage-soft` #dce8dd | Primary buttons, approved/completed states |
| `amber` | #b8860b | `amber-soft` #f5ecd0 | In-progress, caution states |
| `clay-rose` | #b07d6a | `clay-rose-soft` #f0e0d8 | Accent (rare) |
| `slate-blue` | #697a8a | `slate-blue-soft` #dfe5ea | Neutral accents |
| `plum` | #8b6fa8 | `plum-soft` #ede8f5 | Paid status |

### Status Badge Pattern

All status badges follow this exact shape:
```tsx
// rounded pill, tiny text, soft bg + matching border
<span className="text-[10px] font-semibold px-2 py-[2px] rounded-full bg-{color}-50 text-{color}-600 border border-{color}-200">
  Label
</span>
```

**assigned_tasks status colors** (from `AssignedTasksWidget.tsx`):
| Status | Classes |
|--------|---------|
| on_queue | `bg-stone/10 text-stone border-stone/20` |
| in_progress | `bg-amber-50 text-amber-500 border-amber-200` |
| submitted | `bg-sky-50 text-sky-600 border-sky-200` |
| reviewing | `bg-violet-50 text-violet-600 border-violet-200` |
| revision_needed | `bg-amber-50 text-amber-600 border-amber-200` |
| approved | `bg-emerald-50 text-emerald-600 border-emerald-200` |
| completed | `bg-sage-soft text-sage border-sage/20` |
| paid | `bg-purple-50 text-purple-600 border-purple-200` |
| cancelled | `bg-red-50 text-red-500 border-red-200` |

### Card & Layout Patterns

**Section card** (wraps a content block):
```tsx
<div className="rounded-xl border border-sand bg-white p-4 space-y-3">
  <div className="flex items-center justify-between">
    <h3 className="text-xs font-bold text-espresso uppercase tracking-wide">Title</h3>
  </div>
  {/* content */}
</div>
```

**Task list item** (clickable row inside a card):
```tsx
<div className="flex flex-col gap-1.5 py-2.5 px-3 rounded-lg border border-sand bg-white hover:bg-cream transition-colors">
  <div className="flex items-start justify-between gap-2">
    <span className="text-[13px] font-semibold text-espresso leading-tight">{title}</span>
    {/* status badge */}
  </div>
  <div className="text-[11px] text-stone/80">{meta}</div>
</div>
```

**Section label** (above a group of items):
```tsx
<p className="text-[10px] font-semibold text-walnut tracking-wide uppercase">Label</p>
```

### Button Patterns

```tsx
// Primary action
<button className="px-3 py-1 rounded-lg bg-sage text-white text-[11px] font-semibold hover:bg-sage/90 transition-colors disabled:opacity-50">
  Action
</button>

// Secondary / toggle off
<button className="px-3 py-1 rounded-lg text-[10px] font-semibold bg-stone/10 text-stone hover:bg-stone/20 transition-colors">
  Option
</button>
```

### Form Input Pattern

```tsx
<input className="w-full rounded-lg border border-sand px-2 py-1.5 text-xs text-espresso outline-none bg-white" />
<select className="rounded-lg border border-sand px-2 py-1 text-[11px] text-espresso outline-none bg-white" />
```

### Where to Look When a Component Is Named

Told to "match X"? Read `src/components/X.tsx` or `src/app/.../page.tsx` and lift its
`className` strings. Don't reconstruct the styling from memory.

## ⛔ OFF LIMITS — Hard Rules

**Never reach Supabase outside the sanctioned path:**
- No `curl` or any HTTP request to `*.supabase.co`
- No `psql`, `supabase` CLI, or any database CLI command
- No reading or writing files in `supabase/migrations/`
- No reading `.env` for anything beyond the specific command a task hands you

**Why:** a bad query or migration destroys data with no undo, and unlike code there's
no review step to catch it. Everything goes through the one script below, where the
SQL is stated in full and approved before it runs.

## Need Schema or Database Info?

### Table columns / schema → read `src/types/database.ts` FIRST

`src/types/database.ts` holds TypeScript interfaces for the core MinuteFlow tables
(Profile, Session, TimeLog, Invoice, InvoiceLineItem, AssignedTask, and ~30 more). For
"what columns does table X have?" — read that file. It's the schema the app code is
written against, and it's instant.

Caveats:
- It covers the core tables, not every table. If the table you need isn't there, or you're about to depend on a column that isn't listed, confirm against the live DB.
- It's hand-maintained, so for a column you're *unsure* about on a critical path, verify before relying on it.

### Live data, row values, or a schema change → `.claude-local/run-migration.mjs`

```bash
node .claude-local/run-migration.mjs "SELECT count(*) FROM profiles"
```

This calls the Supabase Management API directly. It is the **only** sanctioned DB path.

**Rules:**
- **Reads** (`SELECT`, `WITH`, `EXPLAIN`) — run freely while working.
- **Writes and migrations** — propose the exact SQL and get an explicit yes **for that specific change**, every time. Approval is never standing.
- Get column names and types from `src/types/database.ts` first; use this for live data, not schema discovery.
- The access token expires — see the `supabase-migration-access` memory for the current expiry. If a call starts failing, say the token expired rather than guessing at the error.

---

## Workspace

The MinuteFlow git repo clone you're working in.

### Key file locations

**Schema / types**
```
src/types/database.ts                 — TS interfaces for core DB tables; read this for columns (see "Need Schema or Database Info?" above)
```

**Pages (Next.js App Router)**
```
src/app/(app)/dashboard/page.tsx      — main VA dashboard
src/app/(app)/timelog/page.tsx        — time log view
src/app/(app)/reports/page.tsx        — reports
src/app/(app)/team/page.tsx           — team admin view
src/app/(app)/portal/page.tsx         — client portal
src/app/(app)/task-list/page.tsx      — task list
src/app/(admin)/admin/page.tsx        — full admin panel (very large file)
src/app/(auth)/login/page.tsx         — login
```

**Components**
```
src/components/SessionBanner.tsx      — top bar: clock in/out, break, active task
src/components/TaskEntryForm.tsx      — task entry (3-column left panel)
src/components/DailyTaskPlanner.tsx   — today's plan (3-column center)
src/components/EditTimeLogModal.tsx   — edit time log + invoice math (separate recompute path)
src/components/ActivityLog.tsx        — activity log tab
src/components/FinancialSummaryTab.tsx — invoice financials
src/components/ProjectSidebar.tsx     — projects/tasks sidebar
src/components/TopNav.tsx             — navigation
src/components/PaystubTab.tsx         — paystub management
src/components/CorrectionRequestModal.tsx
src/components/LiveSessionPrompt.tsx
src/components/AssignedTasksWidget.tsx
```

**API Routes**
```
src/app/api/invoices/send/route.ts
src/app/api/invoices/pay/[token]/route.ts
src/app/api/invoices/public/[token]/route.ts
src/app/api/assigned-tasks/route.ts
src/app/api/time-logs/[id]/route.ts   — (if exists)
src/app/api/profiles/route.ts
src/app/api/task-categories/route.ts
src/app/api/paystub/send/route.ts
src/app/api/upload-screenshot/route.ts  — screenshots go to Drive, NOT Supabase
src/app/api/sync-screenshots/route.ts  — DEPRECATED, do not restore
```

**Lib**
```
src/lib/supabase/client.ts   — browser Supabase client
src/lib/supabase/server.ts   — server Supabase client (use in API routes)
src/lib/utils.ts             — shared utilities
```

**Types**
```
src/types/                   — TypeScript type definitions
```

---

## MinuteFlow System

- **Production URL:** https://minuteflow.click
- **Stack:** Next.js (App Router), Supabase (database + auth), Tailwind CSS, TypeScript, Resend
- **Deploy:** Vercel, from the default branch. Pushing a feature branch does not put anything in front of users.

---

## Team

- Toni Colina — CEO
- Regie Durana — Developer
- Flordeliz Mandin — Social Media Manager
- Arianne Claire Rivera — VA
- Charinade Liezel David — VA
- King Cagayan — Design
- Shem — VA (full name: check profiles table)

---

## Database Tables

**profiles** — id, username, full_name, department, position, role, pay_rate, pay_rate_type

**sessions** — user_id, clocked_in, clock_in_time, active_task (JSONB), session_date, mood, updated_at

**time_logs** — user_id, username, full_name, task_name, category, project, account, client_name, start_time, end_time, duration_ms, billable, client_memo, internal_memo, form_fill_ms, is_manual

**task_screenshots** — user_id, log_id, filename, storage_path, drive_file_id, screenshot_type

**planned_tasks** — user_id, task_name, account, plan_date, sort_order, completed, log_id

**project_tags** — account, project_name, sort_order, is_active

**invoices** — see Invoice System below

**invoice_line_items** — quantity, unit_price, amount, description, va_name, account_name, category, service_date

**invoice_payments** — amount, payment_date, payment_method, reference_number, square_payment_id, square_receipt_url

Other: messages, capture_requests, time_correction_requests, sorting_review

---

## Invoice System — READ BEFORE ANY INVOICE WORK

### Key columns on `invoices`
- `subtotal` — source-of-truth pre-tax total. For timelog invoices this lives on the invoice row, NOT summed from line items.
- `tax_rate`, `tax_amount`, `total` — total = subtotal + tax - adjustment.
- `adjustment_amount` — manual +/- on subtotal.
- `amount_paid`, `previous_balance` — payment tracking.
- `invoice_type` — `"timelog"` (built from logged hours) or `"custom"` (hand-entered). Math path differs.
- `rate_amount` — hourly rate used to back-calculate per-line amounts on timelog invoices.
- `dba` — "doing business as" name on the invoice. Per-invoice, not global.
- `status` — draft / sent / paid / partially_paid / overdue / cancelled / trash / ready_to_send / archived.

### THE LANDMINES

1. **Timelog line items are stored with `amount = 0` and `unit_price = 0`.** Real amounts are back-calculated at display time from `subtotal` and `rate_amount`. Summing line items gives zero — `subtotal` is the truth.

2. The edit screen has a sync effect: if it sees all line items at `amount = 0`, it overwrites the editable subtotal with "0.00". Any edit must re-apply computed amounts before that sync runs.

3. `EditTimeLogModal` has its own recompute path, separate from the invoice edit screen. These can drift — change one, check the other.

### Invoice math rules
- All invoice math changes follow CRM ticket `7dbc63e8` (shared subtotal function refactor). Route every subtotal calc through ONE shared function. Never add another ad-hoc path.
- Always verify with a worked numeric example before marking done.

---

## ⚠️ SCREENSHOTS — ABSOLUTE RULE

**Screenshots ALWAYS go to Google Drive. NEVER to Supabase Storage. No exceptions.**

- Upload endpoint: `/api/upload-screenshot`
- `task_screenshots` stores `drive_file_id` only — `storage_path` is intentionally unused
- No Supabase Storage bucket exists for screenshots
- `/api/sync-screenshots` is DEPRECATED — do not restore it

---

## App Flows — DO NOT BREAK THESE

### Clock In
- Button lives in **SessionBanner** (top bar), NOT Quick Pick
- Creates a time_log: task_name="Clock In", category="Sorting Tasks", account="Virtual Concierge"

### Break Flow
1. Break → current task end_time set, break time_log created, pre-break task saved in state
2. End Break → break log closed, post-break prompt:
   - **Resume Task** → new time_log continuing same task
   - **Start New Task** → memo collection for pre-break task (status + client memo + internal memo), then wizard
3. Memo collection is critical — skipping it leaves tasks without notes

### Task Wizard
- Collects status + memos for the OLD task when switching
- Memos save to the OLD task's time_log, not the new one
- `form_fill_ms` = time spent in wizard (shown as "Wizard Time" in admin/activity/time log summary)

### Quick Pick Sidebar
- Actions: Sorting Tasks, Message, Personal, Coaching, Training, Feedback, Collaboration, Team Dev, Personal Dev
- Clock In/Out/Break are in SessionBanner, not here

### Categories
Task, Message, Meeting, Sorting Tasks, Collaboration, Personal, Break

### VA View
- VAs see: Dashboard, Time Log, Reports (NOT Team page)
- User column hidden for VAs
- 3-column layout: Task Form | Today's Plan | Quick Pick

---

## Accounts & Clients
Accounts: TAT Foundation, WSB Awesome Team, Virtual Concierge, Colina Portrait, SNAPS Sublimation, Thess Personal, Thess Base, Right Path Agency, Personal, Quad Life, TONIWSB
Clients: Ting Chiu, Thess Peters, Toni Colina, Gary Yip, Gloria Flores

---

## TypeScript / Next.js Patterns

- Use **server components by default**. Only add `"use client"` when you need hooks or browser events.
- Supabase in API routes: import from `src/lib/supabase/server.ts`
- Supabase in client components: import from `src/lib/supabase/client.ts`
- Tailwind for all styling — no inline styles, no CSS modules unless one already exists for the component
- Components are in `src/components/`. Pages in `src/app/(app)/` or `src/app/(admin)/`.
- API routes follow Next.js App Router: `src/app/api/<name>/route.ts` with named exports (`GET`, `POST`, etc.)
- Check existing imports in the file before adding new ones — don't duplicate

---

## Working Out Loud

**Report findings, not intentions.** "Found the bug in EditTimeLogModal line 412 — the
sync runs before amounts are re-applied." Not "Looking at EditTimeLogModal now."
