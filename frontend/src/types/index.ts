export interface User {
  id: string;
  name: string;
  email: string;
  phone?: string;
  job_title?: string;
  role: 'owner' | 'administrator' | 'sales_manager' | 'salesperson' | 'estimator' | 'project_manager' | 'technician' | 'accounting' | 'read_only';
  status?: 'active' | 'inactive';
  last_login?: string;
  created_at?: string;
}

export interface Bid {
  id: string;
  name: string;
  loc: string;
  gc: string;
  due: string;
  due_days: number;
  amount: number | null;
  sheets: number;
  contact: string;
  stage: 'due' | 'submitted' | 'awarded' | 'lost';
  salesperson_name: string;
  salesperson_id?: string;
  elec_project_phase?: string;
  loss_reason?: string;
  competitor?: string;
  created_at?: string;
  submitted_at?: string;
  awarded_at?: string;
  drive_job_folder_id?: string;
  drive_plans_folder_id?: string;
  drive_estimates_folder_id?: string;
  drive_photos_folder_id?: string;
  drive_contracts_folder_id?: string;
  drive_gc_folder_id?: string;
  drive_submittals_folder_id?: string;
  drive_rfis_folder_id?: string;
  drive_change_orders_folder_id?: string;
  closed_at?: string;
  co_approved_total?: number;
  sq_ft?: number | null;
  project_type?: string | null;
  date_won?: string | null;
}

export interface EstimateLineItem {
  category: string;
  item: string;
  qty: number;
  unit: string;
  unit_cost: number;
  total: number;
  overridden: boolean;
}

export interface BidEstimate {
  bid_id: string;
  overhead_pct: number;
  profit_pct: number;
  line_items: EstimateLineItem[];
  subtotals: Record<string, number>;
  total_direct: number;
  total_overhead: number;
  total_profit: number;
  grand_total: number;
  comp_count: number;
  confidence: 'LOW' | 'MEDIUM' | 'HIGH';
}

export interface Gen {
  id: string;
  customer: string;
  loc: string;
  mfr: string;
  model: string;
  kw: number;
  amount: number;
  tax: number;
  stage: 'building' | 'sent' | 'awarded' | 'declined' | 'signed';
  built_on: string;
  addons: number;
  salesperson_name: string;
  salesperson_id?: string;
  lead_id?: string | null;
  site_visit_at?: string | null;
  site_visit_needs_time?: boolean;
  gen_install_phase?: string;
  proposal_token?: string;
  proposal_no?: string;
  form_data?: Record<string, unknown> | string | null;
  totals_data?: Record<string, unknown> | string | null;
  sent_at?: string;
  viewed_at?: string;
  signed_at?: string;
  drive_job_folder_id?: string;
  drive_engineering_folder_id?: string;
  drive_permit_folder_id?: string;
  drive_contract_folder_id?: string;
  drive_invoices_folder_id?: string;
  drive_photos_folder_id?: string;
  closed_at?: string;
  date_won?: string | null;
}

export interface WonJob {
  id: string;
  salesperson_name: string;
  customer: string;
  proposal_id: string;
  proposal_type: 'Electrical' | 'Generator';
  value: number;
  date_won: string;
  commission_rate?: number | null;
  commission_amount?: number | null;
  commission_status?: 'earned' | 'paid';
  commission_earned_at?: string | null;
  commission_paid_at?: string | null;
}

export interface Activity {
  id: string;
  kind: string;
  div: string;
  text: string;
  time_label: string;
}

export interface Toast {
  title: string;
  sub?: string;
  action?: { label: string; onClick: () => void };
}

export interface Customer {
  id: string;
  name: string;
  type: 'gc' | 'customer' | 'other';
  company?: string;
  contact_name?: string;
  email?: string;
  phone?: string;
  address?: string;
  city?: string;
  state?: string;
  zip?: string;
  notes?: string;
  owner_id?: string | null;
  bid_count?: number;
  gen_count?: number;
  created_at?: string;
}

export interface Lead {
  id: string;
  name: string;
  email?: string | null;
  phone?: string | null;
  address?: string | null;
  source: 'web' | 'phone' | 'referral' | 'kohler' | 'other';
  contact_method: 'email' | 'phone';
  interest_level: 'unknown' | 'warm' | 'hot' | 'not-interested';
  stage: 'new' | 'contacted' | 'site-scheduled' | 'lost' | 'converted';
  notes?: string | null;
  site_notes?: string | null;
  quoted_range?: string | null;
  follow_up_date?: string | null;
  linked_gen_id?: string | null;
  salesperson_name?: string | null;
  salesperson_id?: string | null;
  created_at?: string;
  last_activity_at?: string | null;
  site_visit_at?: string | null;
  site_visit_needs_time?: boolean;
}

export interface LeadActivity {
  id: string;
  lead_id: string;
  kind: string;
  direction?: 'in' | 'out' | null;
  text: string;
  created_by?: string | null;
  created_at: string;
}

export interface CustomerDetail {
  customer: Customer;
  bids: Bid[];
  gens: Gen[];
  wonJobs: WonJob[];
  communications: { id: string; kind: string; subject: string; body: string; author: string; created_at: string; linked_id: string | null; linked_name: string | null }[];
  documents: { id: string; linked_id: string | null; linked_name: string | null; div: string; name: string; display_name: string; category: string; file_size: number; file_type: string; uploaded_by: string; created_at: string }[];
  tasks: { id: string; title: string; notes?: string; due_date?: string | null; status: 'open' | 'done'; linked_name?: string | null; assigned_to_name?: string | null; created_at: string }[];
}

// ── Command Center "morning brief" (mirrors backend/src/services/brief.ts) ──
export type BriefChip = 'Elec' | 'Gen' | 'Call';

export interface BriefAttentionItem {
  id: string;
  type: 'email' | 'lead-call' | 'bid' | 'task' | 'lead-stale' | 'gen-signed';
  chips: BriefChip[];
  title: string;
  subtitle: string;
  receivedAt: string | null;
  briefing: string;
  cta: { webLink?: string; tel?: string; navTo?: string; leadId?: string };
}

export interface TodayEvent {
  id: string;
  subject: string;
  start: string;
  end: string;
  location: string | null;
  webLink: string | null;
  isAllDay: boolean;
}

export interface BriefPayload {
  generatedAt: string;
  graphEnabled: boolean;
  kpis: {
    activeBids: number; activeBidsValue: number;
    activeGens: number; activeGensValue: number;
    wonThisMonth: number; wonThisMonthValue: number;
    leadsNeedingCall: number; unreadEmails: number;
  };
  attention: BriefAttentionItem[];
  kohlerFunnel: {
    received: number; notAccepted: number; accepted: number; replied: number; needCall: number;
    newToday: number; newYesterday: number;
  };
  intake: { unread: number; newToday: number; newYesterday: number };
  todayEvents: TodayEvent[];
  daySummary: string;
  briefBullets: string[];
}
