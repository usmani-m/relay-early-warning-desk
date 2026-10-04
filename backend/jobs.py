"""Background analysis jobs: one thread per job, at most one running at a time, kept in memory only.

A cancel marks the job cancelled at once. A Gemini call already in flight can't be aborted; the worker stops before
its next attempt (or during a busy wait) and its late result is discarded.
"""

import threading
import time
import uuid
from dataclasses import dataclass, field
from datetime import date
from pathlib import Path

from backend.format_check import check_result
from backend.gemini_client import Cancelled, SettingsError, analyze, load_demo_result, save_run
from backend.inputs_sync import active_cards
from backend.message_builder import build_user_message
from backend.storage import ROOT, load_config, load_decisions, load_inputs, read_json

MAX_JOBS_KEPT = 20


@dataclass
class Workspace:
    """Where the app reads and writes its files. Tests point this at a temporary folder."""
    data_dir: Path

    @property
    def config(self) -> Path:
        return self.data_dir / "config.json"

    @property
    def inputs(self) -> Path:
        return self.data_dir / "inputs.json"

    @property
    def decisions(self) -> Path:
        return self.data_dir / "decisions.json"

    @property
    def runs(self) -> Path:
        return self.data_dir / "runs"

    @property
    def demo_dir(self) -> Path:
        return self.data_dir / "demo"

    @property
    def demo_result(self) -> Path:
        return self.demo_dir / "demo_result.json"


@dataclass
class Job:
    id: str
    params: dict
    state: str = "running"  # running | done | failed | cancelled
    started: float = field(default_factory=time.monotonic)
    finished: float | None = None
    progress: dict = field(default_factory=lambda: {"model": None, "attempt": 0, "models_tried": 0, "last_outcome": None})
    result: dict | None = None
    warnings: list[str] = field(default_factory=list)
    source: str | None = None
    meta: dict | None = None
    error: str | None = None
    run_id: str | None = None
    inputs: list[dict] | None = None  # the cards behind the result (snapshot), for the dashboard
    cancel_event: threading.Event = field(default_factory=threading.Event)
    _lock: threading.Lock = field(default_factory=threading.Lock)
    _models: set = field(default_factory=set)

    def set_progress(self, model: str, attempt: int, outcome: str | None) -> None:
        with self._lock:
            self._models.add(model)
            self.progress = {"model": model, "attempt": attempt, "models_tried": len(self._models),
                             "last_outcome": outcome}

    def finish(self, state: str, **fields) -> bool:
        """Set the final state unless the job already ended (e.g. cancelled). Returns True if applied."""
        with self._lock:
            if self.state != "running":
                return False
            for k, v in fields.items():
                setattr(self, k, v)
            self.state = state
            self.finished = time.monotonic()
            return True

    def cancel(self) -> bool:
        applied = self.finish("cancelled")
        self.cancel_event.set()
        return applied

    def to_dict(self) -> dict:
        with self._lock:
            end = self.finished if self.finished is not None else time.monotonic()
            return {
                "job_id": self.id, "state": self.state, "progress": dict(self.progress),
                "elapsed_s": round(end - self.started, 1), "result": self.result, "warnings": list(self.warnings),
                "source": self.source, "meta": self.meta, "error": self.error, "run_id": self.run_id,
                "inputs": self.inputs,
            }


def inputs_snapshot(config, cards) -> list[dict]:
    """The cards that were sent to Gemini: active categories, with a value."""
    return [c.model_dump() for c in active_cards(config, cards) if c.level is not None]


def demo_inputs(ws: Workspace) -> list[dict] | None:
    """The inputs that produced data/demo/demo_result.json."""
    path = ws.demo_dir / "inputs.json"
    if not (path.exists() and (ws.demo_dir / "config.json").exists()):
        return None
    return inputs_snapshot(load_config(ws.demo_dir / "config.json"), load_inputs(path))


def inputs_for_cached(ws: Workspace, cache_path: str) -> list[dict] | None:
    """Snapshot for a cached result: the run file's own snapshot, or the demo inputs for the demo result."""
    path = Path(cache_path)
    path = path if path.is_absolute() else ROOT / path
    if path.resolve() == ws.demo_result.resolve():
        return demo_inputs(ws)
    if path.parent.resolve() == ws.runs.resolve() and path.exists():
        data = read_json(path)
        return data.get("inputs") if isinstance(data, dict) else None
    return None  # e.g. the old data/demo_result.json


def run_analysis_job(job: Job, ws: Workspace, settings_loader, client_factory) -> None:
    """Worker body. Snapshots config, inputs and decisions at start."""
    try:
        config, cards = load_config(ws.config), load_inputs(ws.inputs)
        snapshot = inputs_snapshot(config, cards)
        message = build_user_message(config, cards, load_decisions(ws.decisions), today=job.params["today"],
                                     focus=job.params.get("focus", ""), notes=job.params.get("notes", ""))
        settings = settings_loader()
        analysis = analyze(message, settings=settings, client=client_factory(settings), runs_dir=ws.runs,
                           sleep=job.cancel_event.wait, on_progress=job.set_progress,
                           should_stop=job.cancel_event.is_set, demo_result=ws.demo_result)
        if job.cancel_event.is_set():
            return
        format_warnings = check_result(analysis.result, config, cards)
        if analysis.source == "gemini":
            run_id = save_run(analysis, format_warnings, ws.runs, inputs=snapshot).stem
            used_inputs = snapshot
        else:
            run_id = None
            used_inputs = inputs_for_cached(ws, analysis.cache_path)
        meta = analysis.result.get("_meta") if isinstance(analysis.result, dict) else None
        job.finish("done", result=analysis.result, warnings=analysis.warnings + format_warnings,
                   source=analysis.source, meta=meta, run_id=run_id, inputs=used_inputs)
    except Cancelled:
        pass  # already marked cancelled
    except SettingsError as e:  # includes KeyProblem; messages never contain the key
        job.finish("failed", error=str(e))
    except Exception as e:
        job.finish("failed", error=f"{type(e).__name__}: {e}")


class JobManager:
    def __init__(self, ws: Workspace, settings_loader, client_factory):
        self.ws = ws
        self.settings_loader = settings_loader
        self.client_factory = client_factory
        self._jobs: dict[str, Job] = {}
        self._lock = threading.Lock()

    def running(self) -> Job | None:
        with self._lock:
            return next((j for j in self._jobs.values() if j.state == "running"), None)

    def get(self, job_id: str) -> Job | None:
        with self._lock:
            return self._jobs.get(job_id)

    def _add(self, job: Job) -> None:
        self._jobs[job.id] = job
        while len(self._jobs) > MAX_JOBS_KEPT:
            oldest = next(j for j in self._jobs.values() if j.state != "running")
            del self._jobs[oldest.id]

    def start(self, params: dict) -> tuple[Job, bool]:
        """Start a job, or return the running one. Returns (job, already_running)."""
        params = {**params, "today": params.get("today") or date.today().isoformat()}
        with self._lock:
            current = next((j for j in self._jobs.values() if j.state == "running"), None)
            if current:
                return current, True
            job = Job(id=uuid.uuid4().hex[:12], params=params)
            self._add(job)
            if params.get("use_cache"):
                self._finish_from_cache(job)
                return job, False
        threading.Thread(target=run_analysis_job, args=(job, self.ws, self.settings_loader, self.client_factory),
                         daemon=True, name=f"analysis-{job.id}").start()
        return job, False

    def _finish_from_cache(self, job: Job) -> None:
        cached = load_demo_result(self.ws.demo_result)
        if cached is None:
            job.finish("failed", error="No demo result available (data/demo/demo_result.json is missing).")
            return
        result, path, notes = cached
        meta = result.get("_meta") if isinstance(result, dict) else None
        job.finish("done", result=result, source="cache", meta=meta, inputs=inputs_for_cached(self.ws, path),
                   warnings=[f"Cached demo result ({Path(path).name}), not a new analysis.", *notes])
