// Checks an imported inputs JSON file before it is merged into the draft. The server validates again on Save.

import { GLOBAL } from "../types";
import type { Categories, Config, InputCard } from "../types";

export interface ImportResult {
  cards: InputCard[]; // valid cards (normalised)
  errors: string[];
}

const CONFIDENCE = ["low", "medium", "high"];

export function isHttpsUrl(url: string): boolean {
  if (!url) return true; // empty = no source
  try {
    const u = new URL(url);
    return u.protocol === "https:" && !!u.hostname;
  } catch {
    return false;
  }
}

export function validateImport(data: unknown, config: Config, categories: Categories): ImportResult {
  if (!Array.isArray(data)) return { cards: [], errors: ["The file must contain a JSON list of input cards."] };
  const regions = new Set([GLOBAL, ...config.regions]);
  const segments = new Set(config.segments);
  const datasets = { demand: new Set(categories.demand.map((c) => c.name)), supply: new Set(categories.supply.map((c) => c.name)) };
  const cards: InputCard[] = [];
  const errors: string[] = [];
  const seen = new Set<string>();

  data.forEach((raw, i) => {
    const where = raw && typeof raw === "object" && typeof (raw as { id?: unknown }).id === "string" ? `Card ${(raw as { id: string }).id}` : `Item ${i + 1}`;
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
      errors.push(`${where}: not an object.`);
      return;
    }
    const c = raw as Record<string, unknown>;
    const problems: string[] = [];
    if (typeof c.id !== "string" || !c.id) problems.push("missing id");
    if (c.side !== "demand" && c.side !== "supply") problems.push(`side must be "demand" or "supply"`);
    const side = c.side as "demand" | "supply";
    if (typeof c.dataset !== "string" || (side in datasets && !datasets[side].has(c.dataset))) problems.push(`unknown ${side ?? ""} category ${JSON.stringify(c.dataset)}`);
    if (typeof c.region !== "string" || !regions.has(c.region)) problems.push(`unknown region ${JSON.stringify(c.region)}`);
    if (side === "demand" && (typeof c.segment !== "string" || !segments.has(c.segment))) problems.push(`unknown segment ${JSON.stringify(c.segment)}`);
    if (side === "supply" && c.segment != null) problems.push("supply cards have no segment");
    const level = c.level ?? null;
    if (level !== null && !(typeof level === "number" && Number.isInteger(level) && level >= -3 && level <= 3)) problems.push(`level must be a whole number from -3 to +3 or null (got ${JSON.stringify(level)})`);
    const confidence = c.confidence ?? "medium";
    if (!CONFIDENCE.includes(confidence as string)) problems.push(`confidence must be low, medium or high`);
    const url = c.source_url ?? "";
    if (typeof url !== "string" || !isHttpsUrl(url)) problems.push("source_url must be empty or start with https://");
    for (const k of ["evidence_note", "date"] as const) if (c[k] != null && typeof c[k] !== "string") problems.push(`${k} must be text`);
    if (c.is_illustrative != null && typeof c.is_illustrative !== "boolean") problems.push("is_illustrative must be true or false");
    if (typeof c.id === "string" && seen.has(c.id)) problems.push("appears twice in the file");
    if (typeof c.id === "string") seen.add(c.id);

    if (problems.length) {
      errors.push(`${where}: ${problems.join("; ")}.`);
      return;
    }
    cards.push({
      id: c.id as string,
      side,
      dataset: c.dataset as string,
      region: c.region as string,
      segment: side === "demand" ? (c.segment as string) : null,
      level: level as number | null,
      confidence: confidence as InputCard["confidence"],
      evidence_note: (c.evidence_note as string) ?? "",
      source_url: url as string,
      date: (c.date as string) ?? "",
      is_illustrative: (c.is_illustrative as boolean) ?? false,
    });
  });
  return { cards, errors };
}
