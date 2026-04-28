export type UserRole = 'admin' | 'manager' | 'va';

export const VA_POSITION_OPTIONS = [
  "Full-time VA",
  "Part-time VA",
  "Project Based VA",
  "Per Task VA",
  "Admin",
] as const;

export type VaPosition = typeof VA_POSITION_OPTIONS[number];

export interface Profile {
  id: string;
  username: string;
  full_name: string;
  department: string | null;
  position: string | null;
  role: UserRole;
  pay_rate: number;
  pay_rate_type: 'hourly' | 'daily' | 'monthly';
  is_active: boolean;
  can_see_available_tasks: boolean;
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
  created_at: string;
  deleted_at: string | null;
}

export interface TaskScreenshot {
  id: number;
  user_id: string;
  log_id: number | null;
  filename: string;
  storage_path: string;
  drive_file_id: string | null;
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
  status: 'draft' | 'sent' | 'paid' | 'partially_paid' | 'overdue' | 'cancelled';
  from_name: string;
  from_address: string | null;
  from_email: string | null;
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
  amount_paid: number;
  currency: string;
  notes: string | null;
  payment_terms: string | null;
  is_manual: boolean;
  created_by: string | null;
  sent_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface InvoiceLineItem {
  id: number;
  invoice_id: number;
  log_id: number | null;
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
  created_at: string;
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
