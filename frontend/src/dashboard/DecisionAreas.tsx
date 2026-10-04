import { objs, strs, text } from "../result/normalize";
import type { AnalysisResult, DecisionArea, DecisionQuestion } from "../result/types";
import { Section } from "./Section";

/** Section 3 of ABB's vision: 7 decision areas, 3 questions each, with data sufficiency. */
export function DecisionAreas({ result, keepHorizon }: { result: AnalysisResult; keepHorizon: (h: unknown) => boolean }) {
  const areas = objs<DecisionArea>(result.decision_areas);
  if (!areas.length) return null;
  return (
    <Section id="d-areas" title="Decision areas" note="The AI's answers to the 21 questions, with how well the data supports each answer.">
      {areas.map((a, i) => {
        const questions = objs<DecisionQuestion>(a.questions);
        const shown = questions.filter((q) => keepHorizon(q.horizon));
        const counts = questions.reduce<Record<string, number>>((m, q) => ({ ...m, [text(q.data_sufficiency)]: (m[text(q.data_sufficiency)] ?? 0) + 1 }), {});
        return (
          <details key={i} className="area" open={i === 0}>
            <summary>
              {text(a.area)}{" "}
              <span className="small muted" style={{ fontWeight: 400 }}>
                {questions.length} questions
                {["sufficient", "partial", "insufficient"].filter((k) => counts[k]).map((k) => ` · ${counts[k]} ${k}`).join("")}
              </span>
            </summary>
            {shown.length === 0 && <p className="small muted">No answers for the selected horizon.</p>}
            {shown.map((q, j) => {
              const suff = text(q.data_sufficiency);
              const missing = strs(q.missing_data);
              return (
                <div key={j} className="q">
                  <div className="row">
                    <b style={{ flex: 1 }}>{text(q.question)}</b>
                    {suff && <span className={`suff ${suff}`}>{suff}</span>}
                  </div>
                  <p style={{ margin: "4px 0" }}>{text(q.answer)}</p>
                  <div className="small muted">
                    {[q.confidence && `${text(q.confidence)} confidence`, q.horizon && `${text(q.horizon)} term`].filter(Boolean).join(" · ")}
                    {strs(q.illustrative_inputs).length > 0 && <span className="chip illus" style={{ marginLeft: 6 }}>uses illustrative inputs</span>}
                  </div>
                  {missing.length > 0 && <div className="small"><b>Missing data:</b> {missing.join("; ")}</div>}
                </div>
              );
            })}
          </details>
        );
      })}
    </Section>
  );
}
