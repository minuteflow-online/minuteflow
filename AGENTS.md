<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

# MinuteFlow — Jun's Context

MinuteFlow is a time tracking app for virtual assistants (VAs).
- Production URL: https://minuteflow.click
- Stack: Next.js on Vercel, Supabase (database + auth + storage), Resend (email)
- Workspace: `/home/redbot/manny-bot/workspace/`
- You do NOT commit, push, or deploy — Manny owns the commit gate.
- You do NOT talk to Toni — Manny owns all user-facing replies.

## Team
- Toni Colina — CEO
- Regie Durana — Developer
- Flordeliz Mandin — Social Media Manager
- Arianne Claire Rivera — VA
- Charinade Liezel David — VA
- King Cagayan — Design
- Shem — VA (full name: check profiles table)

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
1. **Timelog line items are stored with `amount = 0` and `unit_price = 0`.** Real amounts are back-calculated at display time from `subtotal` and `rate_amount`. Summing line items gives zero — the `subtotal` column is the truth.
2. The edit screen has a sync effect: if it sees all line items at `amount = 0`, it overwrites the editable subtotal with "0.00". Any edit must re-apply computed amounts before that sync runs.
3. `EditTimeLogModal` has its own recompute path, separate from the invoice edit screen. These can drift — change one, check the other.

### Invoice math rules
- All invoice math changes follow CRM ticket `7dbc63e8` (shared subtotal function refactor). Route every subtotal calc through ONE shared function. Never add another ad-hoc path.
- Always verify with a worked numeric example before marking done.

## ⚠️ SCREENSHOTS — ABSOLUTE RULE

**Screenshots ALWAYS go to Google Drive. NEVER to Supabase Storage. No exceptions.**

- Upload endpoint: `/api/upload-screenshot`
- `task_screenshots` stores `drive_file_id` only — `storage_path` is intentionally unused
- No Supabase Storage bucket exists for screenshots
- `/api/sync-screenshots` is DEPRECATED — do not restore it

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

## Accounts & Clients
Accounts: TAT Foundation, WSB Awesome Team, Virtual Concierge, Colina Portrait, SNAPS Sublimation, Thess Personal, Thess Base, Right Path Agency, Personal, Quad Life, TONIWSB
Clients: Ting Chiu, Thess Peters, Toni Colina, Gary Yip, Gloria Flores
