export type UserRole = 'admin' | 'manager' | 'va' | 'coordinator' | 'specialist' | 'ceo' | 'founder';

export const VA_POSITION_OPTIONS = [
  "Full-time VA",
  "Part-time VA",
  "Project Based VA",
  "Per Task VA",
  "Admin",
] as const;

export type VaPosition = typeof VA_POSITION_OPTIONS[number];

// Department is purely descriptive (see src/lib/financialAccess.ts) — it grants
// no access on its own. This is the default option list shown in the Team
// Management dropdown; any department already in use on a profile (e.g. a
// custom one typed in via "+ Add new department...") is merged in alongside
// these at render time, so the list grows as new ones are added.
export const DEPARTMENT_OPTIONS = [
  "Accounting",
  "IT",
  "Project Management",
  "Operations",
  "Leadership",
  "Marketing",
  "Founder",
] as const;

export interface PaymentAccountDetails {
  gcash?: { number?: string; name?: string };
  bank_deposit?: { bank?: string; account?: string; name?: string };
  paypal?: { email?: string };
  remittance?: { details?: string };
  bank_transfer?: { bank?: string; account?: string; name?: string };
  [key: string]: Record<string, string | undefined> | undefined;
}

export interface Profile {
  id: string;
  username: string;
  full_name: string;
  avatar_url: string | null;
  department: string | null;
  position: string | null;
  role: UserRole;
  pay_rate: number;
  pay_rate_type: 'hourly' | 'daily' | 'monthly' | 'per_task';
  is_active: boolean;
  can_see_available_tasks: boolean;
  visible_for_collaboration: boolean;
  payment_accounts: PaymentAccountDetails | null;
  created_at: string;
  employment_type: string | null;
  requires_extension: boolean;
  extension_popup_shown: boolean;
  // Daily/monthly budget. Time-based VAs (position/pay_rate_type != per_task)
  // are tracked in hours: shift_hours is the direct daily value, or
  // shift_start/shift_end give a time range whose span is used when
  // shift_hours is null; monthly_budget_limit is their monthly hours cap.
  // Output Based VAs (per-task) are tracked in dollars instead: daily_budget_limit
  // is their daily $ cap, monthly_budget_limit their monthly $ cap (same column,
  // unit follows from the VA's type — see isOutputBasedProfile in lib/budget.ts).
  // Null limits mean no cap is set for that VA.
  shift_hours: number | null;
  shift_start: string | null;
  shift_end: string | null;
  daily_budget_unit: 'hours' | 'dollars' | null;
  daily_budget_limit: number | null;
  weekly_budget_limit: number | null;
  monthly_budget_limit: number | null;
  // Granular admin-panel access grants for a plain "va" role account — never
  // changes `role`, never used for Financials/Invoices/Paystubs (those stay
  // hard-locked to role === "admin"). See src/lib/adminPermissions.ts.
  admin_permissions: string[];
  // Free-text label shown in Team Management's "Assignments" column — plain
  // notes only, not tied to task_categories/va_category_assignments (that
  // relational system is still used elsewhere, e.g. ProjectsTasksTab, for
  // real task-claim eligibility).
  assignments_label: string | null;
}

export interface BudgetRequest {
  id: number;
  va_id: string;
  amount: number;
  unit: 'hours' | 'dollars';
  reason: string | null;
  status: 'pending' | 'approved' | 'denied';
  reviewed_by: string | null;
  review_notes: string | null;
  created_at: string;
  reviewed_at: string | null;
  // Which budget the temporary increase applies to.
  period: 'day' | 'week' | 'month';
}

export interface PayRateHistory {
  id: string;
  user_id: string;
  rate_amount: number;
  rate_type: 'hourly' | 'daily' | 'monthly' | 'per_task';
  effective_date: string; // YYYY-MM-DD
  end_date: string | null; // YYYY-MM-DD, null = currently active
  created_at: string;
}

export interface Session {
  id: number;
  user_id: string;
  clocked_in: boolean;
  clock_in_time: string | null;
  active_task: ActiveTask | null;
  clock_out_time: string | null;
  session_date: string | null;
  mood: 'bad' | 'neutral' | 'good' | null;
  updated_at: string;
}

export interface SortingReview {
  id: number;
  log_id: number;
  reviewed_by: string | null;
  status: 'pending' | 'approved' | 'reassigned';
  bill_to: 'internal' | 'client';
  original_account: string | null;
  original_client: string | null;
  final_account: string | null;
  final_client: string | null;
  notes: string | null;
  reviewed_at: string | null;
  created_at: string;
}

export interface TeamAssignment {
  id: number;
  manager_id: string;
  va_id: string;
  created_at: string;
}

export interface ActiveTask {
  task_name: string;
  category: string;
  project: string;
  account: string;
  client_name: string;
  client_memo: string;
  internal_memo: string;
  start_time: string;
  end_time: string | null;
  duration_ms: number;
  logId: string;
  _startMs: number;
  isBreak?: boolean;
  billing_type?: BillingType;
  task_rate?: number | null;
  /** assigned_tasks.id this active log is tied to, if started from an Assigned Task or one of its to-dos. */
  assignedTaskId?: number | null;
  /** "TD1"/"TD2"/etc. if this active log is playing a specific to-do, else null. */
  todoLabel?: string | null;
}

export interface TimeLog {
  id: number;
  user_id: string;
  username: string;
  full_name: string;
  department: string | null;
  position: string | null;
  task_name: string;
  category: string;
  project: string | null;
  account: string | null;
  client_name: string | null;
  start_time: string;
  end_time: string | null;
  duration_ms: number;
  billable: boolean;
  client_memo: string | null;
  internal_memo: string | null;
  is_manual: boolean;
  form_fill_ms: number;
  progress: string | null;
  billing_type: BillingType;
  task_rate: number | null;
  manual_status: 'pending' | 'approved' | 'denied' | null;
  session_date: string | null;
  created_at: string;
  deleted_at: string | null;
  /** e.g. "TD1" — set when this log was started by playing a specific to-do item, not the parent task itself. Internal-only, doesn't affect client_memo/invoicing. */
  todo_label?: string | null;
}

export interface TaskScreenshot {
  id: number;
  user_id: string;
  log_id: number | null;
  filename: string;
  storage_path: string;
  screenshot_type: 'start' | 'progress' | 'end' | 'remote' | 'manual' | 'failed' | null;
  capture_request_id: number | null;
  failure_reason: string | null;
  created_at: string;
  drive_file_id: string | null;
}

export interface CaptureRequest {
  id: number;
  target_user_id: string;
  requested_by: string;
  status: 'pending' | 'captured' | 'failed' | 'expired';
  log_id: number | null;
  screenshot_id: number | null;
  created_at: string;
  completed_at: string | null;
}

export interface Message {
  id: number;
  target_user_id: string;
  sender_id: string;
  content: string;
  read: boolean;
  created_at: string;
}

export interface ExtensionHeartbeat {
  id: number;
  user_id: string;
  extension_version: string | null;
  last_seen: string;
  is_active: boolean;
}

export interface TimeLogEdit {
  id: number;
  log_id: number;
  edited_by: string;
  field_name: string;
  old_value: string | null;
  new_value: string | null;
  edited_at: string;
}

export interface TimeCorrectionRequest {
  id: number;
  log_id: number;
  requested_by: string;
  reason: string;
  requested_changes: Record<string, string>;
  status: 'pending' | 'approved' | 'denied';
  reviewed_by: string | null;
  review_notes: string | null;
  created_at: string;
  reviewed_at: string | null;
}

export interface OrganizationSettings {
  id: number;
  org_name: string;
  logo_url: string | null;
  address: string | null;
  timezone: string;
  billing_email: string | null;
  billing_info: Record<string, unknown>;
  registered_business_name: string | null;
  dba: string | null;
  tax_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface Client {
  id: number;
  name: string;
  active: boolean;
  contact_name: string | null;
  email: string | null;
  phone: string | null;
  address: string | null;
  city: string | null;
  state: string | null;
  zip: string | null;
  country: string | null;
  logo_url: string | null;
  payment_terms: 'due_on_receipt' | 'net_15' | 'net_30' | 'net_45' | 'net_60';
  currency: string;
  tax_id: string | null;
  default_hourly_rate: number | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

export interface Invoice {
  id: number;
  invoice_number: string;
  client_id: number | null;
  status: 'draft' | 'sent' | 'paid' | 'partially_paid' | 'overdue' | 'cancelled' | 'trash' | 'ready_to_send' | 'archived';
  from_name: string;
  from_address: string | null;
  from_email: string | null;
  from_phone: string | null;
  from_logo_url: string | null;
  to_name: string;
  to_contact: string | null;
  to_email: string | null;
  to_address: string | null;
  to_logo_url: string | null;
  issue_date: string;
  due_date: string | null;
  paid_date: string | null;
  subtotal: number;
  tax_rate: number;
  tax_amount: number;
  total: number;
  adjustment_amount: number;
  amount_paid: number;
  currency: string;
  notes: string | null;
  payment_terms: string | null;
  payment_link: string | null;
  reminder_enabled: boolean;
  account_name: string | null;
  service_type: string | null;
  to_phone: string | null;
  is_manual: boolean;
  previous_balance: number | null;
  previous_balance_note: string | null;
  created_by: string | null;
  sent_at: string | null;
  hours_not_billed: number | null;
  hours_not_billed_label: string | null;
  rate_amount: number | null;
  payment_info: string | null;
  share_token: string | null;
  invoice_type: "timelog" | "custom" | null;
  custom_line_items: string | null;
  period_start: string | null;
  period_end: string | null;
  allow_custom_amount: boolean;
  show_all_installments: boolean;
  payment_schedule: PaymentScheduleItem[] | null;
  payment_template_id: number | null;
  dba: string | null;
  amount_due: number | null;
  created_at: string;
  updated_at: string;
}

export interface InvoiceLineItem {
  id: number;
  invoice_id: number;
  log_id: number | null;
  expense_id: number | null;
  description: string;
  va_name: string | null;
  account_name: string | null;
  category: string | null;
  project: string | null;
  client_memo: string | null;
  quantity: number;
  unit_price: number;
  amount: number;
  service_date: string | null;
  start_time: string | null;
  sort_order: number;
  created_at: string;
}

export interface PlannedTask {
  id: number;
  user_id: string;
  task_name: string;
  account: string | null;
  plan_date: string;
  sort_order: number;
  completed: boolean;
  log_id: number | null;
  priority: "urgent" | "important" | "needed" | null;
  start_time: string | null;
  end_time: string | null;
  created_at: string;
  updated_at: string;
}

export interface BreakCorrectionRequest {
  id: number;
  user_id: string;
  session_date: string;
  clock_in_time: string;
  clock_out_time: string;
  shift_duration_ms: number;
  total_break_ms: number;
  allowed_break_ms: number;
  excess_break_ms: number;
  break_log_ids: number[];
  status: 'pending' | 'approved' | 'denied';
  custom_billable_ms: number | null;
  reviewed_by: string | null;
  review_notes: string | null;
  reviewed_at: string | null;
  created_at: string;
}

export interface InvoicePayment {
  id: number;
  invoice_id: number;
  amount: number;
  payment_date: string;
  payment_method: string | null;
  reference_number: string | null;
  notes: string | null;
  recorded_by: string | null;
  square_payment_id: string | null;
  square_receipt_url: string | null;
  created_at: string;
}

/** One installment in a payment schedule */
export interface PaymentScheduleItem {
  label: string;
  amount_type: 'percentage' | 'fixed';
  value: number; // percentage (0–100) or fixed dollar amount
  due_date?: string; // ISO date string (YYYY-MM-DD) for split payment reminders
}

/** Reusable payment split template */
export interface PaymentTemplate {
  id: number;
  name: string;
  items: PaymentScheduleItem[];
  created_at: string;
}

/** Square API credentials */
export interface SquareSettings {
  id: number;
  application_id: string;
  access_token: string;
  location_id: string;
  environment: string;
  created_at: string;
  updated_at: string;
}

export interface TaskCategory {
  id: number;
  category_name: string;
  sort_order: number;
  is_active: boolean;
  created_by: string | null;
  created_at: string;
}

export type BillingType = 'hourly' | 'fixed';

export interface TaskLibraryItem {
  id: number;
  task_name: string;
  is_active: boolean;
  sort_order: number;
  category_id: number | null;
  billing_type: BillingType;
  default_rate: number | null;
  created_by: string | null;
  created_at: string;
}

export interface ProjectTaskAssignment {
  id: number;
  task_library_id: number;
  project_tag_id: number;
  sort_order: number;
  billing_type: BillingType | null;
  task_rate: number | null;
  assigned_by: string | null;
  assigned_at: string;
  task_library?: TaskLibraryItem;
}

export interface VaCategoryAssignment {
  id: number;
  va_id: string;
  category_id: number;
  assigned_by: string | null;
  assigned_at: string;
  task_categories?: TaskCategory;
  profiles?: Pick<Profile, 'id' | 'full_name' | 'username'>;
}

export interface VaProjectAssignment {
  id: number;
  va_id: string;
  project_tag_id: number;
  billing_type: BillingType;
  rate: number | null;
  assigned_by: string | null;
  assigned_at: string;
  profiles?: Pick<Profile, 'id' | 'full_name' | 'username'>;
  project_tags?: {
    id: number;
    account: string;
    project_name: string;
  };
}

export interface VaTaskAssignment {
  id: number;
  va_id: string;
  project_task_assignment_id: number;
  billing_type: BillingType;
  rate: number | null;
  assigned_by: string | null;
  assigned_at: string;
  profiles?: Pick<Profile, 'id' | 'full_name' | 'username'>;
  project_task_assignments?: {
    id: number;
    task_library_id: number;
    project_tag_id: number;
    billing_type: BillingType | null;
    task_rate: number | null;
    task_library?: { id: number; task_name: string };
    project_tags?: { id: number; account: string; project_name: string };
  };
}

export interface ExtensionUploadStatus {
  user_id: string;
  queued_count: number;
  uploaded_today: number;
  consecutive_failures: number;
  last_reported_at: string;
  extension_version: string | null;
}

// ── Assigned Tasks ──────────────────────────────────────────────────────────

export interface RecurringTemplateAttachment {
  id: number;
  template_id: string;
  filename: string;
  storage_path: string;
  file_size: number | null;
  mime_type: string | null;
  uploaded_by: string | null;
  uploaded_at: string;
}

export interface RecurringTaskTemplate {
  id: string;
  title: string;
  task_name?: string | null;
  description: string | null;
  task_detail?: string | null;
  task_notes?: string | null;
  instructions?: string | null;
  instructions_locked?: boolean;
  start_date?: string | null;
  assigned_to: string | null;
  assigned_to_ids?: string[] | null;
  assigned_by: string | null;
  account: string | null;
  project: string | null;
  category: string | null;
  pay_type: string | null;
  recurrence_type: 'daily' | 'weekly' | 'biweekly' | 'monthly' | 'every_2_months' | 'every_3_months';
  recurrence_days: string[] | null;
  recurrence_day_of_month: number | null;
  is_active: boolean;
  is_paused?: boolean;
  created_by?: string | null;
  created_at: string;
  updated_at: string;
  assigned_to_profile?: Pick<Profile, 'id' | 'full_name' | 'username'> | null;
  assigned_to_profiles?: Pick<Profile, 'id' | 'full_name' | 'username'>[] | null;
  assigned_by_profile?: Pick<Profile, 'id' | 'full_name' | 'username'> | null;
  created_by_profile?: Pick<Profile, 'id' | 'full_name' | 'username'> | null;
}

export interface AssignedTask {
  id: number;
  account: string | null;
  project: string | null;
  task_name: string;
  task_detail: string | null;
  task_notes: string | null;
  link: string | null;
  due_date: string | null;
  due_time: string | null;
  start_date: string | null;
  end_date: string | null;
  archived_at: string | null;
  deleted_at: string | null;
  assigned_by: string | null;
  instructions: string | null;
  instructions_locked: boolean;
  fixed_pay_task_id: number | null;
  recurring_template_id: string | null;
  project_id?: string | null;
  parent_task_id: number | null;
  start_time: string | null;
  end_time: string | null;
  pay_type?: string | null;
  review_required: boolean;
  revision_count: number;
  created_by: string | null;
  created_by_profile?: Pick<Profile, 'id' | 'full_name' | 'username'> | null;
  created_at: string;
  updated_at: string;
  status: AssignedTaskStatus;
  assigned_by_profile?: Pick<Profile, 'id' | 'full_name' | 'username'> | null;
  fixed_pay_tasks?: { rate: number } | null;
  recurring_task_templates?: RecurringTaskTemplate | null;
}

export type AssignedTaskStatus = 'unassigned' | 'pending' | 'on_queue' | 'in_progress' | 'submitted' | 'reviewing' | 'revision_needed' | 'approved' | 'completed' | 'paid' | 'cancelled';

export interface AssignedTaskAssignee {
  id: number;
  assigned_task_id: number;
  va_id: string;
  status: AssignedTaskStatus;
  log_id: number | null;
  notes: string | null;
  accuracy_score: number;
  assigned_at: string;
  updated_at: string;
  profiles?: Pick<Profile, 'id' | 'full_name' | 'username'>;
  assigned_tasks?: AssignedTask;
}

/** Enriched view: task + its assignees (used in admin panel) */
export interface AssignedTaskWithAssignees extends AssignedTask {
  assigned_task_assignees: (AssignedTaskAssignee & {
    profiles?: Pick<Profile, 'id' | 'full_name' | 'username'>;
  })[];
}

/** Enriched view: assignee row + task details (used in VA dashboard) */
export interface VAAssignedTask extends AssignedTaskAssignee {
  assigned_tasks: AssignedTask;
}

/** Fixed-pay task row from the fixed_pay_tasks table */
export interface FixedPayTaskWithClaimer {
  id: number;
  task_name: string;
  account: string | null;
  category: string | null;
  rate: number;
  is_active: boolean;
  archived_at: string | null;
  deleted_at: string | null;
  task_detail: string | null;
  task_notes: string | null;
  link: string | null;
  instructions: string | null;
  instructions_locked: boolean;
  status: "open" | "pending" | "on_queue" | "in_progress" | "submitted" | "revision_needed" | "completed" | "cancelled" | "paid";
  start_date: string | null;
  due_date: string | null;
  end_date: string | null;
  project_id: string | null;
  assigned_to: string | null;
  assigned_by: string | null;
  claimed_by: string | null;
  claimed_at: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
  /** Joined linked project (Objective/Operation) — same projects(id, name) join used by assigned_tasks */
  projects?: { id: string; name: string } | null;
  /** Joined profile for the assignee — present on admin responses, absent on VA responses */
  assigned_to_profile?: { id: string; full_name: string; username: string } | null;
  /** Joined profile for the task creator/assigner — present on admin responses */
  assigned_by_profile?: { id: string; full_name: string; username: string } | null;
  /** Joined profile for the claimer — present on admin responses, absent on VA responses */
  claimed_by_profile?: { id: string; full_name: string; username: string } | null;
  /** Joined profile for whoever created the task row — present on admin and VA responses */
  created_by_profile?: { id: string; full_name: string; username: string } | null;
  /** True when this task was claimed by the current VA (VA responses only) */
  claimed_by_me?: boolean;
  /** The assigned_tasks.id linked to this fixed-pay task for the current VA (VA responses only) */
  assigned_task_id?: number | null;
}

export type ProjectKind = "objective" | "operation";

export interface Project {
  id: string;
  name: string;
  account: string | null;
  description: string | null;
  details: string | null;
  notes: string | null;
  created_by: string | null;
  is_active: boolean;
  created_at: string;
  parent_project_id: string | null;
  kind: ProjectKind;
  target_date: string | null;
  linked_objective_id: string | null;
}

export interface FixedPayTaskAttachment {
  id: number;
  task_id: number;
  filename: string;
  storage_path: string;
  file_size: number | null;
  mime_type: string | null;
  uploaded_by: string | null;
  uploaded_at: string;
  url: string | null;
}
