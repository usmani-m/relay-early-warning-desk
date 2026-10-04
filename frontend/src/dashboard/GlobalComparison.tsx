import { humanize, levelName, objs, strs, text } from "../result/normalize";
import type { AnalysisResult, GlobalComparisonRow } from "../result/types";
import { Section } from "./Section";

const LABEL_CLASS: Record<string, string> = {
  well_above: "chip d", above: "chip d", in_line: "chip", below: "chip s", well_below: "chip s",
  no_global_baseline: "chip", no_own_data: "chip",
};

export function GlobalComparison({ result, keep }: { result: AnalysisResult; keep: (region: string, segment: string | null) => boolean }) {
  const rows = objs<GlobalComparisonRow>(result.global_comparison).filter((r) => keep(text(r.region), r.segment ? text(r.segment) : null));
  const commentary = objs<{ text?: string; regions?: string[]; card_ids?: string[] }>(result.global_comparison_commentary);
  if (!rows.length && !commentary.length) return null;
  return (
    <Section id="d-global" title="Global comparison" note="Each region against the GLOBAL baseline.">
      {commentary.map((c, i) => (
        <p key={i} style={{ marginTop: 0 }}>
          {text(c.text)} {strs(c.regions).length > 0 && <span className="small muted">({strs(c.regions).join(", ")})</span>}
        </p>
      ))}
      {rows.length > 0 && (
        <div className="tblwrap">
          <table>
            <thead>
              <tr>
                <th>Region</th>
                <th>Segment</th>
                <th>Side</th>
                <th>Region level</th>
                <th>Global level</th>
                <th>Comparison</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={i}>
                  <td>{text(r.region)}</td>
                  <td>{text(r.segment) || "–"}</td>
                  <td>{text(r.side)}</td>
                  <td>{levelName(r.region_level, undefined, "no data")}</td>
                  <td>{levelName(r.global_level, undefined, "no data")}</td>
                  <td>
                    <span className={LABEL_CLASS[text(r.label)] ?? "chip"}>{humanize(r.label) || "–"}</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Section>
  );
}
