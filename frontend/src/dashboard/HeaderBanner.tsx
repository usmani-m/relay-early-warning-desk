import { objs, strs, text } from "../result/normalize";
import type { AnalysisResult } from "../result/types";

interface Props {
  result: AnalysisResult;
  source: string;
  date: string | null;
}

const LEVEL_ORDER = ["critical", "warning", "watch"];

/** Briefing, early warnings by level, date line, cached label, illustrative-inputs banner. */
export function HeaderBanner({ result, source, date }: Props) {
  const warnings = objs<{ level?: string; message?: string; card_ids?: string[] }>(result.capabilities?.early_warnings).sort(
    (a, b) => LEVEL_ORDER.indexOf(text(a.level)) - LEVEL_ORDER.indexOf(text(b.level)),
  );
  const illus = result.illustrative_influence;
  const illusItems = objs<{ card_id?: string; influences?: string }>(illus?.items);
  const cached = source === "cache";

  return (
    <>
      <section className="panel" id="d-briefing" aria-label="Briefing">
        <div className="metaline">
          {cached ? (
            <span className="badge cache">CACHED RESULT</span>
          ) : (
            <span className="badge gemini">LIVE AI RESULT</span>
          )}
          {date && <span>AI analysis of <b>{date}</b></span>}
          {result.as_of_date && <span>· as of {result.as_of_date}</span>}
        </div>
        {result.executive_briefing && <p className="briefing">{result.executive_briefing}</p>}
        {warnings.length > 0 && (
          <>
            <h3 style={{ marginBottom: 0 }}>Early warnings</h3>
            <ul className="warnlist">
              {warnings.map((w, i) => {
                const level = LEVEL_ORDER.includes(text(w.level)) ? text(w.level) : "watch";
                return (
                  <li key={i}>
                    <span className={`lvl-tag ${level}`}>{level}</span>
                    <span>
                      {text(w.message)}{" "}
                      {strs(w.card_ids).length > 0 && <span className="small muted">({strs(w.card_ids).join(", ")})</span>}
                    </span>
                  </li>
                );
              })}
            </ul>
          </>
        )}
      </section>
      {(illus?.any === true || illusItems.length > 0) && (
        <details className="banner info" id="d-illustrative">
          <summary style={{ cursor: "pointer" }}>
            <b>Illustrative inputs influenced this result</b> ({illusItems.length} card{illusItems.length === 1 ? "" : "s"} with
            example values, not real data). Show which and how.
          </summary>
          <ul>
            {illusItems.map((it, i) => (
              <li key={i}>
                <b>{text(it.card_id)}</b>
                {it.influences ? `: ${text(it.influences)}` : ""}
              </li>
            ))}
          </ul>
        </details>
      )}
    </>
  );
}
