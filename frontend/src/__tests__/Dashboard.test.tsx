import { render, screen, waitFor } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { RunView } from "../types";

// Vitest runs from frontend/; the fixtures are the real files in data/.
const fixture = (p: string) => resolve(process.cwd(), "..", p);
const demoFile = JSON.parse(readFileSync(fixture("data/demo/demo_result.json"), "utf8"));
const demoInputs = JSON.parse(readFileSync(fixture("data/demo/inputs.json"), "utf8"));
const demoConfig = JSON.parse(readFileSync(fixture("data/demo/config.json"), "utf8"));
const oldFormat = JSON.parse(readFileSync(fixture("data/demo_result.json"), "utf8"));

vi.mock("../api", () => ({
  ApiError: class extends Error {},
  api: {
    getConfig: vi.fn(),
    getDecisions: vi.fn(),
    getInputs: vi.fn(),
    addDecision: vi.fn(),
  },
}));
const { api } = await import("../api");
const { Dashboard } = await import("../dashboard/Dashboard");

const view = (result: unknown, extra: Partial<RunView> = {}): RunView => ({
  run_id: null, saved_at: null, model: null, source: "cache", warnings: [], result: result as Record<string, unknown>, inputs: null, ...extra,
});

const PART_A_HEADINGS = [/Data used/, /Demand–supply balance/, /Evidence for/, /Global comparison/, /Cross-region effects/, /Scenarios and actions/, /Recommendations/];
const PART_B_HEADINGS = [/Decision areas/, /Knowledge graph/, /PESTLE coverage/, /Risks and opportunities/, /Time horizon view/, /Optimisation objectives/, /Expected outcomes/, /Data gaps/, /For the human reviewer/];
const ALL_HEADINGS = [...PART_A_HEADINGS, ...PART_B_HEADINGS];

beforeEach(() => {
  vi.mocked(api.getConfig).mockResolvedValue(demoConfig);
  vi.mocked(api.getDecisions).mockResolvedValue([]);
  vi.mocked(api.getInputs).mockResolvedValue(demoInputs);
});

describe("Dashboard", () => {
  it("renders every section for the real demo result", async () => {
    render(<Dashboard view={view(demoFile.result, { inputs: demoInputs.filter((c: { level: unknown }) => c.level !== null) })} />);
    for (const h of ALL_HEADINGS) expect(await screen.findByRole("heading", { name: h })).toBeInTheDocument();
    expect(screen.getByText("CACHED RESULT")).toBeInTheDocument();
    expect(screen.getByRole("navigation", { name: "From data to decisions" })).toHaveTextContent("Outcomes");
    expect(document.querySelectorAll("details.area")).toHaveLength(7);
    expect(document.querySelectorAll(".q .suff").length).toBe(21);
    expect(screen.getAllByText(/Better timing of actions|Lower cost & less waste|Higher availability|Stronger customer retention|Higher margins|Sustainable long-term value/)).toHaveLength(6);
    expect(screen.getByText(/Illustrative inputs influenced this result/)).toBeInTheDocument();
    expect(screen.getByText(/AI analysis of/)).toHaveTextContent("2026-10-04 02:49");
    expect(document.body.textContent).not.toMatch(/gemini/i); // the vendor is never named in the interface
    expect(screen.getAllByRole("button", { name: /shortage risk/i }).length).toBe(3);
    // default selection = most severe cell; its scenarios and action table are shown
    expect(screen.getByRole("table", { name: "Action evaluation" })).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: "Approve" })).toHaveLength(3);
  });

  it("hides every section the result doesn't contain", async () => {
    render(<Dashboard view={view({ executive_briefing: "Only a briefing." })} />);
    expect(screen.getByText("Only a briefing.")).toBeInTheDocument();
    await waitFor(() => expect(api.getDecisions).toHaveBeenCalled());
    for (const h of ALL_HEADINGS) expect(screen.queryByRole("heading", { name: h })).toBeNull();
    expect(screen.queryByRole("navigation", { name: "From data to decisions" })).toBeNull();
    expect(screen.queryByText(/Illustrative inputs influenced/)).toBeNull();
    expect(screen.queryByRole("group", { name: "Dashboard filters" })).toBeNull();
  });

  it("does not crash on an old-format result or garbage", async () => {
    const { unmount } = render(<Dashboard view={view(oldFormat)} />);
    expect(screen.getAllByText(/Data center investment/).length).toBeGreaterThan(0);
    unmount();
    render(<Dashboard view={view({ balance_matrix: "nope", recommendations: [null, 3, { action: "monitor" }], capabilities: { early_warnings: "x" } })} />);
    expect(await screen.findByRole("heading", { name: /Recommendations/ })).toBeInTheDocument();
  });

  it("shows an empty state without a result", () => {
    render(<Dashboard view={null} onGoRun={() => {}} />);
    expect(screen.getByRole("heading", { name: "No analysis yet" })).toBeInTheDocument();
  });
});

describe("hideVendor", () => {
  it("replaces model names and the vendor word, but keeps .env setting names", async () => {
    const { hideVendor } = await import("../result/normalize");
    expect(hideVendor("Analysed with gemini-3.6-flash")).toBe("Analysed with AI model");
    expect(hideVendor("Gemini call failed (models/gemini-2.5-pro busy)")).toBe("AI call failed (AI model busy)");
    expect(hideVendor("Tried 2 model(s): gemini-flash-latest busy x2; gemini-3.5-flash ok.")).toBe("Tried 2 model(s): AI model busy x2; AI model ok.");
    expect(hideVendor("Add this line to .env: GEMINI_API_KEY=<your key>")).toBe("Add this line to .env: GEMINI_API_KEY=<your key>");
  });
});

describe("Data used", () => {
  it("counts the indicators per category", async () => {
    const { DataUsed } = await import("../dashboard/DataUsed");
    render(
      <DataUsed
        result={{ ecosystem_data: { demand_side: [
          { dataset: "Market & policy development", status: "active", card_ids: ["a", "b", "c", "d", "e"] },
          { dataset: "Grid plans & investments", status: "active", card_ids: ["x"] },
        ] } }}
      />,
    );
    expect(screen.getByText("5 indicators")).toBeInTheDocument();
    expect(screen.getByText("1 indicator")).toBeInTheDocument();
    expect(screen.queryByText(/card\(s\)/)).toBeNull();
  });
});

it("does not show the AI agents trail", async () => {
  const { AgentTrail } = await import("../dashboard/AgentTrail");
  render(<AgentTrail result={{ agent_log: [{ agent: "market_intelligence", findings: [{ text: "x" }] }] }} keepHorizon={() => true} />);
  expect(screen.queryByText(/AI agents trail/)).toBeNull();
  expect(screen.queryByText("Market Intelligence Agent")).toBeNull();
});
