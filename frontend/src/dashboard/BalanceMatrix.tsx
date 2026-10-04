import { decimal, levelName, objs, strs, text } from "../result/normalize";
import { STATUSES, statusInfo } from "../result/status";
import type { BalanceCell, SupplyByRegion } from "../result/types";
import { Section } from "./Section";

export interface CellKey {
  region: string;
  segment: string;
}

interface Props {
  cells: BalanceCell[];
  regions: string[];
  segments: string[];
  selected: CellKey | null;
  onSelect: (cell: CellKey) => void;
  isDimmed?: (cell: CellKey) => boolean;
}

/** Regions x segments grid with demand, effective supply, gap and status per cell, coloured by the 7 statuses. */
export function BalanceMatrix({ cells, regions, segments, selected, onSelect, isDimmed }: Props) {
  if (!cells.length) return null;
  const find = (r: string, s: string) => cells.find((c) => c.region === r && c.segment === s);
  const used = new Set(cells.map((c) => statusInfo(c.status).key));

  return (
    <div>
      <div className="matrix" style={{ gridTemplateColumns: `90px repeat(${segments.length}, minmax(0, 1fr))` }} role="grid" aria-label="Balance matrix">
        <div role="row" style={{ display: "contents" }}>
          <div className="h" role="columnheader" />
          {segments.map((s) => (
            <div key={s} className="h" role="columnheader">{s}</div>
          ))}
        </div>
        {regions.map((r) => (
          <div key={r} role="row" style={{ display: "contents" }}>
            <div className="rh" role="rowheader">{r}</div>
            {segments.map((s) => {
              const c = find(r, s);
              const info = statusInfo(c?.status ?? "insufficient_data");
              const isSel = selected?.region === r && selected?.segment === s;
              const dim = isDimmed?.({ region: r, segment: s });
              const fallback = c?.supply_source === "global_fallback";
              return (
                <div key={s} role="gridcell">
                  <button
                    type="button"
                    className={`cell st-${info.key}${isSel ? " sel" : ""}${dim ? " dim" : ""}`}
                    style={{ width: "100%" }}
                    aria-pressed={isSel}
                    aria-label={`${r} ${s}: ${info.label}, demand ${levelName(c?.demand, "demand", "no data")}, supply ${levelName(c?.effective_supply, "supply", "no data")}`}
                    data-status={info.key}
                    onClick={() => onSelect({ region: r, segment: s })}
                  >
                    <div className="g">{info.label}</div>
                    <div className="ds">Demand: {levelName(c?.demand, undefined, "no data")}</div>
                    <div className="ds">
                      Supply: {levelName(c?.effective_supply, "supply", "no data")}
                      {fallback && <span className="fb" title="Supply uses the GLOBAL baseline (no own supply cards)">GLOBAL</span>}
                    </div>
                  </button>
                </div>
              );
            })}
          </div>
        ))}
      </div>
      <div className="legend" aria-label="Status legend">
        {STATUSES.map((s) => (
          <span key={s.key} style={{ fontWeight: used.has(s.key) ? 700 : 400 }}>
            <i className={`st-${s.key}`} />
            {s.label}
          </span>
        ))}
      </div>
      <p className="small muted" style={{ margin: "6px 0 0" }}>
        Each region–segment compares demand with effective supply (after dependencies and pool pressure). Click one for details.
      </p>
    </div>
  );
}

/** Supply per region as the AI computed it, including whether the GLOBAL fallback was used. */
export function SupplyByRegionTable({ rows }: { rows: SupplyByRegion[] }) {
  const list = objs<SupplyByRegion>(rows);
  if (!list.length) return null;
  return (
    <div className="tblwrap">
      <table aria-label="Supply by region">
        <thead>
          <tr>
            <th>Region</th>
            <th>Effective supply</th>
          </tr>
        </thead>
        <tbody>
          {list.map((s, i) => (
            <tr key={i}>
              <td>
                <b>{text(s.region)}</b>
                {s.supply_source === "global_fallback" && (
                  <div><span className="chip example" title="No own supply cards: GLOBAL supply level used">GLOBAL fallback</span></div>
                )}
                {strs(s.illustrative_inputs).length > 0 && <div><span className="chip illus">illustrative inputs</span></div>}
              </td>
              <td className="score-name">{levelName(s.effective_supply, "supply", "no data")}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {/* The AI's intermediate numbers stay available for anyone who wants to check the calculation. */}
      <details className="small" style={{ marginTop: 8 }}>
        <summary>Calculation details (numbers)</summary>
        <table aria-label="Supply calculation">
          <thead>
            <tr>
              <th>Region</th>
              <th>Own supply</th>
              <th>Blended</th>
              <th>Pool pressure</th>
              <th>Effective</th>
            </tr>
          </thead>
          <tbody>
            {list.map((s, i) => (
              <tr key={i}>
                <td>{text(s.region)}</td>
                <td>{decimal(s.own_supply)}</td>
                <td>{decimal(s.blended_supply)}</td>
                <td>{decimal(s.pool_pressure)}</td>
                <td>{decimal(s.effective_supply_unrounded)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </details>
    </div>
  );
}

export function BalanceSection(props: Props & { supply: SupplyByRegion[] }) {
  if (!props.cells.length && !props.supply.length) return null;
  return (
    <Section id="d-matrix" title="Demand–supply balance" note="The AI's assessment per region and segment.">
      <div className="dash-grid">
        <BalanceMatrix {...props} />
        <div>
          <h3 style={{ marginTop: 0 }}>Supply by region</h3>
          <SupplyByRegionTable rows={props.supply} />
        </div>
      </div>
    </Section>
  );
}
