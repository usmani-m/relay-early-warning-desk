"""FastAPI backend. Stores config, inputs and decisions, runs Gemini analyses as background jobs, serves results.

No analysis happens here. Start from the project root:
  .venv\\Scripts\\python.exe -m uvicorn backend.main:app --reload --port 8000
"""

import shutil
import threading
from pathlib import Path
from typing import Literal

from dotenv import dotenv_values
from fastapi import FastAPI, HTTPException, Request
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from pydantic import BaseModel, ValidationError

from backend.categories import DEMAND_CATEGORIES, INTERNAL_CATEGORIES, MAX_ACTIVE_PER_SIDE, SUPPLY_CATEGORIES
from backend.gemini_client import ENV_PATH, load_settings, make_client, unwrap_run
from backend.inputs_sync import card_id, rename_region, rename_segment, sync_inputs
from backend.jobs import JobManager, Workspace, demo_inputs
from backend.models import GLOBAL, Config, Decision, InputCard, PolicyWeights
from backend.storage import (
    DATA, RUN_ID, load_config, load_decisions, load_inputs, read_json, run_files, save_config, save_decisions,
    save_inputs,
)

FRONTEND_ORIGINS = ["http://localhost:5173", "http://127.0.0.1:5173"]


class AnalyzeRequest(BaseModel):
    today: str | None = None
    focus: str = ""
    notes: str = ""
    use_cache: bool = False


class RenameRequest(BaseModel):
    kind: Literal["region", "segment"]
    old: str
    new: str


def _messages(errors) -> list[str]:
    """Pydantic errors as short readable strings."""
    out = []
    for e in errors:
        loc = ".".join(str(x) for x in e.get("loc", ()) if x != "body")
        msg = str(e.get("msg", "")).removeprefix("Value error, ")
        out.append(f"{loc}: {msg}" if loc else msg)
    return out


def _run_view(data: dict, run_id: str | None, default_source: str, inputs: list[dict] | None = None) -> dict:
    """A saved run file or a bare result, in one shape for the frontend.

    inputs: the cards behind the result; defaults to the run file's own snapshot (None for older runs).
    """
    result = unwrap_run(data)
    wrapped = result is not data
    meta = result.get("_meta") if isinstance(result, dict) else None
    return {
        "run_id": run_id,
        "saved_at": data.get("saved_at") if wrapped else None,
        "model": (data.get("model") if wrapped else None) or (meta or {}).get("model"),
        "source": "cache" if default_source == "cache" else (data.get("source") if wrapped else None) or default_source,
        "warnings": data.get("warnings", []) if wrapped else [],
        "result": result,
        "inputs": inputs if inputs is not None else (data.get("inputs") if wrapped else None),
    }


def create_app(data_dir: Path = DATA, settings_loader=load_settings, client_factory=make_client,
               env_path: Path = ENV_PATH) -> FastAPI:
    ws = Workspace(Path(data_dir))
    jobs = JobManager(ws, settings_loader, client_factory)
    write_lock = threading.Lock()

    app = FastAPI(title="Relay early-warning desk API",
                  description="Stores inputs, runs Gemini analyses as background jobs, serves results. No analysis here.")
    app.add_middleware(CORSMiddleware, allow_origins=FRONTEND_ORIGINS, allow_methods=["*"], allow_headers=["*"])
    app.state.jobs = jobs
    app.state.workspace = ws

    @app.exception_handler(RequestValidationError)
    async def _validation(_: Request, exc: RequestValidationError):
        return JSONResponse(status_code=422, content={"detail": _messages(exc.errors())})

    def invalid(msg: str | list[str]) -> HTTPException:
        return HTTPException(status_code=422, detail=msg if isinstance(msg, list) else [msg])

    # ---------- health and reference data ----------

    @app.get("/api/health")
    def health():
        values = dotenv_values(env_path) if env_path.exists() else {}
        return {
            "status": "ok",
            "env_file": env_path.exists(),
            "has_key": bool((values.get("GEMINI_API_KEY") or "").strip()),
            "has_model": bool((values.get("GEMINI_MODEL") or "").strip()),
            "job_running": jobs.running() is not None,
        }

    @app.get("/api/categories")
    def categories():
        def side(names):
            return [{"name": n, "abb_internal": n in INTERNAL_CATEGORIES} for n in names]
        return {"demand": side(DEMAND_CATEGORIES), "supply": side(SUPPLY_CATEGORIES),
                "max_active_per_side": MAX_ACTIVE_PER_SIDE}

    # ---------- config and inputs ----------

    @app.get("/api/config")
    def get_config() -> Config:
        return load_config(ws.config)

    @app.put("/api/config")
    def put_config(config: Config):
        with write_lock:
            old_cards = load_inputs(ws.inputs)
            before = {c.id for c in old_cards}
            cards = sync_inputs(config, old_cards)
            save_config(config, ws.config)
            save_inputs(cards, ws.inputs)
        after = {c.id for c in cards}
        return {"config": config, "inputs_added": len(after - before), "inputs_removed": len(before - after)}

    @app.put("/api/policy-weights")
    def put_policy_weights(weights: PolicyWeights) -> PolicyWeights:
        """Change only the objective weights (Run analysis tab); leaves the rest of the config and the cards alone."""
        with write_lock:
            config = load_config(ws.config).model_copy(update={"policy_weights": weights})
            save_config(config, ws.config)
        return weights

    @app.post("/api/config/rename")
    def rename(req: RenameRequest):
        with write_lock:
            config, cards = load_config(ws.config), load_inputs(ws.inputs)
            try:
                fn = rename_region if req.kind == "region" else rename_segment
                config, cards = fn(config, cards, req.old, req.new.strip())
            except ValidationError as e:
                raise invalid(_messages(e.errors())) from None
            except ValueError as e:
                raise invalid(str(e)) from None
            save_config(config, ws.config)
            save_inputs(cards, ws.inputs)
        return {"config": config}

    @app.get("/api/inputs")
    def get_inputs() -> list[InputCard]:
        return sync_inputs(load_config(ws.config), load_inputs(ws.inputs))

    @app.put("/api/inputs")
    def put_inputs(cards: list[InputCard]) -> list[InputCard]:
        with write_lock:
            config = load_config(ws.config)
            regions, segments = {GLOBAL, *config.regions}, set(config.segments)
            errors, seen = [], set()
            for c in cards:
                if c.region not in regions:
                    errors.append(f"Card {c.id}: unknown region {c.region!r}.")
                if c.side == "demand" and c.segment not in segments:
                    errors.append(f"Card {c.id}: unknown segment {c.segment!r}.")
                cid = card_id(c.side, c.region, c.segment, c.dataset)
                if cid in seen:
                    errors.append(f"Card {cid} appears twice.")
                seen.add(cid)
            if errors:
                raise invalid(errors)
            synced = sync_inputs(config, cards)
            save_inputs(synced, ws.inputs)
        return synced

    @app.post("/api/demo/reset")
    def demo_reset():
        if jobs.running():
            raise HTTPException(status_code=409, detail=["An analysis is running; reset the demo after it ends."])
        with write_lock:
            for name in ("config.json", "inputs.json"):
                shutil.copyfile(ws.demo_dir / name, ws.data_dir / name)
        return {"config": load_config(ws.config), "inputs": len(load_inputs(ws.inputs))}

    # ---------- analysis jobs ----------

    @app.post("/api/analyze")
    def start_analysis(req: AnalyzeRequest):
        job, already = jobs.start(req.model_dump())
        return {"job_id": job.id, "state": job.state, "already_running": already}

    def job_or_404(job_id: str):
        job = jobs.get(job_id)
        if job is None:
            raise HTTPException(status_code=404, detail=[f"Unknown job {job_id}."])
        return job

    @app.get("/api/analyze/{job_id}")
    def job_status(job_id: str):
        return job_or_404(job_id).to_dict()

    @app.post("/api/analyze/{job_id}/cancel")
    def cancel_job(job_id: str):
        job = job_or_404(job_id)
        if not job.cancel():
            raise HTTPException(status_code=409, detail=[f"Job already {job.state}."])
        return {"job_id": job.id, "state": job.state}

    # ---------- results ----------

    @app.get("/api/results")
    def list_results():
        out = []
        for path in run_files(ws.runs):
            data = read_json(path)
            out.append({"run_id": path.stem, "saved_at": data.get("saved_at"), "model": data.get("model"),
                        "source": data.get("source"), "warnings_count": len(data.get("warnings") or [])})
        return out

    @app.get("/api/results/latest")
    def latest_result():
        files = run_files(ws.runs)
        if not files:
            raise HTTPException(status_code=404, detail=["No saved runs yet."])
        return _run_view(read_json(files[0]), files[0].stem, "gemini")

    @app.get("/api/results/demo")
    def demo_result():
        if not ws.demo_result.exists():
            raise HTTPException(status_code=404, detail=["data/demo/demo_result.json is missing."])
        return _run_view(read_json(ws.demo_result), None, "cache", inputs=demo_inputs(ws))

    @app.get("/api/results/{run_id}")
    def result_by_id(run_id: str):
        if not RUN_ID.match(run_id):
            raise invalid(f"Invalid run id {run_id!r}; expected YYYYMMDD-HHMMSS.")
        path = ws.runs / f"{run_id}.json"
        if not path.exists():
            raise HTTPException(status_code=404, detail=[f"No run {run_id}."])
        return _run_view(read_json(path), run_id, "gemini")

    # ---------- decisions ----------

    @app.get("/api/decisions")
    def get_decisions() -> list[Decision]:
        return load_decisions(ws.decisions)

    @app.post("/api/decisions")
    def add_decision(decision: Decision) -> list[Decision]:
        """Upsert: a new decision on the same (as_of, region, segment, recommendation) replaces the old one,
        so <feedback> never carries two contradictory decisions for one recommendation."""
        key = lambda d: (d.as_of, d.region, d.segment, d.recommendation)
        with write_lock:
            decisions = [d for d in load_decisions(ws.decisions) if key(d) != key(decision)] + [decision]
            save_decisions(decisions, ws.decisions)
        return decisions

    return app


app = create_app()
