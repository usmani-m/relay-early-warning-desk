import { humanize, num, objs, strs, text } from "../result/normalize";
import type { AnalysisResult, CrossRegionEffect } from "../result/types";
import { Section } from "./Section";

const ALL = "ALL_OTHER_REGIONS";
const RANK: Record<string, number> = { high: 3, medium: 2, low: 1 };

/** Which region's uncertainty affects which other region, and how strongly (the AI's own assessment). */
export function CrossRegion({ result, keep }: { result: AnalysisResult; keep: (e: CrossRegionEffect) => boolean }) {
  const effects = objs<CrossRegionEffect>(result.cross_region_effects).filter(keep);
  if (!effects.length) return null;
  const from = [...new Set(effects.map((e) => text(e.from_region)))].filter(Boolean);
  const toRegions = [...new Set(effects.map((e) => text(e.to_region)).filter((t) => t && t !== ALL))];
  const hasPool = effects.some((e) => text(e.to_region) === ALL);
  const cols = [...toRegions, ...(hasPool ? [ALL] : [])];
  const strongest = (f: string, t: string) =>
    effects.filter((e) => text(e.from_region) === f && text(e.to_region) === t).sort((a, b) => (RANK[text(b.strength)] ?? 0) - (RANK[text(a.strength)] ?? 0))[0];
  const sorted = [...effects].sort((a, b) => (RANK[text(b.strength)] ?? 0) - (RANK[text(a.strength)] ?? 0));

  return (
    <Section id="d-cross" title="Cross-region effects" note="Rows affect columns: through supply dependency (shares sourced from a region) or through demand drawing on the shared component pool.">
      <div className="tblwrap">
        <table className="xr" aria-label="Cross-region effects matrix">
          <thead>
            <tr>
              <th>From ↓ / to →</th>
              {cols.map((c) => (
                <th key={c}>{c === ALL ? "All other regions (pool)" : c}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {from.map((f) => (
              <tr key={f}>
                <th scope="row">{f}</th>
                {cols.map((t) => {
                  const e = strongest(f, t);
                  if (!e) return <td key={t} className="muted">·</td>;
                  const s = text(e.strength) || "low";
                  return (
                    <td key={t}>
                      <span className={`strength ${s}`} title={text(e.why)}>
                        {s}
                        {e.involves_illustrative ? " *" : ""}
                      </span>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {effects.some((e) => e.involves_illustrative) && <p className="small muted">* involves illustrative inputs</p>}
      <ul className="effects">
        {sorted.map((e, i) => {
          const share = num(e.share);
          return (
            <li key={i}>
              <div className="row">
                <b>{(text(e.direction) || `${text(e.from_region)} → ${text(e.to_region)}`).replace(ALL, "all other regions")}</b>
                <span className={`strength ${text(e.strength) || "low"}`}>{text(e.strength) || "?"}</span>
                <span className="chip">{humanize(e.channel)}</span>
                {share !== null && share > 0 && <span className="small muted">share {share.toFixed(2)}</span>}
                {e.involves_illustrative && <span className="chip illus">illustrative</span>}
              </div>
              {e.why && <div className="small">{text(e.why)}</div>}
              {e.procurement_implication && (
                <div className="small"><b>Procurement:</b> {text(e.procurement_implication)}</div>
              )}
              {strs(e.card_ids).length > 0 && <div className="small muted">{strs(e.card_ids).join(", ")}</div>}
            </li>
          );
        })}
      </ul>
    </Section>
  );
}
