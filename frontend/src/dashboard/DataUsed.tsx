import { objs, strs, text } from "../result/normalize";
import type { AnalysisResult, CategoryStatus, DataQualityIssue } from "../result/types";
import { Section } from "./Section";

const INTERNAL = ["Customer forecasts & RFQs", "Order intake & backlog"];
const STATUS_LABEL: Record<string, string> = { active: "active", no_data: "no data", not_collected: "not collected" };
const STATUS_CLASS: Record<string, string> = { active: "chip d", no_data: "chip flag", not_collected: "chip" };

/** Section 1 of ABB's vision: the 16 data categories with their status in this run. */
export function DataUsed({ result }: { result: AnalysisResult }) {
  const eco = result.ecosystem_data;
  const demand = objs<CategoryStatus>(eco?.demand_side);
  const supply = objs<CategoryStatus>(eco?.supply_side);
  if (!demand.length && !supply.length) return null;
  const issues = objs<DataQualityIssue>(eco?.integration_layer?.data_quality_issues);

  const column = (title: string, list: CategoryStatus[]) => (
    <div>
      <h3 style={{ marginTop: 0 }}>{title}</h3>
      <ul className="namelist">
        {list.map((c, i) => {
          const status = text(c.status);
          const ids = strs(c.card_ids);
          return (
            <li key={i} title={text(c.note) || undefined}>
              <span style={{ flex: 1 }}>
                {text(c.dataset)}
                {INTERNAL.includes(text(c.dataset)) && <span className="chip internal" style={{ marginLeft: 6 }}>ABB internal</span>}
              </span>
              <span className={STATUS_CLASS[status] ?? "chip"}>{STATUS_LABEL[status] ?? (status || "unknown")}</span>
              {ids.length > 0 && <span className="small muted">{ids.length} {ids.length === 1 ? "indicator" : "indicators"}</span>}
            </li>
          );
        })}
      </ul>
    </div>
  );

  return (
    <Section id="d-data" title="Data used" note="Connected ecosystem data: ABB's 16 categories and whether this run had data for them.">
      <div className="grid2">
        {column("Demand side", demand)}
        {column("Supply side", supply)}
      </div>
      {issues.length > 0 && (
        <details style={{ marginTop: 10 }}>
          <summary className="small">Data-quality issues ({issues.length})</summary>
          <ul className="small">
            {issues.map((d, i) => (
              <li key={i}>
                <b>{text(d.card_id)}</b> · {text(d.issue).replace(/_/g, " ")}
                {d.detail ? `: ${text(d.detail)}` : ""}
              </li>
            ))}
          </ul>
        </details>
      )}
    </Section>
  );
}
