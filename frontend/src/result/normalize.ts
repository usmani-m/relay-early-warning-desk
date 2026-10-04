// Turns whatever came back (Gemini output, an old-format result, a partial result) into the AnalysisResult shape:
// lists are always arrays of objects (or strings), objects are objects or undefined. Never throws.
// This only cleans types; it never computes or changes a value.

import { LEVEL_LABELS, PLAIN_MEANING } from "../scale";
import type { Side } from "../scale";
import type { AnalysisResult } from "./types";

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);

/** Array of objects (drops anything else). */
export function objs<T>(v: unknown): T[] {
  return Array.isArray(v) ? (v.filter(isObj) as T[]) : [];
}

/** Array of strings (drops anything else). */
export function strs(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
}

export function obj<T>(v: unknown): T | undefined {
  return isObj(v) ? (v as T) : undefined;
}

export function text(v: unknown): string {
  return typeof v === "string" ? v : typeof v === "number" ? String(v) : "";
}

export function num(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

const LIST_KEYS = [
  "input_assessment", "agent_log", "supply_by_region", "balance_matrix", "global_comparison", "global_comparison_commentary",
  "cross_region_effects", "scenarios", "action_evaluation", "recommendations", "decision_areas", "expected_outcomes",
] as const;
const OBJ_KEYS = [
  "ecosystem_data", "orchestration", "knowledge_graph", "illustrative_influence", "pestle_coverage", "capabilities",
  "optimisation_objectives", "_meta",
] as const;

/** The interface never names the AI vendor: model names become "AI model", "Gemini" becomes "AI".
 *  .env setting names such as GEMINI_API_KEY are kept on purpose (\b does not match before "_"), so config errors stay fixable. */
export function hideVendor(s: string): string {
  return s.replace(/\b(?:models\/)?gemini-[\w.-]+/gi, "AI model").replace(/\bgemini\b/gi, "AI");
}

/** Apply hideVendor to every string in a JSON value (copy; the original is not changed). */
function hideVendorDeep(v: unknown): unknown {
  if (typeof v === "string") return hideVendor(v);
  if (Array.isArray(v)) return v.map(hideVendorDeep);
  if (isObj(v)) return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, hideVendorDeep(x)]));
  return v;
}

export function normalizeResult(raw0: unknown): AnalysisResult {
  const raw = hideVendorDeep(raw0);
  if (!isObj(raw)) return {};
  const out: Record<string, unknown> = {};
  for (const k of LIST_KEYS) if (k in raw) out[k] = objs(raw[k]);
  for (const k of OBJ_KEYS) if (isObj(raw[k])) out[k] = raw[k];
  for (const k of ["as_of_date", "executive_briefing", "human_review_summary"] as const) if (typeof raw[k] === "string") out[k] = raw[k];
  if ("data_gaps" in raw) out.data_gaps = strs(raw.data_gaps);
  return out as AnalysisResult;
}

/** A level as its scale name ("Favorable"); with a side, its meaning too ("Unfavorable (tight)"). "–" when missing. */
export function levelName(v: unknown, side?: Side, missing = "–"): string {
  const n = num(v);
  if (n === null || !LEVEL_LABELS[n]) return missing;
  const name = LEVEL_LABELS[n][0].toUpperCase() + LEVEL_LABELS[n].slice(1);
  return side ? `${name} (${PLAIN_MEANING[side][n]})` : name;
}

/** Signed level text: +2, −1, 0; "–" when missing. Kept for accessibility/debug use; the UI shows levelName. */
export function signed(v: unknown): string {
  const n = num(v);
  if (n === null) return "–";
  return n > 0 ? `+${n}` : n < 0 ? `−${Math.abs(n)}` : "0";
}

/** An unrounded intermediate number as given (2 decimals), "–" when missing. */
export function decimal(v: unknown): string {
  const n = num(v);
  if (n === null) return "–";
  const s = Math.abs(n).toFixed(2);
  return n < 0 ? `−${s}` : s;
}

/** "flexible_commitment" -> "Flexible commitment". */
export function humanize(v: unknown): string {
  const s = text(v).replace(/_/g, " ").trim();
  return s ? s[0].toUpperCase() + s.slice(1) : "";
}

/** Join short texts: items that already end with . ! or ? are joined with a space, others with "; ". */
export function joinTexts(items: string[]): string {
  return items.map((s, i) => (i < items.length - 1 && !/[.!?]$/.test(s.trim()) ? `${s.trim()};` : s.trim())).join(" ");
}
