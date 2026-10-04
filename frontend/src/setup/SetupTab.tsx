import { useCallback, useEffect, useMemo, useState } from "react";
import { ApiError, api } from "../api";
import { ConfirmDialog } from "../components/ConfirmDialog";
import { FieldErrors } from "../components/FieldErrors";
import { SaveBar } from "../components/SaveBar";
import { Toggletip } from "../components/Toggletip";
import type { Categories, Config, InputCard } from "../types";
import { ChipList } from "./ChipList";
import { DependencyMatrix } from "./DependencyMatrix";
import type { Kind } from "./configEdit";
import { addName, deleteFromConfig, dependencyValid, groupMessages, renameInConfig, sameConfig, structureLine } from "./configEdit";

interface Props {
  inputsDirty: boolean;
  dataVersion: number;
  onDirtyChange: (dirty: boolean) => void;
  onDataChanged: () => void; // config saved, renamed or reset: inputs must reload
  onGoInputs: () => void;
}

export function SetupTab({ inputsDirty, dataVersion, onDirtyChange, onDataChanged, onGoInputs }: Props) {
  const [saved, setSaved] = useState<Config | null>(null);
  const [draft, setDraft] = useState<Config | null>(null);
  const [cards, setCards] = useState<InputCard[]>([]);
  const [categories, setCategories] = useState<Categories | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [serverErrors, setServerErrors] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [savedNote, setSavedNote] = useState<string | null>(null);
  const [editStructure, setEditStructure] = useState(false);
  const [pendingDelete, setPendingDelete] = useState<{ kind: Kind; name: string } | null>(null);
  const [resetOpen, setResetOpen] = useState(false);
  const [resetBusy, setResetBusy] = useState(false);
  const [resetError, setResetError] = useState<string | null>(null);

  const loadAll = useCallback(async () => {
    try {
      const [config, inputs, cats] = await Promise.all([api.getConfig(), api.getInputs(), api.categories()]);
      setSaved(config);
      setDraft(config);
      setCards(inputs);
      setCategories(cats);
      setLoadError(null);
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : String(e));
    }
  }, []);

  useEffect(() => {
    loadAll();
  }, [loadAll]);

  // Inputs (or their categories) were saved elsewhere: refresh the cards (for delete warnings) and the active categories.
  useEffect(() => {
    if (dataVersion === 0) return;
    api.getInputs().then(setCards).catch(() => undefined);
    api
      .getConfig()
      .then((c) => {
        setSaved((s) => (s ? { ...s, active_datasets: c.active_datasets, policy_weights: c.policy_weights } : s));
        setDraft((d) => (d ? { ...d, active_datasets: c.active_datasets, policy_weights: c.policy_weights } : d));
      })
      .catch(() => undefined);
  }, [dataVersion]);

  const dirty = !!draft && !sameConfig(draft, saved);
  useEffect(() => onDirtyChange(dirty), [dirty, onDirtyChange]);
  const errorsByField = useMemo(() => groupMessages(serverErrors), [serverErrors]);
  const depErrors = useMemo(
    () => Object.fromEntries(Object.entries(errorsByField).filter(([k]) => k.startsWith("dep:")).map(([k, v]) => [k.slice(4), v])),
    [errorsByField],
  );

  if (loadError) return <div className="banner err">Could not load the setup: {loadError}</div>;
  if (!draft || !saved || !categories) return <p className="muted">Loading setup…</p>;

  const update = (patch: Partial<Config>) => setDraft({ ...draft, ...patch });
  const filledCount = (kind: Kind, name: string) =>
    cards.filter((c) => c.level !== null && (kind === "region" ? c.region === name : c.segment === name)).length;
  const structureOk = dependencyValid(draft);

  const blockedReason = inputsDirty
    ? "Save or discard your input changes first (saving the setup re-syncs the input cards)."
    : !structureOk
      ? "Fix the supply chain structure: a region's shares add up to more than 100%."
      : null;

  async function save() {
    if (!draft) return;
    setSaving(true);
    setServerErrors([]);
    try {
      // Categories belong to the Inputs tab and weights to the Run tab: always keep the server's current ones.
      const current = await api.getConfig();
      const res = await api.putConfig({ ...draft, active_datasets: current.active_datasets, policy_weights: current.policy_weights });
      setSaved(res.config);
      setDraft(res.config);
      setSavedNote(`Saved: ${res.inputs_added} card(s) added, ${res.inputs_removed} removed`);
      setCards(await api.getInputs());
      onDataChanged();
    } catch (e) {
      setServerErrors(e instanceof ApiError ? e.messages : [String(e)]);
    } finally {
      setSaving(false);
    }
  }

  async function rename(kind: Kind, oldName: string, newName: string) {
    if (!saved || !draft) return;
    const existsOnServer = kind === "region" ? saved.regions.includes(oldName) : saved.segments.includes(oldName);
    if (existsOnServer) {
      try {
        const res = await api.rename(kind, oldName, newName);
        setSaved(res.config);
        setCards(await api.getInputs());
        onDataChanged();
      } catch (e) {
        throw new Error(e instanceof ApiError ? e.messages.join(" ") : String(e));
      }
    }
    setDraft(renameInConfig(draft, kind, oldName, newName)); // keeps other unsaved edits
  }

  async function resetDemo() {
    setResetBusy(true);
    setResetError(null);
    try {
      await api.resetDemo();
      await loadAll();
      setServerErrors([]);
      setSavedNote("Demo data restored");
      onDataChanged();
      setResetOpen(false);
    } catch (e) {
      setResetError(e instanceof ApiError ? e.messages.join(" ") : String(e));
    } finally {
      setResetBusy(false);
    }
  }

  const demandActive = draft.active_datasets.filter((d) => categories.demand.some((c) => c.name === d));
  const supplyActive = draft.active_datasets.filter((d) => categories.supply.some((c) => c.name === d));
  const general = [...(errorsByField.general ?? []), ...(errorsByField.categories ?? [])];

  return (
    <section aria-label="Setup">
      <SaveBar
        dirty={dirty}
        saving={saving}
        blockedReason={blockedReason}
        savedNote={savedNote}
        onSave={save}
        onDiscard={() => {
          setDraft(saved);
          setServerErrors([]);
        }}
      >
        <button type="button" onClick={() => setResetOpen(true)} disabled={inputsDirty} title={inputsDirty ? "Save or discard your input changes first." : undefined}>
          Reset to demo data
        </button>
      </SaveBar>

      {general.length > 0 && (
        <div className="banner err" role="alert">
          The server did not accept the setup:
          <ul>{general.map((m) => <li key={m}>{m}</li>)}</ul>
        </div>
      )}

      <div className="panel">
        <div className="sect-h">
          <h2>Regions</h2>
          <Toggletip label="Regions">
            Click a region to rename or delete it. Rename keeps all values and is saved right away. Added and deleted
            regions apply when you save; deleting removes that region's cards. "GLOBAL" is reserved for the global baseline.
          </Toggletip>
        </div>
        <ChipList
          kind="region"
          names={draft.regions}
          onAdd={(n) => update(addName(draft, "region", n))}
          onRename={(o, n) => rename("region", o, n)}
          onRequestDelete={(name) => setPendingDelete({ kind: "region", name })}
        />
        <FieldErrors messages={errorsByField.regions} />

        <div className="sect-h" style={{ marginTop: 14 }}>
          <h2>Segments</h2>
          <Toggletip label="Segments">
            Demand is rated per region and segment; supply per region. Rename keeps all values and is saved right away. Added and
            deleted segments apply when you save.
          </Toggletip>
        </div>
        <ChipList
          kind="segment"
          names={draft.segments}
          onAdd={(n) => update(addName(draft, "segment", n))}
          onRename={(o, n) => rename("segment", o, n)}
          onRequestDelete={(name) => setPendingDelete({ kind: "segment", name })}
        />
        <FieldErrors messages={errorsByField.segments} />
      </div>

      <div className="panel">
        <div className="sect-h">
          <h2>Data categories</h2>
          <Toggletip label="Data categories">
            Up to 3 of ABB's 8 categories per side are active. Only active categories are used in the AI analysis; cards of other categories
            keep their values.
          </Toggletip>
        </div>
        <p style={{ margin: 0 }}>
          <b>Demand:</b> {demandActive.join(", ") || "none"} · <b>Supply:</b> {supplyActive.join(", ") || "none"}{" "}
          <button type="button" className="link" onClick={onGoInputs}>Change on the Inputs tab</button>
        </p>
      </div>

      <div className="panel">
        <div className="sect-h">
          <h2>Supply chain structure</h2>
          {draft.dependencies_are_examples && <span className="chip example">Example values</span>}
          <Toggletip label="Supply chain structure">
            Where each region sources its key electronics (own share = 100% minus the shares from other regions), how strongly each
            region's demand draws on the shared component pool, and how much that pool pressure tightens supply elsewhere.
          </Toggletip>
          <span className="spacer" />
          <button type="button" className="small" aria-expanded={editStructure} aria-controls="structure-editor" onClick={() => setEditStructure(!editStructure)}>
            {editStructure ? "Done" : "Edit structure"}
          </button>
        </div>
        {!editStructure && (
          <div aria-label="Supply chain summary">
            <ul className="structure">
              {draft.regions.map((r) => {
                const line = structureLine(draft, r);
                return (
                  <li key={r} className={line.error ? "bad" : undefined}>
                    {line.text}
                    {line.error && <span className="field-error" style={{ display: "inline", marginLeft: 8 }}>{line.error}</span>}
                  </li>
                );
              })}
            </ul>
            <p className="small muted" style={{ margin: "6px 0 0" }}>
              Demand competition: {draft.regions.map((r) => `${r} ${(draft.demand_competition[r] ?? 0).toFixed(2)}`).join(", ")} · Pool pressure
              factor {draft.pool_pressure_factor.toFixed(2)}
            </p>
          </div>
        )}
        {editStructure && (
          <div id="structure-editor">
            <label className="small">
              <input type="checkbox" checked={draft.dependencies_are_examples} onChange={(e) => update({ dependencies_are_examples: e.target.checked })} /> These
              are example values
            </label>
            <h3>Where each region sources its electronics</h3>
            <DependencyMatrix regions={draft.regions} dependency={draft.supply_dependency} onChange={(d) => update({ supply_dependency: d })} serverErrors={depErrors} />
            <div className="grid2" style={{ marginTop: 12 }}>
              <div>
                <h3>Demand competition</h3>
                {draft.regions.map((r) => (
                  <div key={r} className="slider-cell" style={{ margin: "6px 0" }}>
                    <label htmlFor={`comp-${r}`} style={{ minWidth: 90 }}>{r}</label>
                    <input
                      id={`comp-${r}`}
                      type="range"
                      min={0}
                      max={1}
                      step={0.05}
                      value={draft.demand_competition[r] ?? 0}
                      onChange={(e) => update({ demand_competition: { ...draft.demand_competition, [r]: Math.round(Number(e.target.value) * 100) / 100 } })}
                    />
                    <output htmlFor={`comp-${r}`}>{(draft.demand_competition[r] ?? 0).toFixed(2)}</output>
                  </div>
                ))}
                <FieldErrors messages={errorsByField.competition} />
              </div>
              <div>
                <h3>Pool pressure factor</h3>
                <div className="slider-cell">
                  <label htmlFor="pool" className="sr-only">Pool pressure factor</label>
                  <input
                    id="pool"
                    type="range"
                    min={0}
                    max={2}
                    step={0.05}
                    value={draft.pool_pressure_factor}
                    onChange={(e) => update({ pool_pressure_factor: Math.round(Number(e.target.value) * 100) / 100 })}
                  />
                  <output htmlFor="pool">{draft.pool_pressure_factor.toFixed(2)}</output>
                </div>
                <FieldErrors messages={errorsByField.pool} />
              </div>
            </div>
          </div>
        )}
      </div>

      <ConfirmDialog
        open={!!pendingDelete}
        title={pendingDelete ? `Delete ${pendingDelete.kind} ${pendingDelete.name}?` : ""}
        confirmLabel="Delete"
        danger
        onCancel={() => setPendingDelete(null)}
        onConfirm={() => {
          if (pendingDelete) update(deleteFromConfig(draft, pendingDelete.kind, pendingDelete.name));
          setPendingDelete(null);
        }}
      >
        {pendingDelete && (
          <p>
            <b>{filledCount(pendingDelete.kind, pendingDelete.name)} filled card(s)</b> for {pendingDelete.name} will be removed when you
            save. {pendingDelete.kind === "region" && "Its supply chain settings go too."} You can still discard before saving.
          </p>
        )}
      </ConfirmDialog>

      <ConfirmDialog
        open={resetOpen}
        title="Reset to demo data?"
        confirmLabel="Reset"
        danger
        busy={resetBusy}
        onCancel={() => {
          setResetOpen(false);
          setResetError(null);
        }}
        onConfirm={resetDemo}
      >
        <p>This replaces your current setup and all input cards with the demo data. Planner decisions are kept.</p>
        {dirty && <p className="field-error">Your unsaved setup changes will be lost.</p>}
        {resetError && <p className="field-error">{resetError}</p>}
      </ConfirmDialog>
    </section>
  );
}
