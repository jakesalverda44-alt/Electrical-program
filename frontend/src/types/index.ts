export interface User {
  id: string;
  name: string;
  email: string;
  role: 'salesperson' | 'manager' | 'accounting';
}

export interface Bid {
  id: string;
  name: string;
  loc: string;
  gc: string;
  due: string;
  due_days: number;
  amount: number;
  sheets: number;
  contact: string;
  stage: 'due' | 'submitted' | 'awarded' | 'lost';
  salesperson_name: string;
  salesperson_id?: string;
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
  stage: 'building' | 'sent' | 'awarded' | 'declined';
  built_on: string;
  addons: number;
  salesperson_name: string;
  salesperson_id?: string;
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
}
