// Card ids and placeholders. Same id rule as backend/inputs_sync.py::card_id, so the server keeps them on save.

import { GLOBAL } from "../types";
import type { Config, InputCard, Side } from "../types";

export function cardId(side: Side, region: string, segment: string | null, dataset: string): string {
  return side === "demand" ? `D|${region}|${segment}|${dataset}` : `S|${region}|${dataset}`;
}

export function emptyCard(side: Side, region: string, segment: string | null, dataset: string): InputCard {
  return {
    id: cardId(side, region, segment, dataset), side, dataset, region, segment: side === "demand" ? segment : null,
    level: null, confidence: "medium", evidence_note: "", source_url: "", date: "", is_illustrative: false,
  };
}

/** Placeholder cards (no data) for a category that has never had cards, for GLOBAL and every region. */
export function missingCards(config: Config, cards: InputCard[], side: Side, dataset: string): InputCard[] {
  const have = new Set(cards.map((c) => c.id));
  const out: InputCard[] = [];
  for (const region of [GLOBAL, ...config.regions]) {
    for (const segment of side === "demand" ? config.segments : [null]) {
      const c = emptyCard(side, region, segment, dataset);
      if (!have.has(c.id)) out.push(c);
    }
  }
  return out;
}

/** Every region x segment the Inputs tab steps through: GLOBAL first, then the regions. */
export function combinations(config: Config): { region: string; segment: string }[] {
  return [GLOBAL, ...config.regions].flatMap((region) => config.segments.map((segment) => ({ region, segment })));
}
