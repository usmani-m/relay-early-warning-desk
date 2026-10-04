import { humanize, num, objs, strs, text } from "../result/normalize";
import type { AnalysisResult } from "../result/types";
import { Section } from "./Section";

const OBJECTIVES = ["profitability", "customer_value", "growth", "resilience"];

/** Sections 4 and 5 of ABB's vision: objectives (weights, tension), the 6 outcomes, data gaps, human review. */
export function Objectives({ result }: { result: AnalysisResult }) {
  const oo = result.optimisation_objectives;
  const outcomes = objs<{ outcome?: string; direction?: string; assumption?: string }>(result.expected_outcomes);
  const gaps = strs(result.data_gaps);
  const weights = oo?.weights && typeof oo.weights === "object" ? oo.weights : null;

  return (
    <>
      {oo && (oo.weights_used || oo.why || oo.main_tension || weights) && (
        <Section id="d-objectives" title="Optimisation objectives">
          <div className="row" style={{ marginBottom: 8 }}>
            {oo.weights_used && <span className="badge gemini" style={{ textTransform: "uppercase" }}>{text(oo.weights_used)} weights</span>}
            {weights &&
              OBJECTIVES.filter((k) => num(weights[k]) !== null).map((k) => (
                <span key={k} className="chip">{humanize(k)} {num(weights[k])}%</span>
              ))}
          </div>
          {oo.why && <p style={{ margin: "4px 0" }}>{text(oo.why)}</p>}
          {oo.main_tension && <p style={{ margin: "4px 0" }}><b>Main tension:</b> {text(oo.main_tension)}</p>}
        </Section>
      )}
      {outcomes.length > 0 && (
        <Section id="d-outcomes" title="Expected outcomes" note="Direction of impact; any number is an assumption.">
          <div className="scen">
            {outcomes.map((o, i) => (
              <div key={i} className="scard">
                <span className="nm" style={{ fontSize: 17 }}>{text(o.outcome)}</span>
                <p className="small" style={{ margin: "6px 0" }}>{text(o.direction)}</p>
                {o.assumption && <p className="small muted" style={{ margin: 0 }}><i>Assumption:</i> {text(o.assumption)}</p>}
              </div>
            ))}
          </div>
        </Section>
      )}
      {(gaps.length > 0 || result.human_review_summary) && (
        <div className="grid2">
          {gaps.length > 0 && (
            <Section id="d-gaps" title="Data gaps">
              <ul style={{ margin: 0, paddingLeft: 18 }}>{gaps.map((g) => <li key={g}>{g}</li>)}</ul>
            </Section>
          )}
          {result.human_review_summary && (
            <Section id="d-review" title="For the human reviewer">
              <p style={{ margin: 0 }}>{result.human_review_summary}</p>
            </Section>
          )}
        </div>
      )}
    </>
  );
}
