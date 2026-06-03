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
  gen_install_phase?: string;
  proposal_token?: string;
  sent_at?: string;
  viewed_at?: string;
  signed_at?: string;
}

export interface WonJob {
  id: string;
  salesperson_name: string;
  customer: string;
  proposal_id: string;
  proposal_type: 'Electrical' | 'Generator';
  value: number;
  date_won: string;
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
