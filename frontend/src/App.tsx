import { useCallback, useEffect, useRef, useState } from "react";
import type { KeyboardEvent } from "react";
import { api } from "./api";
import { Dashboard } from "./dashboard/Dashboard";
import { InputsTab } from "./inputs/InputsTab";
import { RunTab } from "./run/RunTab";
import { SetupTab } from "./setup/SetupTab";
import type { Health, RunView } from "./types";

const TABS = [
  { id: "setup", label: "Setup" },
  { id: "inputs", label: "Inputs" },
  { id: "run", label: "Run analysis" },
  { id: "dashboard", label: "Dashboard" },
] as const;
type TabId = (typeof TABS)[number]["id"];
type Theme = "system" | "light" | "dark";

const tabFromHash = (): TabId => {
  const h = window.location.hash.slice(1).split("/")[0]; // "#inputs/EUROPE/Utilities" -> inputs
  return (TABS.find((t) => t.id === h)?.id ?? "setup") as TabId;
};

// New key: the old "theme" key held "system" by default, which must not override the new light default.
const THEME_KEY = "theme-v2";

function readTheme(): Theme {
  try {
    const t = localStorage.getItem(THEME_KEY);
    return t === "dark" || t === "system" ? t : "light";
  } catch {
    return "light";
  }
}

export function App() {
  const [tab, setTab] = useState<TabId>(tabFromHash);
  const [theme, setTheme] = useState<Theme>(readTheme);
  const [health, setHealth] = useState<Health | null | "down">(null);
  const [setupDirty, setSetupDirty] = useState(false);
  const [inputsDirty, setInputsDirty] = useState(false);
  const [weightsDirty, setWeightsDirty] = useState(false);
  const [dataVersion, setDataVersion] = useState(0);
  const [view, setView] = useState<RunView | null>(null);
  const [focus, setFocus] = useState("");
  const tabRefs = useRef<(HTMLButtonElement | null)[]>([]);

  useEffect(() => {
    const onHash = () => setTab(tabFromHash());
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);

  // Light is the default. "System" follows the OS; dark styles live only in tokens.css ([data-theme="dark"]).
  useEffect(() => {
    const root = document.documentElement;
    const media = window.matchMedia?.("(prefers-color-scheme: dark)");
    const apply = () => {
      const dark = theme === "dark" || (theme === "system" && !!media?.matches);
      root.setAttribute("data-theme", dark ? "dark" : "light");
    };
    apply();
    try {
      localStorage.setItem(THEME_KEY, theme);
    } catch {
      /* storage unavailable: the choice just isn't remembered */
    }
    if (theme !== "system" || !media) return;
    media.addEventListener?.("change", apply);
    return () => media.removeEventListener?.("change", apply);
  }, [theme]);

  useEffect(() => {
    const check = () => api.health().then(setHealth).catch(() => setHealth("down"));
    check();
    const id = window.setInterval(check, 30000);
    return () => window.clearInterval(id);
  }, []);

  // Start with the latest saved run, else the demo result.
  useEffect(() => {
    api
      .listResults()
      .then((runs) => (runs.length ? api.resultById(runs[0].run_id) : api.demoResult()))
      .catch(() => api.demoResult())
      .then(setView)
      .catch(() => setView(null));
  }, []);

  const anyDirty = setupDirty || inputsDirty || weightsDirty;
  useEffect(() => {
    if (!anyDirty) return;
    const warn = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [anyDirty]);

  const select = (id: TabId) => {
    setTab(id);
    history.replaceState(null, "", `#${id}`);
  };

  function onTabKey(e: KeyboardEvent, index: number) {
    const step = e.key === "ArrowRight" ? 1 : e.key === "ArrowLeft" ? -1 : 0;
    if (!step) return;
    e.preventDefault();
    const next = (index + step + TABS.length) % TABS.length;
    select(TABS[next].id);
    tabRefs.current[next]?.focus();
  }

  const bumpData = useCallback(() => setDataVersion((v) => v + 1), []);
  const onResult = useCallback((v: RunView, f: string) => {
    setView(v);
    setFocus(f);
    setTab("dashboard");
    history.replaceState(null, "", "#dashboard");
    window.scrollTo({ top: 0 });
  }, []);

  return (
    <>
      <header>
        <div className="hwrap">
          <div>
            <h1>ForecastPulse</h1>
            <p className="sub">From Weak Signals to Smarter Decisions</p>
          </div>
          <div className="hside">
            <div className="htools">
              <HealthStatus health={health} />
              <label>
                <span className="sr-only">Colour theme</span>
                <select value={theme} onChange={(e) => setTheme(e.target.value as Theme)}>
                  <option value="light">Light</option>
                  <option value="dark">Dark</option>
                  <option value="system">System theme</option>
                </select>
              </label>
            </div>
            <nav role="tablist" aria-label="Sections">
              {TABS.map((t, i) => {
                const dirty = (t.id === "setup" && setupDirty) || (t.id === "inputs" && inputsDirty) || (t.id === "run" && weightsDirty);
                return (
                  <button
                    key={t.id}
                    ref={(el) => {
                      tabRefs.current[i] = el;
                    }}
                    role="tab"
                    id={`tab-${t.id}`}
                    aria-controls={`panel-${t.id}`}
                    aria-selected={tab === t.id}
                    tabIndex={tab === t.id ? 0 : -1}
                    onClick={() => select(t.id)}
                    onKeyDown={(e) => onTabKey(e, i)}
                  >
                    {t.label}
                    {dirty && <span className="dot" title="Unsaved changes" aria-label="unsaved changes" />}
                  </button>
                );
              })}
            </nav>
          </div>
        </div>
      </header>
      <main>
        {/* Tabs stay mounted so switching never loses unsaved edits. */}
        <div role="tabpanel" id="panel-setup" aria-labelledby="tab-setup" hidden={tab !== "setup"}>
          <SetupTab inputsDirty={inputsDirty} dataVersion={dataVersion} onDirtyChange={setSetupDirty} onDataChanged={bumpData} onGoInputs={() => select("inputs")} />
        </div>
        <div role="tabpanel" id="panel-inputs" aria-labelledby="tab-inputs" hidden={tab !== "inputs"}>
          <InputsTab dataVersion={dataVersion} onDirtyChange={setInputsDirty} onDataChanged={bumpData} />
        </div>
        <div role="tabpanel" id="panel-run" aria-labelledby="tab-run" hidden={tab !== "run"}>
          <RunTab
            dataVersion={dataVersion}
            unsavedElsewhere={setupDirty || inputsDirty}
            currentRunId={view ? view.run_id : undefined}
            onResult={onResult}
            onWeightsDirty={setWeightsDirty}
          />
        </div>
        <div role="tabpanel" id="panel-dashboard" aria-labelledby="tab-dashboard" hidden={tab !== "dashboard"}>
          <Dashboard view={view} focus={focus} dataVersion={dataVersion} onGoRun={() => select("run")} />
        </div>
      </main>
    </>
  );
}

function HealthStatus({ health }: { health: Health | null | "down" }) {
  if (health === null) return <span className="status">Checking backend…</span>;
  if (health === "down")
    return (
      <span className="status err" title="Start the backend on port 8000">
        <i /> Backend not reachable
      </span>
    );
  const ready = health.has_key && health.has_model;
  const missing = [!health.env_file && ".env file", !health.has_key && "API key", !health.has_model && "model"].filter(Boolean).join(", ");
  return (
    <span className={ready ? "status ok" : "status warn"} title={ready ? "Backend running; .env has a key and a model." : `Missing in .env: ${missing}`}>
      <i /> {ready ? "Backend ready" : `Backend: missing ${missing}`}
      {health.job_running && " · analysis running"}
    </span>
  );
}

