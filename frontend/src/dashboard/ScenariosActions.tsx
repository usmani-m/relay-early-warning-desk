import { humanize, levelName, objs, strs, text } from "../result/normalize";
import type { ActionEvaluation, AnalysisResult, Scenario } from "../result/types";
import { Section } from "./Section";

const ORDER = ["surge", "base", "reversal"];

/** Scenarios for the selected cell, then the action evaluation (worst-case rule, chosen action highlighted). */
export function ScenariosActions({ result, region, segment }: { result: AnalysisResult; region: string; segment: string }) {
  const match = (x: { region?: string; segment?: string }) => text(x.region) === region && text(x.segment) === segment;
  const scenarios = objs<Scenario>(result.scenarios).filter(match).sort((a, b) => ORDER.indexOf(text(a.name)) - ORDER.indexOf(text(b.name)));
  const actions = objs<ActionEvaluation>(result.action_evaluation).filter(match);
  if (!objs(result.scenarios).length && !objs(result.action_evaluation).length) return null;

  return (
    <Section id="d-scenarios" title={`Scenarios and actions for ${region} · ${segment}`}>
      {scenarios.length === 0 && actions.length === 0 && (
        <p className="muted">Scenarios are built only for region–segments with a large gap; none for this one.</p>
      )}
      {scenarios.length > 0 && (
        <div className="scen">
          {scenarios.map((s, i) => {
            const lk = text(s.likelihood);
            return (
              <div key={i} className="scard">
                <span className="nm">{humanize(s.name)}</span>
                {lk && <span className={`lk ${lk}`}>{lk} likelihood</span>}
                {strs(s.triggers).length > 0 && (
                  <>
                    <div className="small muted" style={{ marginTop: 6 }}>Triggers to watch</div>
                    <ul className="small" style={{ margin: "2px 0 6px", paddingLeft: 18 }}>
                      {strs(s.triggers).map((t) => <li key={t}>{t}</li>)}
                    </ul>
                  </>
                )}
                {s.component_implication && <div className="small">{text(s.component_implication)}</div>}
              </div>
            );
          })}
        </div>
      )}
      {actions.length > 0 && (
        <>
          <h3>Action evaluation</h3>
          <p className="small muted" style={{ marginTop: -4 }}>
            How good each action is for ABB in each scenario, from strongly unfavorable to strongly favorable. The action with the best worst case is chosen.
          </p>
          <div className="tblwrap">
            <table aria-label="Action evaluation">
              <thead>
                <tr>
                  <th>Action</th>
                  <th>Surge</th>
                  <th>Base</th>
                  <th>Reversal</th>
                  <th>Worst case</th>
                </tr>
              </thead>
              <tbody>
                {actions.map((a, i) => (
                  <tr key={i} className={a.selected ? "chosen" : undefined}>
                    <td>
                      <b>{humanize(a.action)}</b> {a.selected && <span className="chip chosen">chosen</span>}
                      {a.description && <div className="small muted">{text(a.description)}</div>}
                      {a.trade_off && <div className="small"><i>Trade-off:</i> {text(a.trade_off)}</div>}
                    </td>
                    <td>{levelName(a.score_surge)}</td>
                    <td>{levelName(a.score_base)}</td>
                    <td>{levelName(a.score_reversal)}</td>
                    <td><b>{levelName(a.worst_case)}</b></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </Section>
  );
}
