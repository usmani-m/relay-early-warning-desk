import type { Decision } from "../types";

export type DecisionValue = Decision["decision"];

/** Same key as the backend upsert: (as_of, region, segment, recommendation). */
export function decisionKey(asOf: string, region: string, segment: string, recommendation: string): string {
  return [asOf, region, segment, recommendation].join("|");
}

/** Latest decision per key (later entries win). */
export function decisionsByKey(decisions: Decision[]): Map<string, Decision> {
  const map = new Map<string, Decision>();
  for (const d of decisions) map.set(decisionKey(d.as_of, d.region, d.segment, d.recommendation), d);
  return map;
}

export const DECISION_LABEL: Record<DecisionValue, string> = { approved: "Approved", adjusted: "Adjusted", rejected: "Rejected" };
