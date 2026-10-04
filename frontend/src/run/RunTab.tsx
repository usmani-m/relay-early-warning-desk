import { useCallback, useEffect, useRef, useState } from "react";
import { ApiError, api } from "../api";
import { hideVendor } from "../result/normalize";
import type { Job, PolicyWeights, RunListItem, RunView } from "../types";

interface Props {
  dataVersion: number;
  unsavedElsewhere: boolean; // unsaved Setup/Inputs changes: the run uses the saved data
  currentRunId: string | null | undefined;
  onResult: (view: RunView, focus: string) => void;
  onWeightsDirty: (dirty: boolean) => void;
}

const POLL_MS = 2000;
const WEIGHT_KEYS: { key: keyof PolicyWeights; label: string }[] = [
  { key: "profitability", label: "Profitability" },
  { key: "customer_value", label: "Customer value" },
  { key: "growth", label: "Growth" },
  { key: "resilience", label: "Resilience" },
];
const today = () => new Date().toISOString().slice(0, 10);
const DEMO_ID = "__demo__";

export function jobToView(job: Job): RunView {
  const meta = (job.meta ?? {}) as { model?: string; generated_at?: string };
  return {
    run_id: job.run_id,
    saved_at: meta.generated_at ?? null,
    model: meta.model ?? job.progress.model,
    source: job.source ?? "cache",
    warnings: job.warnings,
    result: job.result ?? {},
    inputs: job.inputs,
  };
}

export function weightsSum(w: PolicyWeights): number {
  return WEIGHT_KEYS.reduce((s, k) => s + (Number(w[k.key]) || 0), 0);
}

export function RunTab({ dataVersion, unsavedElsewhere, currentRunId, onResult, onWeightsDirty }: Props) {
  const [date, setDate] = useState(today);
  const [focus, setFocus] = useState("all");
  const [notes, setNotes] = useState("");
  const [useCache, setUseCache] = useState(true);
  const [regions, setRegions] = useState<string[]>([]);
  const [savedWeights, setSavedWeights] = useState<PolicyWeights | null>(null);
  const [weights, setWeights] = useState<PolicyWeights | null>(null);
  const [weightsError, setWeightsError] = useState<string | null>(null);
  const [job, setJob] = useState<Job | null>(null);
  const [startError, setStartError] = useState<string | null>(null);
  const [history, setHistory] = useState<RunListItem[]>([]);
  const [historyError, setHistoryError] = useState<string | null>(null);
  const [loadingRun, setLoadingRun] = useState<string | null>(null);
  const focusRef = useRef(focus);
  focusRef.current = focus;

  const loadHistory = useCallback(() => {
    api.listResults().then(setHistory).catch((e) => setHistoryError(e instanceof Error ? e.message : String(e)));
  }, []);

  useEffect(() => {
    api
      .getConfig()
      .then((c) => {
        setRegions(c.regions);
        setSavedWeights(c.policy_weights);
        setWeights(c.policy_weights);
      })
      .catch(() => undefined);
    loadHistory();
  }, [dataVersion, loadHistory]);

  const weightsDirty = !!weights && !!savedWeights && WEIGHT_KEYS.some((k) => weights[k.key] !== savedWeights[k.key]);
  useEffect(() => onWeightsDirty(weightsDirty), [weightsDirty, onWeightsDirty]);
  const sum = weights ? weightsSum(weights) : 100;
  const sumOk = Math.abs(sum - 100) < 1e-9;

  // Poll the running job every 2 s; stop when it ends or the tab unmounts.
  const jobId = job?.state === "running" ? job.job_id : null;
  useEffect(() => {
    if (!jobId) return;
    let alive = true;
    const timer = window.setInterval(async () => {
      try {
        const next = await api.getJob(jobId);
        if (!alive) return;
        setJob(next);
        if (next.state !== "running") window.clearInterval(timer);
      } catch {
        /* keep polling; a transient error shouldn't end the run view */
      }
    }, POLL_MS);
    return () => {
      alive = false;
      window.clearInterval(timer);
    };
  }, [jobId]);

  // When a job finishes successfully: load it into the Dashboard.
  const handled = useRef<string | null>(null);
  useEffect(() => {
    if (job && job.state === "done" && handled.current !== job.job_id) {
      handled.current = job.job_id;
      onResult(jobToView(job), focusRef.current === "all" ? "" : focusRef.current);
      loadHistory();
    }
  }, [job, onResult, loadHistory]);

  async function saveWeights(): Promise<boolean> {
    if (!weights) return false;
    setWeightsError(null);
    try {
      const w = await api.putPolicyWeights(weights);
      setSavedWeights(w);
      setWeights(w);
      return true;
    } catch (e) {
      setWeightsError(e instanceof ApiError ? e.messages.join(" ") : String(e));
      return false;
    }
  }

  async function run() {
    setStartError(null);
    if (weightsDirty && !(await saveWeights())) return;
    try {
      const res = await api.startAnalysis({ today: date, focus: focus === "all" ? "" : focus, notes, use_cache: useCache });
      setJob(await api.getJob(res.job_id)); // a job already running is simply attached to
    } catch (e) {
      setStartError(e instanceof ApiError ? e.messages.join(" ") : String(e));
    }
  }

  async function cancel() {
    if (!job) return;
    try {
      await api.cancelJob(job.job_id);
      setJob(await api.getJob(job.job_id));
    } catch (e) {
      setStartError(e instanceof ApiError ? e.messages.join(" ") : String(e));
    }
  }

  async function openRun(runId: string) {
    setLoadingRun(runId);
    try {
      const view = runId === DEMO_ID ? await api.demoResult() : await api.resultById(runId);
      onResult(view, focus === "all" ? "" : focus);
    } catch (e) {
      setHistoryError(e instanceof ApiError ? e.messages.join(" ") : String(e));
    } finally {
      setLoadingRun(null);
    }
  }

  const running = job?.state === "running";

  return (
    <section aria-labelledby="run-h">
      <h2 id="run-h" className="sr-only">Run analysis</h2>
      <div className="grid2">
        <div className="panel">
          <h2>Run an analysis</h2>
          <div className="filters" style={{ marginBottom: 10 }}>
            <label>
              Today
              <input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
            </label>
            <label>
              Focus
              <select value={focus} onChange={(e) => setFocus(e.target.value)}>
                <option value="all">All regions</option>
                {regions.map((r) => <option key={r} value={r}>{r}</option>)}
              </select>
            </label>
          </div>
          <label className="small muted" htmlFor="run-notes">Notes for the analysis (optional)</label>
          <textarea id="run-notes" rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="e.g. board meeting next week; focus on data center demand" />
          <div style={{ margin: "12px 0" }}>
            <label className="switch">
              <input type="checkbox" role="switch" checked={useCache} onChange={(e) => setUseCache(e.target.checked)} />
              <span><b>Use cached result</b></span>
            </label>
            <p className="field-note">
              {useCache
                ? "Loads the saved demo result instantly; no new AI analysis."
                : ""}
            </p>
          </div>
          {unsavedElsewhere && (
            <p className="banner warn small" style={{ margin: "0 0 10px" }}>
              You have unsaved changes in Setup or Inputs. The analysis uses the <b>saved</b> data.
            </p>
          )}
          <div className="row">
            <button type="button" className="primary" onClick={run} disabled={running || !sumOk}>
              {useCache ? "Load cached result" : "Run analysis"}
            </button>
            {!sumOk && <span className="field-error" style={{ margin: 0 }}>Objective weights must add up to 100.</span>}
          </div>
          {startError && <p className="field-error">{hideVendor(startError)}</p>}
        </div>

        <div className="panel">
          <h2>Objective weights</h2>
          <p className="small muted" style={{ marginTop: -4 }}>
            
          </p>
          {weights && (
            <div className="weights">
              {WEIGHT_KEYS.map((k) => (
                <div key={k.key} className="slider-cell">
                  <label htmlFor={`w-${k.key}`}>{k.label}</label>
                  <input
                    id={`w-${k.key}`}
                    type="range"
                    min={0}
                    max={100}
                    step={5}
                    value={weights[k.key]}
                    aria-invalid={!sumOk || undefined}
                    onChange={(e) => setWeights({ ...weights, [k.key]: Number(e.target.value) })}
                  />
                  <output htmlFor={`w-${k.key}`}>{weights[k.key]}%</output>
                </div>
              ))}
              <div className="row">
                <span className={sumOk ? "pill saved" : "pill dirty"} role="status" data-testid="weights-sum">Sum {sum}%</span>
                {!sumOk && <span className="field-error" style={{ margin: 0 }}>The weights add up to {sum}%; they must add up to 100%.</span>}
                <span className="spacer" />
                {weightsDirty && <span className="pill dirty">Unsaved</span>}
                <button type="button" className="small" disabled={!weightsDirty || !sumOk} onClick={saveWeights}>Save weights</button>
                <button type="button" className="small" disabled={!weightsDirty} onClick={() => setWeights(savedWeights)}>Discard</button>
              </div>
              {weightsError && <p className="field-error">{weightsError}</p>}
            </div>
          )}
        </div>
      </div>

      {job && <JobPanel job={job} onCancel={cancel} />}

      <div className="panel">
        <h2>Run history</h2>
        {historyError && <p className="field-error">{hideVendor(historyError)}</p>}
        <div className="tblwrap">
          <table aria-label="Run history">
            <thead>
              <tr>
                <th>Date</th>
                <th>Source</th>
                <th>Warnings</th>
                <th />
              </tr>
            </thead>
            <tbody>
              <tr className={currentRunId === null ? "current" : undefined}>
                <td>Demo result</td>
                <td className="muted">saved real run</td>
                <td><span className="badge cache">cache</span></td>
                <td />
                <td><button type="button" className="small" onClick={() => openRun(DEMO_ID)} disabled={loadingRun !== null}>Open</button></td>
              </tr>
              {history.map((h) => (
                <tr key={h.run_id} className={currentRunId === h.run_id ? "current" : undefined}>
                  <td>{(h.saved_at || h.run_id).replace("T", " ").slice(0, 16)}</td>
                  <td><span className={`badge ${h.source === "gemini" ? "gemini" : "cache"}`}>{h.source === "gemini" ? "live" : "cache"}</span></td>
                  <td>{h.warnings_count}</td>
                  <td>
                    <button type="button" className="small" onClick={() => openRun(h.run_id)} disabled={loadingRun !== null}>
                      {loadingRun === h.run_id ? "Opening…" : "Open"}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {history.length === 0 && <p className="small muted">No live runs saved yet.</p>}
      </div>
    </section>
  );
}

function JobPanel({ job, onCancel }: { job: Job; onCancel: () => void }) {
  const running = job.state === "running";
  const p = job.progress;
  return (
    <div className="panel" aria-live="polite" id="run-status">
      <div className="row">
        <h2 style={{ margin: 0 }}>{running ? <><span className="spinner" aria-hidden="true" />Analysis running</> : `Last run: ${job.state}`}</h2>
        {job.source && <span className={`badge ${job.source === "gemini" ? "gemini" : "cache"}`}>{job.source === "gemini" ? "live AI result" : "cached result"}</span>}
        <span className="spacer" />
        {running && <button type="button" className="danger" onClick={onCancel}>Cancel</button>}
      </div>
      <div className="progress">
        <div><span className="small muted">Attempt</span><b>{p.attempt || "–"}</b></div>
        <div><span className="small muted">AI models tried</span><b>{p.models_tried}</b></div>
        <div><span className="small muted">Last outcome</span><b>{p.last_outcome ?? (running ? "waiting" : "–")}</b></div>
        <div><span className="small muted">Elapsed</span><b>{Math.round(job.elapsed_s)} s</b></div>
      </div>
      {job.state === "failed" && <p className="banner err">The analysis failed: {hideVendor(job.error ?? "")}</p>}
      {job.state === "cancelled" && <p className="banner warn">The analysis was cancelled. A request already sent to the AI service is ignored when it returns.</p>}
      {job.state === "done" && (
        <p className="small">
          Done{job.run_id ? `, saved as run ${job.run_id}` : ""}. The result is on the Dashboard.
        </p>
      )}
      {job.warnings.length > 0 && (
        <details open={job.state !== "running"}>
          <summary className="small">Warnings ({job.warnings.length})</summary>
          <ul className="small">{job.warnings.map((w, i) => <li key={i}>{hideVendor(w)}</li>)}</ul>
        </details>
      )}
    </div>
  );
}
