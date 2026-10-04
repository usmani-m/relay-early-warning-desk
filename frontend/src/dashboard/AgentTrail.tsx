import { humanize, num, objs, strs, text } from "../result/normalize";
import type { AnalysisResult } from "../result/types";
import { Section } from "./Section";

/** Section 2 of ABB's vision: knowledge graph, PESTLE, risks, time horizons. */
export function AgentTrail({ result, keepHorizon }: { result: AnalysisResult; keepHorizon: (h: unknown) => boolean }) {
  const kg = result.knowledge_graph;
  const nodes = objs<{ id?: string; type?: string; label?: string }>(kg?.nodes);
  const edges = objs<{ from?: string; to?: string; relation?: string; card_ids?: string[] }>(kg?.edges);
  const pestle = result.pestle_coverage;
  const counts = pestle?.counts && typeof pestle.counts === "object" ? Object.entries(pestle.counts).filter(([, v]) => num(v) !== null) : [];
  const caps = result.capabilities;
  const risks = objs<{ type?: string; description?: string; rating?: string; horizon?: string; card_ids?: string[] }>(caps?.risks_and_opportunities).filter((r) => keepHorizon(r.horizon));
  const horizons = caps?.time_horizon_view;
  const label = (id: string) => nodes.find((n) => n.id === id)?.label || id;
  const maxCount = Math.max(1, ...counts.map(([, v]) => Number(v)));

  const parts = [
    (nodes.length > 0 || edges.length > 0) && (
      <Section key="kg" id="d-kg" title="Knowledge graph" note="Entities found in the evidence and how they connect.">
        <div className="grid2">
          <div>
            <h3 style={{ marginTop: 0 }}>Entities</h3>
            {[...new Set(nodes.map((n) => text(n.type)))].map((type) => (
              <div key={type} className="small" style={{ marginBottom: 4 }}>
                <b>{type || "Other"}:</b> {nodes.filter((n) => text(n.type) === type).map((n) => text(n.label) || text(n.id)).join(", ")}
              </div>
            ))}
          </div>
          <div>
            <h3 style={{ marginTop: 0 }}>Connections</h3>
            <ul className="small" style={{ margin: 0, paddingLeft: 18 }}>
              {edges.map((e, i) => (
                <li key={i}>
                  {label(text(e.from))} <b>—{text(e.relation)}→</b> {label(text(e.to))}
                  {strs(e.card_ids).length > 0 && <span className="muted"> ({strs(e.card_ids).join(", ")})</span>}
                </li>
              ))}
            </ul>
          </div>
        </div>
      </Section>
    ),
    (counts.length > 0 || risks.length > 0) && (
      <div key="pr" className="grid2">
        {counts.length > 0 && (
          <Section id="d-pestle" title="PESTLE coverage">
            <div className="pest">
              {counts.map(([k, v]) => (
                <div key={k} style={{ display: "contents" }}>
                  <span>{k}</span>
                  <span className="b" style={{ width: `${(Number(v) / maxCount) * 100}%`, opacity: Number(v) ? 1 : 0.2, minWidth: 2 }} />
                  <span>{v}</span>
                </div>
              ))}
            </div>
            {strs(pestle?.missing).length > 0 && <p className="small muted">Not covered: {strs(pestle?.missing).join(", ")}</p>}
            {pestle?.strongest_driver && <p className="small">Strongest driver: <b>{text(pestle.strongest_driver)}</b></p>}
          </Section>
        )}
        {risks.length > 0 && (
          <Section id="d-risks" title="Risks and opportunities">
            {risks.map((r, i) => (
              <div key={i} className="q">
                <span className={text(r.type) === "opportunity" ? "chip d" : "chip flag"}>{text(r.type) || "risk"}</span>
                {r.rating && <span className={`lk ${text(r.rating)}`}>{text(r.rating)}</span>}
                {r.horizon && <span className="chip">{text(r.horizon)} term</span>}
                <div className="small" style={{ marginTop: 4 }}>{text(r.description)}</div>
              </div>
            ))}
          </Section>
        )}
      </div>
    ),
    horizons && (strs(horizons.short).length + strs(horizons.medium).length + strs(horizons.long).length > 0) && (
      <Section key="th" id="d-horizons" title="Time horizon view" note="Short 0–3 months · medium 3–12 months · long 1–3 years.">
        <div className="cols3">
          {(["short", "medium", "long"] as const).map((h) => (
            <div key={h} className="scard">
              <span className="nm">{humanize(h)} term</span>
              <ul className="small" style={{ paddingLeft: 18, margin: "6px 0 0" }}>
                {strs(horizons[h]).map((x) => <li key={x}>{x}</li>)}
              </ul>
            </div>
          ))}
        </div>
      </Section>
    ),
  ].filter(Boolean);

  return parts.length ? <>{parts}</> : null;
}
