import { useCallback, useEffect, useMemo, useState } from "react";
import { api } from "../api";
import { normalizeResult, objs, text } from "../result/normalize";
import { severity } from "../result/status";
import type { BalanceCell, CrossRegionEffect, InputAssessment, Recommendation, SupplyByRegion } from "../result/types";
import type { Config, Decision, InputCard, RunView } from "../types";
import { AgentTrail } from "./AgentTrail";
import { BalanceSection } from "./BalanceMatrix";
import type { CellKey } from "./BalanceMatrix";
import { CrossRegion } from "./CrossRegion";
import { DataUsed } from "./DataUsed";
import { DecisionAreas } from "./DecisionAreas";
import { decisionKey, decisionsByKey } from "./decisions";
import { GlobalComparison } from "./GlobalComparison";
import { HeaderBanner } from "./HeaderBanner";
import { Objectives } from "./Objectives";
import { Recommendations } from "./Recommendations";
import { ScenariosActions } from "./ScenariosActions";
import { SelectedCell } from "./SelectedCell";
import { StatCards } from "./StatCards";

interface Props {
  view: RunView | null;
  focus?: string;
  dataVersion?: number;
  onGoRun?: () => void;
}

const ALL = "all";
const ALL_OTHER = "ALL_OTHER_REGIONS";

/** Order: config order first, then anything else the result contains. */
function ordered(fromConfig: string[], fromResult: string[]): string[] {
  const inResult = new Set(fromResult);
  return [...fromConfig.filter((x) => inResult.has(x)), ...fromResult.filter((x) => !fromConfig.includes(x))];
}

export function Dashboard({ view, focus = "", dataVersion = 0, onGoRun }: Props) {
  const result = useMemo(() => normalizeResult(view?.result), [view]);
  const [config, setConfig] = useState<Config | null>(null);
  const [decisions, setDecisions] = useState<Decision[]>([]);
  const [currentInputs, setCurrentInputs] = useState<InputCard[]>([]);
  const [region, setRegion] = useState(ALL);
  const [segment, setSegment] = useState(ALL);
  const [horizon, setHorizon] = useState(ALL);
  const [selected, setSelected] = useState<CellKey | null>(null);

  useEffect(() => {
    api.getConfig().then(setConfig).catch(() => setConfig(null));
    api.getDecisions().then(setDecisions).catch(() => setDecisions([]));
  }, [dataVersion]);

  // Only needed for older results without an inputs snapshot.
  useEffect(() => {
    if (view && !view.inputs) api.getInputs().then(setCurrentInputs).catch(() => setCurrentInputs([]));
  }, [view, dataVersion]);

  const cells = objs<BalanceCell>(result.balance_matrix);
  const regions = ordered(config?.regions ?? [], [...new Set(cells.map((c) => text(c.region)).filter(Boolean))]);
  const segments = ordered(config?.segments ?? [], [...new Set(cells.map((c) => text(c.segment)).filter(Boolean))]);

  // Default selection: the most severe cell, preferring the focus region.
  useEffect(() => {
    const list = objs<BalanceCell>(normalizeResult(view?.result).balance_matrix);
    const best = [...list].sort((a, b) => {
      const fa = focus && text(a.region) === focus ? 10 : 0;
      const fb = focus && text(b.region) === focus ? 10 : 0;
      return fb + severity(b.status) - (fa + severity(a.status));
    })[0];
    setSelected(best ? { region: text(best.region), segment: text(best.segment) } : null);
    setRegion(ALL);
    setSegment(ALL);
    setHorizon(ALL);
  }, [view, focus]);

  const onDecide = useCallback(async (d: Decision) => {
    setDecisions(await api.addDecision(d));
  }, []);

  if (!view) {
    return (
      <div className="panel placeholder">
        <h2>No analysis yet</h2>
        <p className="muted">Run an analysis (or load the cached demo result) to see the dashboard.</p>
        {onGoRun && <button type="button" className="primary" onClick={onGoRun}>Go to Run analysis</button>}
      </div>
    );
  }

  const inRegion = (r: string) => region === ALL || r === region;
  const inSegment = (s: string | null) => segment === ALL || !s || s === segment;
  const inHorizon = (h: unknown) => horizon === ALL || text(h) === horizon;
  const keepRec = (r: Recommendation) => inRegion(text(r.region)) && inSegment(text(r.segment)) && inHorizon(r.horizon);
  const keepEffect = (e: CrossRegionEffect) =>
    region === ALL || text(e.from_region) === region || text(e.to_region) === region || text(e.to_region) === ALL_OTHER;
  const isDimmed = (c: CellKey) => !inRegion(c.region) || !inSegment(c.segment);

  const recs = objs<Recommendation>(result.recommendations);
  const byKey = decisionsByKey(decisions);
  const asOf = text(result.as_of_date) || "unknown";
  const awaiting = recs.filter((r) => !byKey.has(decisionKey(asOf, text(r.region), text(r.segment), text(r.action)))).length;

  const meta = result._meta;
  const date = (text(meta?.generated_at) || view.saved_at || "").replace("T", " ").slice(0, 16) || null;
  const inputs = view.inputs ?? currentInputs;
  const selectedCell = selected ? cells.find((c) => text(c.region) === selected.region && text(c.segment) === selected.segment) : undefined;
  const horizons = [...new Set(recs.map((r) => text(r.horizon)).filter(Boolean))];

  return (
    <div>
      <ChainBar result={result} />
      <HeaderBanner result={result} source={view.source} date={date} />
      <StatCards result={result} awaiting={awaiting} />
      <DataUsed result={result} />

      {cells.length > 0 && (
        <div className="filters panel" role="group" aria-label="Dashboard filters" style={{ paddingTop: 10, paddingBottom: 10 }}>
          <label>
            Region
            <select value={region} onChange={(e) => setRegion(e.target.value)}>
              <option value={ALL}>All regions</option>
              {regions.map((r) => <option key={r} value={r}>{r}</option>)}
            </select>
          </label>
          <label>
            Segment
            <select value={segment} onChange={(e) => setSegment(e.target.value)}>
              <option value={ALL}>All segments</option>
              {segments.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          </label>
          <label>
            Horizon
            <select value={horizon} onChange={(e) => setHorizon(e.target.value)}>
              <option value={ALL}>All horizons</option>
              {(horizons.length ? horizons : ["short", "medium", "long"]).map((h) => <option key={h} value={h}>{h} term</option>)}
            </select>
          </label>
          {(region !== ALL || segment !== ALL || horizon !== ALL) && (
            <button type="button" className="link" onClick={() => { setRegion(ALL); setSegment(ALL); setHorizon(ALL); }}>
              Clear filters
            </button>
          )}
        </div>
      )}

      <BalanceSection
        cells={cells}
        supply={objs<SupplyByRegion>(result.supply_by_region).filter((s) => inRegion(text(s.region)))}
        regions={regions}
        segments={segments}
        selected={selected}
        onSelect={setSelected}
        isDimmed={isDimmed}
      />
      {selected && (
        <SelectedCell
          cell={selectedCell}
          region={selected.region}
          segment={selected.segment}
          inputs={inputs}
          inputsAreSnapshot={!!view.inputs}
          assessments={objs<InputAssessment>(result.input_assessment)}
        />
      )}
      <GlobalComparison result={result} keep={(r, s) => inRegion(r) && inSegment(s)} />
      <CrossRegion result={result} keep={keepEffect} />
      {selected && <ScenariosActions result={result} region={selected.region} segment={selected.segment} />}
      <Recommendations result={result} decisions={decisions} onDecide={onDecide} keep={keepRec} />
      <DecisionAreas result={result} keepHorizon={inHorizon} />
      <AgentTrail result={result} keepHorizon={inHorizon} />
      <Objectives result={result} />
    </div>
  );
}

/** ABB's chain (vision sections 1-5) as jump links; only links to sections this result contains. */
function ChainBar({ result }: { result: ReturnType<typeof normalizeResult> }) {
  const steps = [
    { n: 1, label: "Ecosystem data", id: "d-data", on: !!result.ecosystem_data },
    { n: 2, label: "AI agents", id: "d-kg", on: !!result.knowledge_graph },
    { n: 3, label: "Decision areas", id: "d-areas", on: objs(result.decision_areas).length > 0 },
    { n: 4, label: "Objectives", id: "d-objectives", on: !!result.optimisation_objectives },
    { n: 5, label: "Outcomes", id: "d-outcomes", on: objs(result.expected_outcomes).length > 0 },
  ].filter((s) => s.on);
  if (steps.length < 2) return null;
  return (
    <nav className="chain" aria-label="From data to decisions">
      {steps.map((s, i) => (
        <span key={s.id} style={{ display: "inline-flex", alignItems: "center" }}>
          {i > 0 && <span className="bus" aria-hidden="true" />}
          <a
            href={`#${s.id}`}
            onClick={(e) => {
              e.preventDefault(); // keep the tab hash; just scroll
              document.getElementById(s.id)?.scrollIntoView({ behavior: "smooth" });
            }}
          >
            <span className="n">{s.n}</span>
            {s.label}
          </a>
        </span>
      ))}
    </nav>
  );
}
