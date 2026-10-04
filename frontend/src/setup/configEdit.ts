// Pure helpers for editing a Config draft. Structural edits only (names, keys); no analysis.

import { GLOBAL } from "../types";
import type { Config } from "../types";

export type Kind = "region" | "segment";

/** JSON with sorted keys, so two configs compare equal regardless of key order. */
export function stableStringify(value: unknown): string {
  return JSON.stringify(value, (_key, v) =>
    v && typeof v === "object" && !Array.isArray(v)
      ? Object.fromEntries(Object.entries(v as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)))
      : v,
  );
}

export function sameConfig(a: Config | null, b: Config | null): boolean {
  return stableStringify(a) === stableStringify(b);
}

/** Problem with a new region/segment name, or null if it's fine. */
export function nameProblem(name: string, existing: string[], kind: Kind, ignore?: string): string | null {
  const n = name.trim();
  if (!n) return `Enter a ${kind} name.`;
  if (n.toUpperCase() === GLOBAL) return `"${GLOBAL}" is reserved for the global baseline.`;
  if (existing.some((e) => e !== ignore && e.toUpperCase() === n.toUpperCase())) return `A ${kind} called "${n}" already exists.`;
  return null;
}

export function addName(config: Config, kind: Kind, name: string): Config {
  const n = name.trim();
  return kind === "region" ? { ...config, regions: [...config.regions, n] } : { ...config, segments: [...config.segments, n] };
}

export function renameInConfig(config: Config, kind: Kind, oldName: string, newName: string): Config {
  if (kind === "segment") {
    return { ...config, segments: config.segments.map((s) => (s === oldName ? newName : s)) };
  }
  const ren = (r: string) => (r === oldName ? newName : r);
  return {
    ...config,
    regions: config.regions.map(ren),
    supply_dependency: Object.fromEntries(
      Object.entries(config.supply_dependency).map(([r, row]) => [ren(r), Object.fromEntries(Object.entries(row).map(([o, v]) => [ren(o), v]))]),
    ),
    demand_competition: Object.fromEntries(Object.entries(config.demand_competition).map(([r, v]) => [ren(r), v])),
  };
}

export function deleteFromConfig(config: Config, kind: Kind, name: string): Config {
  if (kind === "segment") return { ...config, segments: config.segments.filter((s) => s !== name) };
  return {
    ...config,
    regions: config.regions.filter((r) => r !== name),
    supply_dependency: Object.fromEntries(
      Object.entries(config.supply_dependency)
        .filter(([r]) => r !== name)
        .map(([r, row]) => [r, Object.fromEntries(Object.entries(row).filter(([o]) => o !== name))]),
    ),
    demand_competition: Object.fromEntries(Object.entries(config.demand_competition).filter(([r]) => r !== name)),
  };
}

/** Set one dependency share (rounded to 2 decimals); 0 removes the entry. */
export function setDependency(dep: Config["supply_dependency"], region: string, origin: string, value: number) {
  const row = { ...(dep[region] || {}) };
  const v = Math.round(value * 100) / 100;
  if (v > 0) row[origin] = v;
  else delete row[origin];
  return { ...dep, [region]: row };
}

export type FieldKey = "regions" | "segments" | "categories" | "competition" | "pool" | "general" | `dep:${string}`;

/** Which form field a server validation message belongs to. */
export function fieldForMessage(msg: string): FieldKey {
  const dep = msg.match(/supply_dependency\[([^\]]+)\]/);
  if (dep) return `dep:${dep[1]}`;
  if (msg.includes("supply_dependency")) return "general";
  if (msg.includes("demand_competition")) return "competition";
  if (msg.includes("pool_pressure")) return "pool";
  if (/active_datasets|categor/i.test(msg)) return "categories";
  if (/segment/i.test(msg)) return "segments";
  if (/region|GLOBAL/i.test(msg)) return "regions";
  return "general";
}

export function groupMessages(messages: string[]): Partial<Record<FieldKey, string[]>> {
  const out: Partial<Record<FieldKey, string[]>> = {};
  for (const m of messages) (out[fieldForMessage(m)] ??= []).push(m);
  return out;
}

const EPS = 1e-9;
const pct = (v: number) => `${Math.round(v * 100)}%`;

/** Shares sourced from other regions for one consuming region (the own share is 1 minus this). */
export function rowSum(config: Config, region: string): number {
  return Object.entries(config.supply_dependency[region] ?? {})
    .filter(([o]) => o !== region && config.regions.includes(o))
    .reduce((s, [, v]) => s + v, 0);
}

export function dependencyValid(config: Config): boolean {
  return config.regions.every((r) => rowSum(config, r) <= 1 + EPS);
}

/** Plain-language line, e.g. "AMER: 50% own, 40% APAC, 10% EUROPE" (others largest first); an error if the row is over 1. */
export function structureLine(config: Config, region: string): { text: string; error: string | null } {
  const sum = rowSum(config, region);
  const others = Object.entries(config.supply_dependency[region] ?? {})
    .filter(([o, v]) => o !== region && config.regions.includes(o) && v > 0)
    .sort((a, b) => b[1] - a[1]);
  if (sum > 1 + EPS) {
    return { text: `${region}: ${others.map(([o, v]) => `${pct(v)} ${o}`).join(", ")}`, error: `shares from other regions add up to ${pct(sum)}; at most 100%` };
  }
  const parts = [`${pct(1 - sum)} own`, ...others.map(([o, v]) => `${pct(v)} ${o}`)];
  return { text: `${region}: ${parts.join(", ")}`, error: null };
}
