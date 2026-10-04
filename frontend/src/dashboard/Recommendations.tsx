import { useState } from "react";
import { humanize, joinTexts, levelName, objs, strs, text } from "../result/normalize";
import type { AnalysisResult, Recommendation } from "../result/types";
import type { Decision } from "../types";
import { DECISION_LABEL, decisionKey, decisionsByKey } from "./decisions";
import type { DecisionValue } from "./decisions";
import { Section } from "./Section";

interface Props {
  result: AnalysisResult;
  decisions: Decision[];
  onDecide: (decision: Decision) => Promise<void>;
  keep: (rec: Recommendation) => boolean;
}

/** Recommendations in priority order with Approve / Adjust (note required) / Reject; every one needs a human decision. */
export function Recommendations({ result, decisions, onDecide, keep }: Props) {
  const all = objs<Recommendation>(result.recommendations);
  if (!all.length) return null;
  const recs = all.filter(keep).sort((a, b) => (a.priority ?? 99) - (b.priority ?? 99));
  const byKey = decisionsByKey(decisions);
  const asOf = text(result.as_of_date) || "unknown";

  return (
    <Section id="d-recs" title="Recommendations" note="Every recommendation needs your decision. Decisions are saved and feed the next analysis.">
      {recs.length === 0 && <p className="muted">No recommendations match the filters.</p>}
      {recs.map((r, i) => {
        const key = decisionKey(asOf, text(r.region), text(r.segment), text(r.action));
        return <RecCard key={`${key}-${i}`} rec={r} asOf={asOf} decision={byKey.get(key)} onDecide={onDecide} />;
      })}
    </Section>
  );
}

function RecCard({ rec, asOf, decision, onDecide }: { rec: Recommendation; asOf: string; decision?: Decision; onDecide: (d: Decision) => Promise<void> }) {
  const [mode, setMode] = useState<"view" | "choose" | "adjusted" | "rejected">("view");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const scores = rec.objective_scores ?? {};
  const illus = strs(rec.illustrative_inputs);
  const showButtons = !decision || mode === "choose";

  async function save(value: DecisionValue, noteText: string) {
    setBusy(true);
    setError(null);
    try {
      await onDecide({ as_of: asOf, region: text(rec.region), segment: text(rec.segment), recommendation: text(rec.action), decision: value, note: noteText.trim() });
      setMode("view");
      setNote("");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  const label = `${humanize(rec.action)} for ${text(rec.region)} ${text(rec.segment)}`;
  return (
    <article className={`rec ${decision?.decision ?? ""}`} aria-label={`Recommendation: ${label}`}>
      <div className="row">
        <span className="prio">Priority {rec.priority ?? "?"}</span>
        <span className="chip">{text(rec.region)} · {text(rec.segment)}</span>
        {rec.horizon && <span className="chip">{text(rec.horizon)} term</span>}
        {rec.decision_area && <span className="chip">{text(rec.decision_area)}</span>}
        {illus.length > 0 && <span className="chip illus" title={illus.join(", ")}>uses illustrative inputs</span>}
      </div>
      <p className="act">{humanize(rec.action)}</p>
      <dl className="kv">
        {strs(rec.components).length > 0 && (<><dt>Components</dt><dd>{strs(rec.components).join(", ")}</dd></>)}
        {rec.act_by && (<><dt>Act by</dt><dd>{text(rec.act_by)}{rec.next_review && <span className="muted"> · next review {text(rec.next_review)}</span>}</dd></>)}
        {rec.why_robust && (<><dt>Why it holds up</dt><dd>{text(rec.why_robust)}</dd></>)}
        {rec.cost_if_wrong && (<><dt>Cost if wrong</dt><dd>{text(rec.cost_if_wrong)}</dd></>)}
        {strs(rec.would_change_if).length > 0 && (<><dt>Would change if</dt><dd>{joinTexts(strs(rec.would_change_if))}</dd></>)}
        {strs(rec.human_should_validate).length > 0 && (<><dt>Please validate</dt><dd>{joinTexts(strs(rec.human_should_validate))}</dd></>)}
        {rec.objective_scores && (
          <>
            <dt>Objectives</dt>
            <dd>
              Profitability: {levelName(scores.profitability)}. Customer value: {levelName(scores.customer_value)}. Growth: {levelName(scores.growth)}.
              Resilience: {levelName(scores.resilience)}. <b>Overall: {levelName(rec.weighted_score)}</b>
              {rec.weights_used && <span className="muted"> ({text(rec.weights_used)} weights)</span>}
              {rec.balance_explanation && <div className="small">{text(rec.balance_explanation)}</div>}
            </dd>
          </>
        )}
      </dl>

      <div style={{ marginTop: 12 }}>
        {decision && mode !== "choose" && mode !== "adjusted" && mode !== "rejected" && (
          <div className="row">
            <span className={`decided ${decision.decision}`} data-testid="decision-status">
              {DECISION_LABEL[decision.decision]}
              {decision.note && ` · ${decision.note}`}
            </span>
            <button type="button" className="small" onClick={() => setMode("choose")}>Change decision</button>
          </div>
        )}
        {showButtons && mode !== "adjusted" && mode !== "rejected" && (
          <div className="row" role="group" aria-label={`Decision for ${label}`}>
            <button type="button" className="primary" disabled={busy} onClick={() => save("approved", "")}>Approve</button>
            <button type="button" disabled={busy} onClick={() => { setMode("adjusted"); setNote(decision?.note ?? ""); }}>Adjust</button>
            <button type="button" className="danger" disabled={busy} onClick={() => { setMode("rejected"); setNote(decision?.note ?? ""); }}>Reject</button>
            {decision && <button type="button" className="link" onClick={() => setMode("view")}>Keep {DECISION_LABEL[decision.decision].toLowerCase()}</button>}
            {!decision && <span className="small muted">Needs your approval</span>}
          </div>
        )}
        {(mode === "adjusted" || mode === "rejected") && (
          <div>
            <label className="small" htmlFor={`note-${label}`}>
              {mode === "adjusted" ? "What do you change? (required)" : "Why do you reject it? (optional)"}
            </label>
            <textarea id={`note-${label}`} rows={2} value={note} onChange={(e) => setNote(e.target.value)} autoFocus />
            <div className="row" style={{ marginTop: 6 }}>
              <button
                type="button"
                className={mode === "rejected" ? "danger" : "primary"}
                disabled={busy || (mode === "adjusted" && !note.trim())}
                onClick={() => save(mode, note)}
              >
                {mode === "adjusted" ? "Save adjustment" : "Confirm rejection"}
              </button>
              <button type="button" onClick={() => setMode("view")} disabled={busy}>Cancel</button>
              {mode === "adjusted" && !note.trim() && <span className="small muted">An adjustment needs a note.</span>}
            </div>
          </div>
        )}
        {error && <p className="field-error">Could not save the decision: {error}</p>}
      </div>
    </article>
  );
}
