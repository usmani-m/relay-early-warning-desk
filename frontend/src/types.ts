// Mirrors backend/models.py and the API responses in backend/main.py.

export type Side = "demand" | "supply";
export type Confidence = "low" | "medium" | "high";
export const GLOBAL = "GLOBAL";

export interface PolicyWeights {
  profitability: number;
  customer_value: number;
  growth: number;
  resilience: number;
}

export interface Config {
  regions: string[];
  segments: string[];
  active_datasets: string[];
  supply_dependency: Record<string, Record<string, number>>;
  demand_competition: Record<string, number>;
  pool_pressure_factor: number;
  policy_weights: PolicyWeights;
  dependencies_are_examples: boolean;
}

export interface InputCard {
  id: string;
  side: Side;
  dataset: string;
  region: string;
  segment: string | null;
  level: number | null; // -3..3, null = no data (never 0)
  confidence: Confidence;
  evidence_note: string;
  source_url: string;
  date: string;
  is_illustrative: boolean;
}

export interface Decision {
  as_of: string;
  region: string;
  segment: string;
  recommendation: string;
  decision: "approved" | "adjusted" | "rejected";
  note: string;
}

export interface Category {
  name: string;
  abb_internal: boolean;
}

export interface Categories {
  demand: Category[];
  supply: Category[];
  max_active_per_side: number;
}

export interface Health {
  status: string;
  env_file: boolean;
  has_key: boolean;
  has_model: boolean;
  job_running: boolean;
}

export type JobState = "running" | "done" | "failed" | "cancelled";

export interface Job {
  job_id: string;
  state: JobState;
  progress: { model: string | null; attempt: number; models_tried: number; last_outcome: string | null };
  elapsed_s: number;
  result: Record<string, unknown> | null;
  warnings: string[];
  source: "gemini" | "cache" | null;
  meta: Record<string, unknown> | null;
  error: string | null;
  run_id: string | null;
  inputs: InputCard[] | null; // the cards behind the result (snapshot)
}

export interface RunView {
  run_id: string | null;
  saved_at: string | null;
  model: string | null;
  source: string;
  warnings: string[];
  result: Record<string, unknown>;
  inputs: InputCard[] | null; // null for older runs without a snapshot
}

export interface RunListItem {
  run_id: string;
  saved_at: string;
  model: string;
  source: string;
  warnings_count: number;
}
