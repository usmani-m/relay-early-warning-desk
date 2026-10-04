// WCAG contrast of every text/background token pair in src/tokens.css, light and dark (AA: 4.5:1 text, 3:1 UI parts).
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const SRC = resolve(process.cwd(), "src");
const css = readFileSync(resolve(SRC, "tokens.css"), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");

function block(selector: string): Record<string, string> {
  const start = css.indexOf(`${selector} {`);
  const body = css.slice(css.indexOf("{", start) + 1, css.indexOf("}", start));
  return Object.fromEntries([...body.matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)].map((m) => [m[1], m[2].trim()]));
}

const light = block(":root");
const dark = { ...light, ...block(':root[data-theme="dark"]') };

function hex(theme: Record<string, string>, name: string): string {
  let v = theme[name];
  for (let i = 0; v && v.startsWith("var(") && i < 5; i++) v = theme[v.slice(4, -1).trim()];
  if (!v || !/^#[0-9a-fA-F]{6}$/.test(v)) throw new Error(`${name} is not a 6-digit hex colour (${v})`);
  return v;
}

function luminance(h: string): number {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16) / 255).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export function contrast(a: string, b: string): number {
  const [x, y] = [luminance(a), luminance(b)];
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
}

const STATUSES = ["shortage_critical", "shortage_risk", "watch_shortage", "balanced", "watch_excess", "excess_risk", "excess_critical", "insufficient_data"];

/** [text token, background token] pairs that must reach 4.5:1. */
const TEXT_PAIRS: [string, string][] = [
  ["--ink", "--bg"], ["--ink", "--surface"], ["--ink", "--muted"], ["--ink2", "--bg"], ["--ink2", "--surface"], ["--ink2", "--muted"],
  ["--link", "--surface"], ["--header-ink", "--header-bg"], ["--header-sub", "--header-bg"], ["--tab-ink", "--header-bg"],
  ["--tab-active-ink", "--header-bg"], ["--primary-fg", "--primary-bg"], ["--primary-fg", "--primary-bg-hover"],
  ["--secondary-fg", "--secondary-bg"], ["--danger", "--surface"], ["--danger", "--bg"], ["--danger-ink", "--danger-bg"],
  ["--success", "--surface"], ["--success", "--success-bg"], ["--notice-ink", "--notice-bg"], ["--info-ink", "--info-bg"],
  ["--side-demand", "--surface"], ["--side-supply", "--surface"], ["--illus-ink", "--illus-bg"], ["--level-pos", "--surface"],
  ["--level-neg", "--surface"], ["--level-neutral", "--surface"], ["--stat-shortage", "--surface"], ["--stat-excess", "--surface"],
  ["--stat-watch", "--surface"], ["--strength-low-fg", "--strength-low-bg"],
  ...STATUSES.map((s): [string, string] => [`--st-${s}-fg`, `--st-${s}-bg`]),
  ...["critical", "warning", "watch"].map((l): [string, string] => [`--ew-${l}-fg`, `--ew-${l}-bg`]),
];

/** Non-text UI parts (control borders, focus ring) need 3:1 against what is next to them. */
const UI_PAIRS: [string, string][] = [["--control-border", "--surface"], ["--focus", "--bg"], ["--focus", "--surface"], ["--secondary-border", "--secondary-bg"]];

describe.each([["light", light], ["dark", dark]])("%s theme", (_name, theme) => {
  it.each(TEXT_PAIRS)("text %s on %s is at least 4.5:1", (fg, bg) => {
    expect(contrast(hex(theme, fg), hex(theme, bg))).toBeGreaterThanOrEqual(4.5);
  });
  it.each(UI_PAIRS)("UI %s against %s is at least 3:1", (fg, bg) => {
    expect(contrast(hex(theme, fg), hex(theme, bg))).toBeGreaterThanOrEqual(3);
  });
});

describe("brand rules", () => {
  it("pure ABB Red is the accent and is never used as a text token", () => {
    expect(light["--abb-red"]).toBe("#FF000F");
    expect(contrast("#FFFFFF", "#FF000F")).toBeLessThan(4.5); // why text uses the stronger red
    const textTokens = new Set(TEXT_PAIRS.map(([fg]) => fg));
    for (const [name, value] of Object.entries(light)) if (textTokens.has(name)) expect(value.toUpperCase(), name).not.toBe("#FF000F");
  });

  it("colours are only defined in tokens.css, and Barlow is gone", () => {
    for (const f of readdirSync(SRC).filter((n) => n.endsWith(".css") && n !== "tokens.css")) {
      const text = readFileSync(resolve(SRC, f), "utf8");
      expect(text, f).not.toMatch(/#[0-9a-fA-F]{3,6}\b|rgba?\(/);
      expect(text, f).not.toMatch(/Barlow/);
    }
    expect(readFileSync(resolve(process.cwd(), "index.html"), "utf8")).not.toMatch(/Barlow/);
  });
});
