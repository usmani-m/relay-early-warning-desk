"""Calls Gemini with the system prompt and the user message, trying models in order until one returns valid JSON.

Model order: GEMINI_MODEL, then GEMINI_FALLBACK_MODELS, then models discovered with client.models.list().
Busy (503/429): wait and retry the same model once. Not found: next model. Invalid JSON: retry once, then next model.
Key rejected (401/403): stop. After all models or the time budget, fall back to a cached result.

Never prints, logs or stores the API key.
"""

import json
import os
import re
import time
from collections import Counter
from dataclasses import dataclass, field
from datetime import datetime
from pathlib import Path

from dotenv import load_dotenv

from backend.storage import DATA, ROOT, read_json, run_files, write_json

ENV_PATH = ROOT / ".env"
PROMPT_PATH = ROOT / "prompts" / "system_prompt.md"
RUNS_DIR = DATA / "runs"
DEMO_RESULT = DATA / "demo" / "demo_result.json"
OLD_DEMO_RESULT = DATA / "demo_result.json"
CALL_TIMEOUT_S = 300  # default for GEMINI_CALL_TIMEOUT
TIME_BUDGET_S = 480  # default for GEMINI_TOTAL_BUDGET
BUSY_WAIT_S = 10
THINKING_LEVELS = ("minimal", "low", "medium", "high")
MIN_CALL_S = 5  # don't start a call with less time than this left
TEMPERATURE = 0.2

BUSY_CODES = {429, 500, 502, 503, 504}
EXCLUDED_WORDS = ("image", "tts", "embedding", "live", "audio", "transcribe", "veo", "imagen", "gemma",
                  "robotics", "computer-use")  # the last two are specialised, not general text models


class SettingsError(Exception):
    """The .env file is missing or lacks a required line."""


class KeyProblem(SettingsError):
    """Gemini rejected the API key. Other models won't help."""


@dataclass
class Settings:
    api_key: str = field(repr=False)
    model: str = ""
    fallback_models: list[str] = field(default_factory=list)
    max_output_tokens: int | None = None
    call_timeout_s: int = CALL_TIMEOUT_S
    total_budget_s: int = TIME_BUDGET_S
    thinking_budget: int | None = None  # tokens; 0 = off, -1 = automatic (Gemini 2.5 style)
    thinking_level: str | None = None  # minimal|low|medium|high (Gemini 3 style)

    def public(self) -> dict:
        """The non-secret settings, for logs and _meta."""
        return {"call_timeout_s": self.call_timeout_s, "total_budget_s": self.total_budget_s,
                "thinking_budget": self.thinking_budget, "thinking_level": self.thinking_level}


@dataclass
class AnalysisResult:
    result: dict
    warnings: list[str]
    source: str  # "gemini" or "cache"
    model: str = ""
    cache_path: str = ""


def load_settings(env_path: Path = ENV_PATH) -> Settings:
    if not env_path.exists():
        raise SettingsError(f"No .env file found at {env_path}. Copy .env.example to that path and fill in your values.")
    load_dotenv(env_path)
    key = os.getenv("GEMINI_API_KEY", "").strip()
    if not key:
        raise SettingsError("GEMINI_API_KEY is missing. Add this line to .env: GEMINI_API_KEY=<your key>")
    max_tokens = _int_env("GEMINI_MAX_OUTPUT_TOKENS", None, minimum=1, example="32000")
    call_timeout = _int_env("GEMINI_CALL_TIMEOUT", CALL_TIMEOUT_S, minimum=10, example="300")
    budget = _int_env("GEMINI_TOTAL_BUDGET", TIME_BUDGET_S, minimum=10, example="480")
    thinking_budget = _int_env("GEMINI_THINKING_BUDGET", None, minimum=-1, example="1024")
    level = os.getenv("GEMINI_THINKING_LEVEL", "").strip().lower() or None
    if level is not None and level not in THINKING_LEVELS:
        raise SettingsError(f"GEMINI_THINKING_LEVEL must be one of {', '.join(THINKING_LEVELS)}, e.g. GEMINI_THINKING_LEVEL=low")
    if level is not None and thinking_budget is not None:
        raise SettingsError("Set either GEMINI_THINKING_BUDGET or GEMINI_THINKING_LEVEL in .env, not both.")
    fallbacks = [m.strip() for m in os.getenv("GEMINI_FALLBACK_MODELS", "").split(",") if m.strip()]
    return Settings(api_key=key, model=os.getenv("GEMINI_MODEL", "").strip(), fallback_models=fallbacks,
                    max_output_tokens=max_tokens, call_timeout_s=call_timeout, total_budget_s=budget,
                    thinking_budget=thinking_budget, thinking_level=level)


def _int_env(name: str, default: int | None, *, minimum: int, example: str) -> int | None:
    raw = os.getenv(name, "").strip()
    if not raw:
        return default
    try:
        value = int(raw)
    except ValueError:
        value = None
    if value is None or value < minimum:
        raise SettingsError(f"{name} must be a whole number of at least {minimum}, e.g. {name}={example}")
    return value


# ---------- model list ----------

_DISCOVERED: list[str] | None = None


def reset_discovery_cache() -> None:
    global _DISCOVERED
    _DISCOVERED = None


def _bare(name: str) -> str:
    return name.removeprefix("models/").strip()


def sort_key(name: str):
    """flash before pro before flash-lite; stable before preview/exp; newest version first; -latest aliases first."""
    n = name.lower()
    family = 2 if "flash-lite" in n else 0 if "flash" in n else 1 if "pro" in n else 3
    unstable = 1 if ("preview" in n or "exp" in n) else 0
    m = re.search(r"-(\d+(?:\.\d+)?)(?=-|$)", n)
    version = float("-inf") if "latest" in n else -float(m.group(1)) if m else 0.0
    return family, unstable, version, n


def is_usable(name: str, actions) -> bool:
    n = name.lower()
    return ("generateContent" in (actions or []) and n.startswith("gemini")
            and not any(word in n for word in EXCLUDED_WORDS))


def discover_models(client) -> list[str]:
    """Usable text models from client.models.list(), sorted. Cached for the session."""
    global _DISCOVERED
    if _DISCOVERED is None:
        try:
            models = list(client.models.list())
        except Exception as e:
            if _classify(e) == "key":
                raise KeyProblem(_key_message(e)) from None
            raise
        names = {_bare(m.name) for m in models if is_usable(_bare(m.name), m.supported_actions)}
        _DISCOVERED = sorted(names, key=sort_key)
    return list(_DISCOVERED)


def iter_candidates(settings: Settings, client, warnings: list[str]):
    """Yield (model, origin) in order, without duplicates. Discovery runs only when the .env models are used up."""
    seen = set()
    configured = [(settings.model, "env")] if settings.model else []
    configured += [(m, "env_fallback") for m in settings.fallback_models]
    for name, origin in configured:
        if _bare(name) not in seen:
            seen.add(_bare(name))
            yield _bare(name), origin
    try:
        discovered = discover_models(client)
    except KeyProblem:
        raise
    except Exception as e:
        warnings.append(f"Could not list models ({type(e).__name__}: {_clean(e, settings.api_key)}); "
                        "only the models from .env were tried.")
        return
    for name in discovered:
        if name not in seen:
            seen.add(name)
            yield name, "discovered"


def candidate_models(settings: Settings, client) -> list[tuple[str, str]]:
    return list(iter_candidates(settings, client, []))


# ---------- calling ----------

_FENCE = re.compile(r"^\s*```[a-zA-Z]*\s*\n?(.*?)\n?\s*```\s*$", re.DOTALL)


def parse_json(text: str | None) -> dict:
    """Strip ``` fences and parse. Raises ValueError unless the text is a JSON object."""
    if not text or not text.strip():
        raise ValueError("empty response")
    m = _FENCE.match(text)
    data = json.loads(m.group(1) if m else text)
    if not isinstance(data, dict):
        raise ValueError(f"expected a JSON object, got {type(data).__name__}")
    return data


def _classify(e: Exception) -> str:
    code = getattr(e, "code", None)
    msg = str(e).lower()
    if code in (401, 403) or (code == 400 and "api key" in msg):
        return "key"
    if code == 400 and "thinking" in msg:
        return "thinking_unsupported"
    if code in BUSY_CODES:
        return "busy"
    if code == 404 or "not found" in msg or "not supported" in msg:
        return "not_found"
    return "error"


def _clean(e: Exception, api_key: str) -> str:
    text = str(e)
    return (text.replace(api_key, "***") if api_key else text)[:200]


def _key_message(e: Exception) -> str:
    return (f"Gemini rejected the API key ({getattr(e, 'code', '?')}). Check GEMINI_API_KEY in .env "
            "(create a new key in Google AI Studio if needed).")


def _finish_reason(response) -> str:
    try:
        return str(response.candidates[0].finish_reason or "")
    except (AttributeError, IndexError, TypeError):
        return ""


def make_client(settings: Settings):
    from google import genai
    from google.genai import types

    return genai.Client(api_key=settings.api_key,
                        http_options=types.HttpOptions(timeout=settings.call_timeout_s * 1000))


def _thinking_config(settings: Settings):
    from google.genai import types

    if settings.thinking_budget is not None:
        return types.ThinkingConfig(thinking_budget=settings.thinking_budget)
    if settings.thinking_level:
        return types.ThinkingConfig(thinking_level=settings.thinking_level.upper())
    return None


def _generate_config(settings: Settings, system_prompt: str, timeout_s: float, with_thinking: bool = True):
    from google.genai import types

    kwargs = dict(
        system_instruction=system_prompt,
        response_mime_type="application/json",
        temperature=TEMPERATURE,
        http_options=types.HttpOptions(timeout=int(timeout_s * 1000)),
        automatic_function_calling=types.AutomaticFunctionCallingConfig(disable=True),
    )
    if settings.max_output_tokens:
        kwargs["max_output_tokens"] = settings.max_output_tokens
    thinking = _thinking_config(settings) if with_thinking else None
    if thinking is not None:
        kwargs["thinking_config"] = thinking
    return types.GenerateContentConfig(**kwargs)


def unwrap_run(data):
    """A run file is {saved_at, model, source, warnings, result}; a bare result is returned unchanged."""
    if isinstance(data, dict) and isinstance(data.get("result"), dict) and "saved_at" in data:
        return data["result"]
    return data


def load_demo_result(demo_result: Path | None = None) -> tuple[dict, str, list[str]] | None:
    """The demo result, then the old demo result. Returns (result, path, notes)."""
    demo_result = demo_result or DEMO_RESULT
    if demo_result.exists():
        return unwrap_run(read_json(demo_result)), str(demo_result), []
    if OLD_DEMO_RESULT.exists():
        return read_json(OLD_DEMO_RESULT), str(OLD_DEMO_RESULT), [
            "The cached result is the OLD demo result (9-point scale, old schema); expect format warnings."]
    return None


def load_cached(runs_dir: Path = RUNS_DIR, demo_result: Path | None = None) -> tuple[dict, str, list[str]] | None:
    """Latest good Gemini run, then the demo result, then the old demo result. Returns (result, path, notes)."""
    for path in run_files(runs_dir):
        try:
            run = read_json(path)
        except (OSError, json.JSONDecodeError):
            continue
        if isinstance(run, dict) and run.get("source") == "gemini" and isinstance(run.get("result"), dict):
            return run["result"], str(path), []
    return load_demo_result(demo_result)


def _rel(path: str) -> str:
    try:
        return os.path.relpath(path, ROOT)
    except ValueError:  # different drive on Windows
        return path


def fallback(reason: str, model: str = "", runs_dir: Path = RUNS_DIR, extra: list[str] | None = None,
             demo_result: Path | None = None) -> AnalysisResult:
    cached = load_cached(runs_dir, demo_result)
    if cached is None:
        raise RuntimeError(f"{reason} No cached result is available either.")
    result, path, notes = cached
    rel = _rel(path)
    return AnalysisResult(result=result, source="cache", model=model, cache_path=rel,
                          warnings=[*(extra or []), reason, f"Showing a CACHED result from {rel}, not a new analysis.", *notes])


def summarize_attempts(attempts: list[dict], seconds: float) -> str:
    if not attempts:
        return "No model was tried."
    per_model: dict[str, Counter] = {}
    for a in attempts:
        per_model.setdefault(a["model"], Counter())[a["outcome"]] += 1
    parts = [f"{m} " + ", ".join(f"{o} x{n}" if n > 1 else o for o, n in c.items()) for m, c in per_model.items()]
    return f"Tried {len(per_model)} model(s) in {seconds:.0f} s: " + "; ".join(parts) + "."


class Cancelled(Exception):
    """The caller asked to stop (should_stop returned True)."""


def analyze(message: str, *, settings: Settings | None = None, client=None, runs_dir: Path = RUNS_DIR,
            sleep=time.sleep, clock=time.monotonic, on_progress=None, should_stop=None,
            demo_result: Path | None = None) -> AnalysisResult:
    """Try models in order until one returns a JSON object; otherwise fall back to the cache.

    on_progress(model, attempt, outcome): called before each call (outcome None) and after it.
    should_stop(): checked before each call and after each call or wait; True raises Cancelled.
    SettingsError and KeyProblem are raised, not hidden behind the cache.
    """
    settings = settings or load_settings()
    client = client or make_client(settings)
    prompt = PROMPT_PATH.read_text(encoding="utf-8")
    warnings: list[str] = []
    attempts: list[dict] = []
    start = clock()
    out_of_time = False

    def check_stop() -> None:
        if should_stop and should_stop():
            raise Cancelled()

    budget = settings.total_budget_s
    for name, _origin in iter_candidates(settings, client, warnings):
        busy_retried = json_retried = False
        with_thinking = True
        tries = 0
        while True:
            check_stop()
            remaining = budget - (clock() - start)
            if remaining < MIN_CALL_S:
                out_of_time = True
                break
            t0 = clock()
            tries += 1
            config = _generate_config(settings, prompt, min(settings.call_timeout_s, remaining), with_thinking)

            def record(outcome: str, detail: str = "") -> None:
                attempts.append({"model": name, "outcome": outcome, "detail": detail,
                                 "seconds": round(clock() - t0, 1)})
                if on_progress:
                    on_progress(name, tries, outcome)

            if on_progress:
                on_progress(name, tries, None)
            try:
                response = client.models.generate_content(model=name, contents=message, config=config)
            except Exception as e:  # API errors, timeouts, network
                kind = _classify(e)
                record(kind, f"{type(e).__name__}: {_clean(e, settings.api_key)}")
                if kind == "key":
                    raise KeyProblem(_key_message(e)) from None
                check_stop()
                if kind == "thinking_unsupported" and with_thinking:
                    with_thinking = False  # this model rejects the thinking setting: same model without it
                    warnings.append(f"{name} rejected the thinking setting; retried without it.")
                    continue
                if kind == "busy" and not busy_retried:
                    busy_retried = True
                    if budget - (clock() - start) > BUSY_WAIT_S + MIN_CALL_S:
                        sleep(BUSY_WAIT_S)
                        continue
                break  # next model
            check_stop()  # a late answer after a cancel is discarded
            try:
                result = parse_json(response.text)
            except ValueError as e:  # json.JSONDecodeError is a ValueError
                limit = " (hit the token limit; raise GEMINI_MAX_OUTPUT_TOKENS)" if "MAX_TOKENS" in _finish_reason(response) else ""
                record("invalid_json", f"{e}{limit}")
                if not json_retried:
                    json_retried = True
                    continue
                break
            record("ok")
            result["_meta"] = {"model": name, "attempts": attempts,
                               "generated_at": datetime.now().isoformat(timespec="seconds"),
                               "seconds_total": round(clock() - start, 1),
                               "settings": {**settings.public(), "thinking_applied": with_thinking and
                                            _thinking_config(settings) is not None}}
            if len(attempts) > 1:
                warnings.append(summarize_attempts(attempts, clock() - start))
            return AnalysisResult(result=result, warnings=warnings, source="gemini", model=name)
        if out_of_time:
            break

    summary = summarize_attempts(attempts, clock() - start)
    if out_of_time or budget - (clock() - start) < MIN_CALL_S:
        reason = f"Time budget of {budget} s used up (GEMINI_TOTAL_BUDGET). {summary}"
    elif not attempts:
        reason = "No usable Gemini model found (set GEMINI_MODEL in .env or check scripts/list_models.py)."
    else:
        reason = f"No model returned a valid result. {summary}"
    return fallback(reason, "", runs_dir, extra=warnings, demo_result=demo_result)


def save_run(analysis: AnalysisResult, format_warnings: list[str], runs_dir: Path = RUNS_DIR,
             inputs: list[dict] | None = None) -> Path:
    """Save a Gemini result to data/runs/<timestamp>.json. Cached results are not saved again.

    inputs: the cards that were sent (snapshot), so the dashboard can show them later.
    """
    now = datetime.now()
    path = runs_dir / f"{now:%Y%m%d-%H%M%S}.json"
    n = 2
    while path.exists():  # two runs in the same second
        path = runs_dir / f"{now:%Y%m%d-%H%M%S}-{n}.json"
        n += 1
    write_json(path, {
        "saved_at": now.isoformat(timespec="seconds"),
        "model": analysis.model,
        "source": analysis.source,
        "warnings": analysis.warnings + format_warnings,
        "result": analysis.result,
        **({"inputs": inputs} if inputs is not None else {}),
    })
    return path
