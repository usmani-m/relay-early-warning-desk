// Result types from the OUTPUT FORMAT in prompts/system_prompt.md (checked against data/demo/demo_result.json).
// Everything is optional: Gemini output may be partial, and older results use another schema.

export type Level = number | null;
export type Likelihood = "low" | "medium" | "high";

export interface CategoryStatus { dataset?: string; status?: string; card_ids?: string[]; note?: string }
export interface DataQualityIssue { card_id?: string; issue?: string; detail?: string }
export interface EcosystemData {
  demand_side?: CategoryStatus[];
  supply_side?: CategoryStatus[];
  integration_layer?: { data_quality_issues?: DataQualityIssue[]; lineage?: unknown[] };
}

export interface InputAssessment {
  id?: string; dataset?: string; agent?: string; region?: string; segment?: string | null; side?: string; pestle?: string;
  what_changed?: string; level?: Level; confidence?: string; indicator_type?: string; lead_time_months?: string; nature?: string;
  anomaly?: boolean; turning_point?: boolean; stale?: boolean; is_illustrative?: boolean;
  combines_conflicting_sources?: boolean; conflict_note?: string;
  supporting_ids?: string[]; contradicting_ids?: string[]; rationale?: string;
}

export interface AgentLogEntry { agent?: string; findings?: { text?: string; card_ids?: string[] }[] }

export interface Orchestration {
  cross_ecosystem_correlations?: { finding?: string; demand_ids?: string[]; supply_ids?: string[] }[];
  noise_vs_real_change?: { card_id?: string; verdict?: string; why?: string }[];
  uncertainties_and_dependencies?: string[];
  learning_from_feedback?: string[];
}

export interface KnowledgeGraph {
  nodes?: { id?: string; type?: string; label?: string }[];
  edges?: { from?: string; to?: string; relation?: string; card_ids?: string[] }[];
}

export interface SupplyByRegion {
  region?: string; supply_source?: string; own_supply?: number | null; own_share?: number | null;
  origin_parts?: { from?: string; share?: number; value?: number }[];
  blended_supply?: number | null; pool_pressure?: number | null; pool_parts?: { from?: string; value?: number }[];
  effective_supply_unrounded?: number | null; effective_supply?: Level; input_ids?: string[]; illustrative_inputs?: string[];
}

export interface BalanceCell {
  region?: string; segment?: string; demand_unrounded?: number | null; demand?: Level; effective_supply?: Level;
  supply_source?: string; gap_unrounded?: number | null; gap?: Level; status?: string;
  input_ids?: string[]; illustrative_inputs?: string[];
}

export interface GlobalComparisonRow {
  region?: string; segment?: string | null; side?: string; region_level?: Level; global_level?: Level;
  difference?: Level; label?: string; input_ids?: string[];
}

export interface CrossRegionEffect {
  from_region?: string; to_region?: string; direction?: string; channel?: string; share?: number | null;
  strength?: Likelihood | string; why?: string; procurement_implication?: string; card_ids?: string[]; involves_illustrative?: boolean;
}

export interface Capabilities {
  early_warnings?: { level?: string; message?: string; card_ids?: string[]; illustrative_inputs?: string[] }[];
  risks_and_opportunities?: { type?: string; description?: string; rating?: string; horizon?: string; card_ids?: string[] }[];
  time_horizon_view?: { short?: string[]; medium?: string[]; long?: string[] };
}

export interface Scenario {
  region?: string; segment?: string; name?: string; triggers?: string[]; likelihood?: string; component_implication?: string; card_ids?: string[];
}

export interface ActionEvaluation {
  region?: string; segment?: string; action?: string; description?: string; score_surge?: Level; score_base?: Level;
  score_reversal?: Level; worst_case?: Level; likelihood_weighted_unrounded?: number | null; selected?: boolean; trade_off?: string;
}

export interface ObjectiveScores { profitability?: Level; customer_value?: Level; growth?: Level; resilience?: Level }

export interface Recommendation {
  priority?: number; decision_area?: string; region?: string; segment?: string; action?: string; components?: string[];
  horizon?: string; act_by?: string; why_robust?: string; cost_if_wrong?: string; would_change_if?: string[]; next_review?: string;
  requires_human_approval?: boolean; human_should_validate?: string[]; card_ids?: string[]; illustrative_inputs?: string[];
  weights_used?: string; objective_scores?: ObjectiveScores; weighted_score?: Level; balance_explanation?: string;
}

export interface DecisionQuestion {
  question?: string; answer?: string; data_sufficiency?: string; missing_data?: string[]; confidence?: string;
  horizon?: string; card_ids?: string[]; illustrative_inputs?: string[];
}
export interface DecisionArea { area?: string; questions?: DecisionQuestion[] }

export interface OptimisationObjectives {
  weights_used?: string; weights?: Record<string, number>; why?: string; main_tension?: string;
}

export interface Meta { model?: string; generated_at?: string; seconds_total?: number; attempts?: unknown[] }

export interface AnalysisResult {
  as_of_date?: string;
  executive_briefing?: string;
  ecosystem_data?: EcosystemData;
  input_assessment?: InputAssessment[];
  agent_log?: AgentLogEntry[];
  orchestration?: Orchestration;
  knowledge_graph?: KnowledgeGraph;
  supply_by_region?: SupplyByRegion[];
  balance_matrix?: BalanceCell[];
  global_comparison?: GlobalComparisonRow[];
  global_comparison_commentary?: { text?: string; regions?: string[]; card_ids?: string[] }[];
  cross_region_effects?: CrossRegionEffect[];
  illustrative_influence?: { any?: boolean; items?: { card_id?: string; influences?: string }[] };
  pestle_coverage?: { counts?: Record<string, number>; missing?: string[]; strongest_driver?: string };
  capabilities?: Capabilities;
  scenarios?: Scenario[];
  action_evaluation?: ActionEvaluation[];
  recommendations?: Recommendation[];
  decision_areas?: DecisionArea[];
  optimisation_objectives?: OptimisationObjectives;
  expected_outcomes?: { outcome?: string; direction?: string; assumption?: string }[];
  data_gaps?: string[];
  human_review_summary?: string;
  _meta?: Meta;
}
