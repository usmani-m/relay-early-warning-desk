import { plainLabel } from "../scale";
import { humanize, levelName, objs, strs, text } from "../result/normalize";
import { statusInfo } from "../result/status";
import type { BalanceCell, InputAssessment } from "../result/types";
import type { InputCard } from "../types";
import { Section } from "./Section";

interface Props {
  cell: BalanceCell | undefined;
  region: string;
  segment: string;
  inputs: InputCard[];
  inputsAreSnapshot: boolean;
  assessments: InputAssessment[];
}

const hostname = (url: string) => {
  try {
    return new URL(url).hostname;
  } catch {
    return url;
  }
};

const short = (id: string, cards: Map<string, InputCard>) => {
  const c = cards.get(id);
  return c ? `${c.dataset} (${c.segment ? `${c.region} ${c.segment}` : c.region})` : id;
};

/** The input cards behind the selected cell, with the AI's per-card assessment and evidence for/against. */
export function SelectedCell({ cell, region, segment, inputs, inputsAreSnapshot, assessments }: Props) {
  const byId = new Map(inputs.map((c) => [c.id, c]));
  const assessById = new Map(objs<InputAssessment>(assessments).map((a) => [text(a.id), a]));
  const ids = strs(cell?.input_ids);
  const info = statusInfo(cell?.status ?? "insufficient_data");

  return (
    <Section
      id="d-cell"
      title={`Evidence for ${region} · ${segment}`}
      note={
        <>
          <span className={`chip st-${info.key}`}>{info.label}</span> Demand: {levelName(cell?.demand, "demand", "no data")}. Effective supply:{" "}
          {levelName(cell?.effective_supply, "supply", "no data")}
          {cell?.supply_source === "global_fallback" && " · supply from the GLOBAL baseline (no own supply cards)"}.
          {!inputsAreSnapshot && " Cards as currently saved (this result has no snapshot of its inputs)."}
        </>
      }
    >
      {ids.length === 0 ? (
        <p className="muted">No input cards behind this region–segment{cell ? "" : " (no data in the result)"}.</p>
      ) : (
        <div className="cards">
          {ids.map((id) => {
            const card = byId.get(id);
            const a = assessById.get(id);
            const support = strs(a?.supporting_ids);
            const against = strs(a?.contradicting_ids);
            const illustrative = card?.is_illustrative || a?.is_illustrative;
            return (
              <article key={id} className={`card${illustrative ? " illustrative" : ""}`} aria-label={id}>
                <div className="ct">
                  <div>
                    <div className="title">{card?.dataset || text(a?.dataset) || id}</div>
                    <span className={(card?.side ?? a?.side) === "supply" ? "chip s" : "chip d"}>{card?.side || text(a?.side) || "?"}</span>
                    <span className="chip">{card ? (card.segment ? `${card.region} ${card.segment}` : card.region) : text(a?.region)}</span>
                    {a?.pestle && <span className="chip">{text(a.pestle)}</span>}
                  </div>
                  {illustrative && <span className="chip illus">ILLUSTRATIVE</span>}
                </div>
                <div className="lvl-value" style={{ marginTop: 6 }}>
                  {plainLabel(card?.level ?? (typeof a?.level === "number" ? a.level : null), (card?.side ?? (a?.side === "supply" ? "supply" : "demand")) as "demand" | "supply")}
                  <span className="small muted" style={{ fontWeight: 400 }}>
                    {" "}· {card?.confidence || text(a?.confidence) || "?"} confidence
                  </span>
                </div>
                {a?.combines_conflicting_sources && (
                  <p className="banner err small" style={{ margin: "8px 0", padding: "6px 10px" }} role="note">
                    <b>Combines conflicting sources.</b> {text(a.conflict_note)}
                  </p>
                )}
                <dl className="kv">
                  {a?.what_changed && (<><dt>What changed</dt><dd>{text(a.what_changed)}</dd></>)}
                  {card?.evidence_note && (<><dt>Evidence note</dt><dd>{card.evidence_note}</dd></>)}
                  {(card?.source_url || card?.date) && (
                    <>
                      <dt>Source</dt>
                      <dd>
                        {card?.source_url ? <a href={card.source_url} target="_blank" rel="noopener noreferrer">{hostname(card.source_url)}</a> : <span className="muted">no source</span>}
                        {card?.date && <span className="muted"> · {card.date}</span>}
                      </dd>
                    </>
                  )}
                  {a && (
                    <>
                      <dt>AI assessment</dt>
                      <dd>
                        {[humanize(a.indicator_type), humanize(a.nature), a.lead_time_months && `lead ${text(a.lead_time_months)} months`].filter(Boolean).join(" · ")}
                        <div>
                          {a.stale && <span className="chip stale">stale</span>}
                          {a.anomaly && <span className="chip flag">anomaly</span>}
                          {a.turning_point && <span className="chip flag">turning point</span>}
                        </div>
                        {a.rationale && <div className="small">{text(a.rationale)}</div>}
                      </dd>
                    </>
                  )}
                  {(support.length > 0 || against.length > 0) && (
                    <>
                      <dt>Evidence check</dt>
                      <dd className="ev">
                        {support.length > 0 && <div><span className="for">For:</span> {support.map((s) => short(s, byId)).join("; ")}</div>}
                        {against.length > 0 ? (
                          <div><span className="against">Against:</span> {against.map((s) => short(s, byId)).join("; ")}</div>
                        ) : (
                          <div className="small muted">No counter-evidence found in the provided data.</div>
                        )}
                      </dd>
                    </>
                  )}
                </dl>
                <div className="id">{id}{!card && " (card not in the inputs used)"}</div>
              </article>
            );
          })}
        </div>
      )}
    </Section>
  );
}
