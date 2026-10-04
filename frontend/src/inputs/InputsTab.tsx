import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ApiError, api } from "../api";
import { GLOBAL } from "../types";
import type { Categories, Config, InputCard, Side } from "../types";
import { cardId, combinations, missingCards } from "./cards";
import { CategoryPicker } from "./CategoryPicker";
import { InputCardEditor } from "./InputCardEditor";
import { isHttpsUrl, validateImport } from "./importValidation";

interface Props {
  dataVersion: number;
  onDirtyChange: (dirty: boolean) => void;
  onDataChanged: () => void;
}

interface Selection {
  region: string;
  segment: string;
}

interface Problem {
  id: string;
  region: string;
  segment: string | null;
  message: string;
}

const cardJson = (c: InputCard | undefined) => JSON.stringify(c ?? null);
// Category order carries no meaning, so compare as sets.
const sameSet = (a: string[], b: string[]) => a.length === b.length && a.every((x) => b.includes(x));

function selectionFromHash(): Selection | null {
  const [tab, region, segment] = window.location.hash.slice(1).split("/").map(decodeURIComponent);
  return tab === "inputs" && region && segment ? { region, segment } : null;
}

export function InputsTab({ dataVersion, onDirtyChange, onDataChanged }: Props) {
  const [config, setConfig] = useState<Config | null>(null);
  const [categories, setCategories] = useState<Categories | null>(null);
  const [saved, setSaved] = useState<InputCard[]>([]);
  const [draft, setDraft] = useState<InputCard[]>([]);
  const [active, setActive] = useState<string[]>([]);
  const [sel, setSel] = useState<Selection | null>(null);
  const [picker, setPicker] = useState<Side | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [savedNote, setSavedNote] = useState<string | null>(null);
  const [serverErrors, setServerErrors] = useState<string[]>([]);
  const [importReport, setImportReport] = useState<{ ok: string | null; errors: string[] } | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const configRef = useRef<Config | null>(null);
  configRef.current = config;

  const load = useCallback(async () => {
    try {
      const [cfg, cards, cats] = await Promise.all([api.getConfig(), api.getInputs(), api.categories()]);
      setConfig(cfg);
      setCategories(cats);
      setSaved(cards);
      setDraft(cards);
      setActive(cfg.active_datasets);
      setServerErrors([]);
      setLoadError(null);
      setSel((cur) => {
        const combos = combinations(cfg);
        const want = cur ?? selectionFromHash();
        const ok = want && combos.some((c) => c.region === want.region && c.segment === want.segment);
        return ok ? want : combos.find((c) => c.region !== GLOBAL) ?? combos[0] ?? null;
      });
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : String(e));
    }
  }, []);

  // Initial load, and reload after Setup saved or reset (Setup can't save while this tab has unsaved changes).
  useEffect(() => {
    load();
  }, [load, dataVersion]);

  // Follow the URL when it changes while the app is open (back/forward, pasted link).
  useEffect(() => {
    const onHash = () => {
      const want = selectionFromHash();
      const cfg = configRef.current;
      if (!want || !cfg || !combinations(cfg).some((c) => c.region === want.region && c.segment === want.segment)) return;
      setSel((cur) => (cur && cur.region === want.region && cur.segment === want.segment ? cur : want));
    };
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);

  // Keep the selection in the URL while this tab is shown (#inputs/EUROPE/Utilities).
  useEffect(() => {
    if (sel && window.location.hash.startsWith("#inputs")) {
      history.replaceState(null, "", `#inputs/${encodeURIComponent(sel.region)}/${encodeURIComponent(sel.segment)}`);
    }
  }, [sel]);

  const savedById = useMemo(() => new Map(saved.map((c) => [c.id, c])), [saved]);
  const dirtyIds = useMemo(() => new Set(draft.filter((c) => cardJson(c) !== cardJson(savedById.get(c.id))).map((c) => c.id)), [draft, savedById]);
  const categoriesChanged = !!config && !sameSet(active, config.active_datasets);
  const dirty = dirtyIds.size > 0 || categoriesChanged;
  useEffect(() => onDirtyChange(dirty), [dirty, onDirtyChange]);

  const onCardChange = useCallback((id: string, patch: Partial<InputCard>) => {
    setDraft((cards) => cards.map((c) => (c.id === id ? { ...c, ...patch } : c)));
  }, []);


  // Problems anywhere (not just in the current view): invalid URLs and server messages, with a jump target.
  const problems: Problem[] = useMemo(() => {
    const byId = new Map(draft.map((c) => [c.id, c]));
    const list: Problem[] = draft
      .filter((c) => !isHttpsUrl(c.source_url))
      .map((c) => ({ id: c.id, region: c.region, segment: c.segment, message: "source link must start with https://" }));
    for (const m of serverErrors) {
      const idMatch = m.match(/^Card (.+?)(: | appears twice)/);
      const idxMatch = m.match(/^(\d+)\./);
      const id = idMatch?.[1] ?? (idxMatch ? draft[Number(idxMatch[1])]?.id : undefined);
      const c = id ? byId.get(id) : undefined;
      if (c) list.push({ id: c.id, region: c.region, segment: c.segment, message: m });
    }
    return list;
  }, [draft, serverErrors]);
  const generalErrors = serverErrors.filter((m) => !problems.some((p) => p.message === m));
  const errorsByCard = useMemo(() => {
    const out: Record<string, string[]> = {};
    for (const p of problems) if (p.message !== "source link must start with https://") (out[p.id] ??= []).push(p.message);
    return out;
  }, [problems]);
  const badUrls = problems.filter((p) => p.message === "source link must start with https://");

  if (loadError) return <div className="banner err">Could not load the inputs: {loadError}</div>;
  if (!config || !categories || !sel) return <p className="muted">Loading inputs…</p>;

  const isGlobal = sel.region === GLOBAL;
  const activeOf = (side: Side) => active.filter((d) => categories[side].some((c) => c.name === d));
  const cardFor = (side: Side, dataset: string) =>
    draft.find((c) => c.id === cardId(side, sel.region, side === "demand" ? sel.segment : null, dataset));
  const demandCards = activeOf("demand").map((d) => cardFor("demand", d)).filter((c): c is InputCard => !!c);
  const supplyCards = activeOf("supply").map((d) => cardFor("supply", d)).filter((c): c is InputCard => !!c);
  const noSupplyValues = !isGlobal && supplyCards.every((c) => c.level === null);

  const regionDirty = (r: string) => draft.some((c) => c.region === r && dirtyIds.has(c.id));
  const segmentDirty = (s: string) => draft.some((c) => c.region === sel.region && (c.segment === s || c.side === "supply") && dirtyIds.has(c.id));
  const where = (p: { region: string; segment: string | null }) => (p.segment ? `${p.region} ${p.segment}` : `${p.region} supply`);
  const jump = (p: { region: string; segment: string | null }) => {
    setSel({ region: p.region, segment: p.segment ?? sel.segment });
    window.setTimeout(() => headingRef.current?.focus(), 0);
  };

  function changeCategories(side: Side, nextForSide: string[]) {
    if (!config) return;
    const others = active.filter((d) => !categories![side].some((c) => c.name === d)); // the other side stays as is
    const next = side === "demand" ? [...nextForSide, ...others] : [...others, ...nextForSide]; // demand first, as in config
    // Newly activated categories that never had cards get placeholder cards (no data).
    const added = nextForSide.filter((d) => !active.includes(d));
    const removed = active.filter((d) => categories![side].some((c) => c.name === d) && !nextForSide.includes(d));
    setDraft((cards) => {
      let out = cards;
      for (const d of added) out = [...out, ...missingCards(config, out, side, d)];
      // Placeholders that were never saved and are still untouched go away again when unticked.
      const pristine = (c: InputCard) => !savedById.has(c.id) && c.level === null && !c.evidence_note && !c.source_url && !c.date && !c.is_illustrative;
      return out.filter((c) => !(removed.includes(c.dataset) && pristine(c)));
    });
    setActive(next);
  }

  async function save() {
    if (!config) return;
    setSaving(true);
    setServerErrors([]);
    try {
      await api.putInputs(draft);
      if (categoriesChanged) {
        // Only the categories change; everything else in the config stays as the server has it.
        const current = await api.getConfig();
        await api.putConfig({ ...current, active_datasets: active });
      }
      const changed = [...dirtyIds].filter((id) => savedById.has(id)).length; // placeholders for new categories are not edits
      await load();
      const what = [changed ? `${changed} changed card(s)` : "", categoriesChanged ? "the category choice" : ""].filter(Boolean);
      setSavedNote(what.length ? `Saved ${what.join(" and ")}` : "Saved");
      setImportReport(null);
      setPicker(null);
      onDataChanged();
    } catch (e) {
      setServerErrors(e instanceof ApiError ? e.messages : [String(e)]);
    } finally {
      setSaving(false);
    }
  }

  function discard() {
    setDraft(saved);
    setActive(config!.active_datasets);
    setServerErrors([]);
    setImportReport(null);
    setPicker(null);
  }

  function exportJson() {
    const blob = new Blob([JSON.stringify(draft, null, 2) + "\n"], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `inputs-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }

  async function importFile(file: File) {
    let data: unknown;
    try {
      data = JSON.parse(await file.text());
    } catch {
      setImportReport({ ok: null, errors: [`${file.name} is not valid JSON.`] });
      return;
    }
    const { cards, errors } = validateImport(data, config!, categories!);
    const known = new Set(draft.map((c) => c.id));
    const matching = cards.filter((c) => known.has(c.id));
    const unknown = cards.filter((c) => !known.has(c.id)).map((c) => c.id);
    const byId = new Map(matching.map((c) => [c.id, c]));
    setDraft((d) => d.map((c) => byId.get(c.id) ?? c));
    const notes = unknown.length ? [`${unknown.length} card id(s) don't exist in the current setup and were skipped: ${unknown.slice(0, 5).join(", ")}${unknown.length > 5 ? ", …" : ""}`] : [];
    setImportReport({ ok: matching.length ? `Imported ${matching.length} card(s) into the draft. Review them, then Save.` : null, errors: [...errors, ...notes] });
  }

  const sideSection = (side: Side) => {
    const list = side === "demand" ? demandCards : supplyCards;
    const title = side === "demand" ? "Demand side" : "Supply side";
    return (
      <section className="panel" aria-labelledby={`inputs-${side}-h`}>
        <div className="row">
          <h3 id={`inputs-${side}-h`} className="group-h" style={{ margin: 0 }}>{title}</h3>
          {activeOf(side).map((d) => (
            <span key={d} className={side === "demand" ? "chip d" : "chip s"}>{d}</span>
          ))}
          <button type="button" className="link small" aria-expanded={picker === side} onClick={() => setPicker(picker === side ? null : side)}>
            {picker === side ? "Done" : "Change categories"}
          </button>
        </div>
        {picker === side && <CategoryPicker side={side} categories={categories!} active={activeOf(side)} onChange={(next) => changeCategories(side, next)} />}
        {side === "supply" && (
          <p className="small muted" style={{ margin: "6px 0 0" }}>
            {isGlobal ? "Global supply applies to all segments." : `Supply applies to all ${sel.region} segments.`}
          </p>
        )}
        {side === "supply" && noSupplyValues && (
          <p className="banner info small" style={{ margin: "8px 0 0" }} role="note">
            No supply values for {sel.region}: the analysis will use the GLOBAL supply level for this region.
          </p>
        )}
        <div className="cards" style={{ marginTop: 10 }}>
          {list.map((c) => (
            <InputCardEditor key={c.id} card={c} dirty={dirtyIds.has(c.id)} onChange={onCardChange} errors={errorsByCard[c.id]} />
          ))}
        </div>
      </section>
    );
  };

  return (
    <section aria-label="Inputs">
      <div className="savebar inputs-bar" role="region" aria-label="Selection and save">
        <label className="sr-only" htmlFor="inp-region">Region</label>
        <select id="inp-region" value={sel.region} onChange={(e) => setSel({ region: e.target.value, segment: sel.segment })}>
          {[GLOBAL, ...config.regions].map((r) => (
            <option key={r} value={r}>
              {r === GLOBAL ? "GLOBAL (global trend)" : r}
              {regionDirty(r) ? " • edited" : ""}
            </option>
          ))}
        </select>
        <label className="sr-only" htmlFor="inp-segment">Segment</label>
        <select id="inp-segment" value={sel.segment} onChange={(e) => setSel({ region: sel.region, segment: e.target.value })}>
          {config.segments.map((s) => (
            <option key={s} value={s}>
              {s}
              {segmentDirty(s) ? " • edited" : ""}
            </option>
          ))}
        </select>
        <span className="spacer" />
        <span className={dirty ? "pill dirty" : "pill saved"} aria-live="polite">{dirty ? "Unsaved changes" : savedNote || "All changes saved"}</span>
        <button type="button" onClick={discard} disabled={!dirty || saving}>Discard</button>
        <button type="button" className="primary" onClick={save} disabled={!dirty || saving || badUrls.length > 0}>
          {saving ? "Saving…" : "Save"}
        </button>
      </div>

      {problems.length > 0 && (
        <div className="banner err" role="alert">
          {badUrls.length > 0 ? `Fix ${badUrls.length} source link(s) before saving:` : "The server did not accept some cards:"}
          <ul>
            {problems.map((p, i) => (
              <li key={`${p.id}-${i}`}>
                <button type="button" className="link" onClick={() => jump(p)}>{where(p)}</button> · {p.id.split("|").pop()}: {p.message}
              </li>
            ))}
          </ul>
        </div>
      )}
      {generalErrors.length > 0 && (
        <div className="banner err" role="alert">
          The server did not accept the inputs:
          <ul>{generalErrors.map((m) => <li key={m}>{m}</li>)}</ul>
        </div>
      )}

      <h2 ref={headingRef} tabIndex={-1} className="sel-h">
        {sel.region}, {sel.segment}
        {isGlobal && <span className="muted"> (global trend)</span>}
      </h2>
      <p className="small muted" style={{ marginTop: -6 }}>
        Levels go from strongly unfavorable through neutral to strongly favorable. <b>No data</b> means nothing is known; it is not the same as neutral.
      </p>

      {sideSection("demand")}
      {sideSection("supply")}

      <section className="panel" aria-labelledby="inputs-io-h">
        <h3 id="inputs-io-h" style={{ marginTop: 0 }}>Export and import</h3>
        <div className="row">
          <button type="button" onClick={exportJson}>Export inputs as JSON</button>
          <button type="button" onClick={() => fileInput.current?.click()}>Import JSON…</button>
          <input
            ref={fileInput}
            type="file"
            accept="application/json,.json"
            hidden
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) importFile(f);
              e.target.value = "";
            }}
          />
          <span className="small muted">Export includes unsaved edits. Import updates matching cards in the draft; review and Save.</span>
        </div>
        {importReport && (
          <div className={importReport.errors.length ? "banner warn" : "banner info"} role="status" style={{ marginTop: 10, marginBottom: 0 }}>
            {importReport.ok && <div>{importReport.ok}</div>}
            {importReport.errors.length > 0 && (
              <>
                <div>{importReport.errors.length} problem(s) in the file; those cards were not imported:</div>
                <ul>{importReport.errors.slice(0, 20).map((m) => <li key={m}>{m}</li>)}</ul>
              </>
            )}
          </div>
        )}
      </section>
    </section>
  );
}
