// The 7-point scale used everywhere (CLAUDE.md). Labels only; the frontend never calculates with levels.

export type Side = "demand" | "supply";

export const LEVELS = [-3, -2, -1, 0, 1, 2, 3] as const;

export const LEVEL_LABELS: Record<number, string> = {
  3: "strongly favorable",
  2: "favorable",
  1: "slightly favorable",
  0: "neutral",
  [-1]: "slightly unfavorable",
  [-2]: "unfavorable",
  [-3]: "strongly unfavorable",
};

/** What a level means in plain words, per side (demand: growth; supply: + loose, − tight). */
export const PLAIN_MEANING: Record<Side, Record<number, string>> = {
  demand: { 3: "strong growth", 2: "clear growth", 1: "some growth", 0: "flat", [-1]: "some slowdown", [-2]: "clear slowdown", [-3]: "sharp decline" },
  supply: { 3: "very loose", 2: "loose", 1: "easing", 0: "normal", [-1]: "tightening", [-2]: "tight", [-3]: "very tight" },
};

/** "+2", "−1", "0". */
export function signedLevel(level: number): string {
  return level > 0 ? `+${level}` : level < 0 ? `−${Math.abs(level)}` : "0";
}

export function formatLevel(level: number | null): string {
  if (level === null) return "No data";
  return `${signedLevel(level)} ${LEVEL_LABELS[level]}`;
}

/** "Favorable: clear growth" (demand) or "Unfavorable: tight" (supply); "No data" for null. */
export function plainLabel(level: number | null, side?: Side): string {
  if (level === null) return "No data";
  const base = LEVEL_LABELS[level];
  const label = base[0].toUpperCase() + base.slice(1);
  return side ? `${label}: ${PLAIN_MEANING[side][level]}` : label;
}
