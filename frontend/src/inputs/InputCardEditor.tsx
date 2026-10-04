import { memo } from "react";
import { FieldErrors } from "../components/FieldErrors";
import { LevelSlider } from "../components/LevelSlider";
import { Segmented } from "../components/Segmented";
import type { Confidence, InputCard } from "../types";
import { isHttpsUrl } from "./importValidation";

interface Props {
  card: InputCard;
  dirty: boolean;
  onChange: (id: string, patch: Partial<InputCard>) => void;
  errors?: string[];
}

const CONFIDENCE_OPTIONS: { value: Confidence; label: string }[] = [
  { value: "low", label: "Low" },
  { value: "medium", label: "Medium" },
  { value: "high", label: "High" },
];

/** One input card: big level or "No data", plain-language slider, confidence, evidence, https source, date, illustrative. */
export const InputCardEditor = memo(function InputCardEditor({ card, dirty, onChange, errors }: Props) {
  const urlOk = isHttpsUrl(card.source_url);
  const set = (patch: Partial<InputCard>) => onChange(card.id, patch);
  const base = `card-${card.id.replace(/[^A-Za-z0-9]+/g, "-")}`;
  const where = card.segment ? `${card.region} ${card.segment}` : card.region;

  return (
    <article
      className={["card", card.is_illustrative ? "illustrative" : "", card.level === null ? "empty" : ""].join(" ")}
      aria-label={`${card.dataset}, ${where}`}
    >
      <div className="ct">
        <h4 className="title">{card.dataset}</h4>
        <div>
          {dirty && <span className="chip edited">edited</span>}
          {card.is_illustrative && <span className="chip illus">Illustrative</span>}
        </div>
      </div>

      <LevelSlider value={card.level} onChange={(level) => set({ level })} label={`${card.dataset}, ${where}: level`} side={card.side} />

      <div className="fields">
        <div className="row">
          <span className="small muted">Confidence</span>
          <Segmented label={`${card.dataset}, ${where}: confidence`} options={CONFIDENCE_OPTIONS} value={card.confidence} onChange={(confidence) => set({ confidence })} />
        </div>
        <label className="f" htmlFor={`${base}-note`}>
          Evidence note
          <textarea id={`${base}-note`} rows={3} value={card.evidence_note} onChange={(e) => set({ evidence_note: e.target.value })} />
        </label>
        <label className="f" htmlFor={`${base}-url`}>
          Source link
          <input
            id={`${base}-url`}
            type="url"
            inputMode="url"
            placeholder="https://"
            value={card.source_url}
            className={urlOk ? undefined : "invalid"}
            aria-invalid={!urlOk || undefined}
            aria-describedby={urlOk ? undefined : `${base}-url-err`}
            onChange={(e) => set({ source_url: e.target.value.trim() })}
          />
        </label>
        {!urlOk && (
          <p id={`${base}-url-err`} className="field-error" style={{ marginTop: -4 }}>
            Use a full https:// address, or leave it empty. Save is blocked until this is fixed.
          </p>
        )}
        {urlOk && card.source_url && (
          <a className="small" href={card.source_url} target="_blank" rel="noopener noreferrer" style={{ marginTop: -4 }}>
            Open source ↗
          </a>
        )}
        <div className="row">
          <label className="f" htmlFor={`${base}-date`} style={{ flex: 1 }}>
            Date
            <input id={`${base}-date`} type="date" value={card.date} onChange={(e) => set({ date: e.target.value })} />
          </label>
          <label className="small" style={{ alignSelf: "end", paddingBottom: 6 }}>
            <input type="checkbox" checked={card.is_illustrative} onChange={(e) => set({ is_illustrative: e.target.checked })} /> Illustrative
            (example value)
          </label>
        </div>
      </div>
      <FieldErrors messages={errors} />
      <div className="id">{card.id}</div>
    </article>
  );
});
