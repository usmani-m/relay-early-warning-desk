import { objs } from "../result/normalize";
import { statusInfo } from "../result/status";
import type { AnalysisResult, BalanceCell } from "../result/types";

/** Counts of the AI's statuses (no calculation of our own) and of undecided recommendations. */
export function StatCards({ result, awaiting }: { result: AnalysisResult; awaiting: number | null }) {
  const cells = objs<BalanceCell>(result.balance_matrix);
  const recs = objs(result.recommendations);
  if (!cells.length && !recs.length) return null;
  const count = (pred: (key: string) => boolean) => cells.filter((c) => pred(statusInfo(c.status).key)).length;
  const stats = [
    { label: "Region–segments at shortage risk", value: count((k) => k === "shortage_risk" || k === "shortage_critical"), cls: "trip" },
    { label: "Region–segments at excess risk", value: count((k) => k === "excess_risk" || k === "excess_critical"), cls: "cool" },
    { label: "Region–segments on watch", value: count((k) => k === "watch_shortage" || k === "watch_excess"), cls: "amber" },
    { label: "Region–segments with insufficient data", value: count((k) => k === "insufficient_data" || k === "unknown"), cls: "" },
  ];
  return (
    <div className="stats" role="list" aria-label="Key numbers">
      {cells.length > 0 &&
        stats.map((s) => (
          <div key={s.label} className={`stat ${s.cls}`} role="listitem">
            <b>{s.value}</b>
            <span className="small muted">{s.label}</span>
          </div>
        ))}
      {recs.length > 0 && (
        <div className="stat" role="listitem">
          <b>{awaiting ?? recs.length}</b>
          <span className="small muted">Recommendations awaiting your decision</span>
        </div>
      )}
    </div>
  );
}
