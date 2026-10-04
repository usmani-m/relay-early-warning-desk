import { describe, expect, it } from "vitest";
import { isHttpsUrl, validateImport } from "../inputs/importValidation";
import type { Categories, Config, InputCard } from "../types";

const config: Config = {
  regions: ["EUROPE", "AMER"],
  segments: ["Infrastructure", "Utilities"],
  active_datasets: ["Grid plans & investments", "Lead times & allocations"],
  supply_dependency: {},
  demand_competition: {},
  pool_pressure_factor: 0.5,
  policy_weights: { profitability: 30, customer_value: 25, growth: 25, resilience: 20 },
  dependencies_are_examples: false,
};
const categories: Categories = {
  demand: [{ name: "Grid plans & investments", abb_internal: false }],
  supply: [{ name: "Lead times & allocations", abb_internal: false }],
  max_active_per_side: 3,
};
const good: InputCard = {
  id: "D|EUROPE|Utilities|Grid plans & investments",
  side: "demand",
  dataset: "Grid plans & investments",
  region: "EUROPE",
  segment: "Utilities",
  level: 2,
  confidence: "low",
  evidence_note: "note",
  source_url: "https://example.org/x",
  date: "2025-01-22",
  is_illustrative: false,
};
const supply: InputCard = { ...good, id: "S|GLOBAL|Lead times & allocations", side: "supply", dataset: "Lead times & allocations", region: "GLOBAL", segment: null, level: null, source_url: "" };

describe("validateImport", () => {
  it("accepts a valid export", () => {
    const res = validateImport([good, supply], config, categories);
    expect(res.errors).toEqual([]);
    expect(res.cards).toEqual([good, supply]);
  });

  it("rejects bad level, http URL, unknown region and non-list files", () => {
    const res = validateImport(
      [{ ...good, level: 5 }, { ...good, id: "b", source_url: "http://example.org" }, { ...good, id: "c", region: "MARS" }, { ...supply, segment: "Utilities" }],
      config,
      categories,
    );
    expect(res.cards).toEqual([]);
    expect(res.errors[0]).toMatch(/level must be a whole number/);
    expect(res.errors[1]).toMatch(/https/);
    expect(res.errors[2]).toMatch(/unknown region "MARS"/);
    expect(res.errors[3]).toMatch(/supply cards have no segment/);
    expect(validateImport({ cards: [] }, config, categories).errors[0]).toMatch(/JSON list/);
  });

  it("checks URLs", () => {
    expect(isHttpsUrl("")).toBe(true);
    expect(isHttpsUrl("https://a.b/c")).toBe(true);
    expect(isHttpsUrl("http://a.b")).toBe(false);
    expect(isHttpsUrl("www.a.b")).toBe(false);
  });
});
