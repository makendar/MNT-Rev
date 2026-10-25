export type Role = "owner" | "manager" | "rep";

export interface User {
  id: number;
  org_id: number;
  name: string;
  email: string;
  role: Role;
  title: string;
  team_id: number | null;
  active: number;
}

export interface Stage {
  id: number;
  name: string;
  position: number;
  probability: number;
  is_won: number;
  is_lost: number;
  expected_days: number;
}

export type ForecastCategory = "pipeline" | "best_case" | "commit" | "omitted";

export interface Deal {
  id: number;
  org_id: number;
  account_id: number;
  contact_id: number | null;
  name: string;
  amount: number;
  stage_id: number;
  owner_id: number;
  source: string;
  product_line: string;
  expected_close_date: string;
  created_at: string;
  stage_entered_at: string;
  last_activity_at: string | null;
  next_step: string;
  next_step_date: string | null;
  forecast_category: ForecastCategory;
  close_date_pushes: number;
  lost_reason: string | null;
  closed_at: string | null;
  notes: string;
}

export interface DealRow extends Deal {
  account_name: string;
  owner_name: string;
  stage_name: string;
  contact_name: string | null;
  risk: RiskResult;
  priority: PriorityResult;
}

export interface RiskFactor {
  code: string;
  label: string;
  detail: string;
  points: number;
}

export interface RiskResult {
  score: number;
  level: "low" | "medium" | "high";
  factors: RiskFactor[];
}

export interface PriorityResult {
  score: number;
  reasons: string[];
}

export interface Account {
  id: number;
  name: string;
  industry: string;
  city: string;
  size: string;
  website: string;
  owner_id: number;
  created_at: string;
}

export interface Contact {
  id: number;
  account_id: number;
  name: string;
  title: string;
  email: string;
  phone: string;
  is_decision_maker: number;
}

export type ActivityType = "call" | "email" | "meeting" | "demo" | "note";

export interface Activity {
  id: number;
  deal_id: number | null;
  account_id: number | null;
  user_id: number;
  user_name?: string;
  type: ActivityType;
  subject: string;
  notes: string;
  outcome: string;
  occurred_at: string;
}

export interface Task {
  id: number;
  deal_id: number | null;
  deal_name?: string | null;
  account_name?: string | null;
  assigned_to: number;
  assignee_name?: string;
  created_by: number;
  title: string;
  type: string;
  due_date: string;
  priority: "low" | "medium" | "high";
  status: "open" | "done";
  completed_at: string | null;
}

export interface Insight {
  id: string;
  severity: "critical" | "warning" | "opportunity" | "info";
  category: string;
  title: string;
  explanation: string;
  evidence: { label: string; value: string }[];
  action: string;
  link?: string;
}

export const SOURCES = [
  "Referral",
  "Website",
  "LinkedIn",
  "Partner",
  "Outbound",
  "Event",
  "Existing customer",
] as const;

export const LOST_REASONS = [
  "Price",
  "Chose competitor",
  "No decision / stalled",
  "Budget cut",
  "Timing",
  "Missing capability",
] as const;
