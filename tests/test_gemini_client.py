"""Gemini client tests with a fake client, fake sleep and fake clock. No real API calls, no real waiting."""

import pytest

from backend import gemini_client as gc
from backend.gemini_client import (
    Cancelled, KeyProblem, Settings, SettingsError, analyze, candidate_models, is_usable, load_settings, parse_json,
    save_run, sort_key,
)
from tests.fakes import FakeClient, FakeClock, api_error, busy

SETTINGS = Settings(api_key="test-key", model="m1", fallback_models=["m2"], max_output_tokens=1000)
GOOD_JSON = '{"ok": 1}'


@pytest.fixture(autouse=True)
def isolated(tmp_path, monkeypatch):
    gc.reset_discovery_cache()
    monkeypatch.setattr(gc, "DEMO_RESULT", tmp_path / "none.json")
    old = tmp_path / "old.json"
    old.write_text('{"old": true}', encoding="utf-8")
    monkeypatch.setattr(gc, "OLD_DEMO_RESULT", old)
    yield
    gc.reset_discovery_cache()


def run(client, clock=None, settings=SETTINGS, tmp_runs=None):
    waits = []
    clock = clock or FakeClock()

    def sleep(s):
        waits.append(s)
        clock.t += s

    res = analyze("msg", settings=settings, client=client, runs_dir=tmp_runs or gc.Path("nonexistent-runs"),
                  sleep=sleep, clock=clock)
    return res, waits


# ---------- parsing and settings ----------

def test_parse_json_strips_fences():
    assert parse_json('```json\n{"a": 1}\n```') == {"a": 1}
    assert parse_json('  {"a": 2} ') == {"a": 2}
    with pytest.raises(ValueError):
        parse_json("[1]")
    with pytest.raises(ValueError):
        parse_json("")


ENV_VARS = ("GEMINI_API_KEY", "GEMINI_MODEL", "GEMINI_FALLBACK_MODELS", "GEMINI_MAX_OUTPUT_TOKENS",
            "GEMINI_CALL_TIMEOUT", "GEMINI_TOTAL_BUDGET", "GEMINI_THINKING_BUDGET", "GEMINI_THINKING_LEVEL")


@pytest.fixture
def env_file(tmp_path, monkeypatch):
    """A temporary .env; load_dotenv writes into os.environ, so clear the variables before each load."""
    path = tmp_path / ".env"

    def load(text: str):
        for var in ENV_VARS:
            monkeypatch.delenv(var, raising=False)
        path.write_text(text, encoding="utf-8")
        return load_settings(path)

    yield path, load
    for var in ENV_VARS:
        monkeypatch.delenv(var, raising=False)


def test_settings(env_file):
    path, load = env_file
    with pytest.raises(SettingsError, match="No .env file"):
        load_settings(path)
    with pytest.raises(SettingsError, match="GEMINI_API_KEY="):
        load("GEMINI_MODEL=m\n")
    s = load("GEMINI_API_KEY=abc\nGEMINI_MODEL=m\nGEMINI_FALLBACK_MODELS= a , ,b\n")
    assert s.model == "m" and s.fallback_models == ["a", "b"] and s.max_output_tokens is None
    assert "abc" not in repr(s)
    assert (s.call_timeout_s, s.total_budget_s, s.thinking_budget, s.thinking_level) == (300, 480, None, None)


def test_timeout_budget_and_thinking_settings(env_file):
    _, load = env_file
    s = load("GEMINI_API_KEY=k\nGEMINI_CALL_TIMEOUT=120\nGEMINI_TOTAL_BUDGET=600\nGEMINI_THINKING_BUDGET=0\n")
    assert (s.call_timeout_s, s.total_budget_s, s.thinking_budget) == (120, 600, 0)
    assert load("GEMINI_API_KEY=k\nGEMINI_THINKING_LEVEL=Low\n").thinking_level == "low"
    assert load("GEMINI_API_KEY=k\nGEMINI_THINKING_BUDGET=-1\n").thinking_budget == -1
    for bad, msg in [("GEMINI_CALL_TIMEOUT=abc", "GEMINI_CALL_TIMEOUT=300"),
                     ("GEMINI_TOTAL_BUDGET=5", "at least 10"),
                     ("GEMINI_THINKING_BUDGET=-2", "GEMINI_THINKING_BUDGET"),
                     ("GEMINI_THINKING_LEVEL=extreme", "minimal, low, medium, high"),
                     ("GEMINI_THINKING_BUDGET=512\nGEMINI_THINKING_LEVEL=low", "not both")]:
        with pytest.raises(SettingsError, match=msg):
            load(f"GEMINI_API_KEY=k\n{bad}\n")


# ---------- attempt loop ----------

def test_success_first_try_sets_config_and_meta():
    client = FakeClient({"m1": ['{"ok": 1}']})
    res, waits = run(client)
    assert (res.source, res.model, res.warnings, waits) == ("gemini", "m1", [], [])
    assert res.result["ok"] == 1
    meta = res.result["_meta"]
    assert meta["model"] == "m1" and [a["outcome"] for a in meta["attempts"]] == ["ok"] and meta["generated_at"]
    _, cfg, _ = client.calls[0]
    assert cfg.temperature == 0.2 and cfg.response_mime_type == "application/json" and cfg.max_output_tokens == 1000
    assert "AI Agents Platform" in cfg.system_instruction
    assert cfg.http_options.timeout == 300_000
    assert cfg.thinking_config is None  # model default unless set in .env
    assert meta["settings"] == {"call_timeout_s": 300, "total_budget_s": 480, "thinking_budget": None,
                                "thinking_level": None, "thinking_applied": False}


def test_thinking_and_custom_timeout_sent_to_gemini():
    s = Settings(api_key="k", model="m1", call_timeout_s=120, thinking_budget=512)
    client = FakeClient({"m1": ['{"ok": 1}']})
    res, _ = run(client, settings=s)
    _, cfg, _ = client.calls[0]
    assert cfg.thinking_config.thinking_budget == 512 and cfg.http_options.timeout == 120_000
    assert res.result["_meta"]["settings"]["thinking_applied"] is True
    s = Settings(api_key="k", model="m1", thinking_level="low")
    client = FakeClient({"m1": ['{"ok": 1}']})
    run(client, settings=s)
    assert client.calls[0][1].thinking_config.thinking_level.value == "LOW"


def test_model_rejecting_thinking_is_retried_without_it():
    s = Settings(api_key="k", model="m1", thinking_budget=0)
    err = api_error(400, "Thinking budget is not supported for this model.", "INVALID_ARGUMENT")
    client = FakeClient({"m1": [err, '{"ok": 1}']})
    res, waits = run(client, settings=s)
    assert res.source == "gemini" and res.model == "m1" and waits == []
    assert client.calls[0][1].thinking_config is not None and client.calls[1][1].thinking_config is None
    assert res.result["_meta"]["settings"]["thinking_applied"] is False
    assert any("rejected the thinking setting" in w for w in res.warnings)


def test_custom_total_budget():
    clock = FakeClock()
    s = Settings(api_key="k", model="m1", fallback_models=["m2"], total_budget_s=60)
    client = FakeClient({"m1": [busy(), busy()], "m2": [busy(), busy()]}, clock=clock, call_seconds=50)
    res, waits = run(client, clock=clock, settings=s)
    assert res.source == "cache" and "Time budget of 60 s" in " ".join(res.warnings)
    assert waits == []  # no time left for the 10 s busy wait
    assert client.calls[1][1].http_options.timeout == 10_000  # last call cut to the remaining budget


def test_busy_then_success_on_same_model():
    client = FakeClient({"m1": [busy(), '{"ok": 1}']})
    res, waits = run(client)
    assert res.source == "gemini" and res.model == "m1"
    assert waits == [gc.BUSY_WAIT_S]
    assert [a["outcome"] for a in res.result["_meta"]["attempts"]] == ["busy", "ok"]


def test_busy_twice_then_next_model():
    client = FakeClient({"m1": [busy(), busy()], "m2": ['{"ok": 2}']})
    res, waits = run(client)
    assert res.source == "gemini" and res.model == "m2" and res.result["_meta"]["model"] == "m2"
    assert waits == [gc.BUSY_WAIT_S]
    assert [c[0] for c in client.calls] == ["m1", "m1", "m2"]
    assert "Tried 2 model(s)" in res.warnings[0]


def test_not_found_skips_immediately():
    client = FakeClient({"m1": [api_error(404, "models/m1 is not found for API version v1beta", "NOT_FOUND")],
                         "m2": ['{"ok": 2}']})
    res, waits = run(client)
    assert res.model == "m2" and waits == []
    assert [c[0] for c in client.calls] == ["m1", "m2"]


@pytest.mark.parametrize("err", [
    api_error(401, "Request had invalid authentication credentials.", "UNAUTHENTICATED"),
    api_error(403, "Permission denied.", "PERMISSION_DENIED"),
    api_error(400, "API key not valid. Please pass a valid API key.", "INVALID_ARGUMENT"),
])
def test_key_problem_stops(err):
    client = FakeClient({"m1": [err], "m2": ['{"ok": 2}']})
    with pytest.raises(KeyProblem, match="GEMINI_API_KEY") as exc:
        run(client)
    assert "test-key" not in str(exc.value)
    assert [c[0] for c in client.calls] == ["m1"]


def test_invalid_json_then_success_on_same_model():
    client = FakeClient({"m1": ["not json", '{"ok": 1}']})
    res, waits = run(client)
    assert res.model == "m1" and waits == []
    assert [a["outcome"] for a in res.result["_meta"]["attempts"]] == ["invalid_json", "ok"]


def test_all_models_fail_falls_back_to_cache_without_leaking_key():
    client = FakeClient({"m1": ["bad", "bad"], "m2": [busy(), RuntimeError("network down for test-key")]},
                        listed=[])
    res, waits = run(client)
    assert res.source == "cache" and res.result == {"old": True}
    text = " ".join(res.warnings)
    assert "No model returned a valid result" in text and "m1 invalid_json x2" in text and "m2 busy, error" in text
    assert "CACHED" in text and "test-key" not in text


def test_falls_back_to_latest_good_run(tmp_path):
    runs = tmp_path / "runs"
    save_run(gc.AnalysisResult(result={"from": "run"}, warnings=[], source="gemini", model="m"), [], runs_dir=runs)
    client = FakeClient({"m1": ["bad", "bad"], "m2": ["bad", "bad"]})
    res, _ = run(client, tmp_runs=runs)
    assert res.source == "cache" and res.result == {"from": "run"}


def test_progress_and_stop_hooks():
    events = []
    client = FakeClient({"m1": [busy(), '{"ok": 1}']})
    res = analyze("msg", settings=SETTINGS, client=client, runs_dir=gc.Path("nonexistent-runs"), sleep=lambda s: None,
                  clock=FakeClock(), on_progress=lambda m, a, o: events.append((m, a, o)))
    assert res.source == "gemini"
    assert events == [("m1", 1, None), ("m1", 1, "busy"), ("m1", 2, None), ("m1", 2, "ok")]
    stop = {"now": False}

    def sleep(_):
        stop["now"] = True  # cancelled during the busy wait

    client = FakeClient({"m1": [busy(), '{"ok": 1}']})
    with pytest.raises(Cancelled):
        analyze("msg", settings=SETTINGS, client=client, runs_dir=gc.Path("nonexistent-runs"), sleep=sleep,
                clock=FakeClock(), should_stop=lambda: stop["now"])
    assert len(client.calls) == 1


def test_demo_result_may_be_a_copied_run_file(tmp_path, monkeypatch):
    demo = tmp_path / "demo_result.json"
    save_run(gc.AnalysisResult(result={"from": "demo"}, warnings=[], source="gemini", model="m"), [], runs_dir=tmp_path)
    next(tmp_path.glob("2*.json")).rename(demo)
    monkeypatch.setattr(gc, "DEMO_RESULT", demo)
    result, path, _ = gc.load_cached(tmp_path / "no-runs")
    assert result == {"from": "demo"} and path == str(demo)


def test_time_budget_stops_early():
    clock = FakeClock()
    client = FakeClient({"m1": [busy(), busy()], "m2": [busy(), busy()]}, clock=clock, call_seconds=200)
    res, waits = run(client, clock=clock)
    assert res.source == "cache"
    assert "Time budget" in " ".join(res.warnings)
    assert len(client.calls) < 4
    # the second call's timeout was cut to the remaining budget
    assert client.calls[-1][1].http_options.timeout < 300_000


# ---------- discovery ----------

LISTED = [
    ("gemini-2.5-flash-lite", ["generateContent"]),
    ("gemini-2.5-pro", ["generateContent"]),
    ("gemini-2.0-flash", ["generateContent"]),
    ("gemini-2.5-flash-preview-09-2025", ["generateContent"]),
    ("gemini-2.5-flash", ["generateContent"]),
    ("gemini-flash-latest", ["generateContent"]),
    ("gemini-2.0-flash-exp", ["generateContent"]),
    ("gemini-2.5-flash-image", ["generateContent"]),
    ("gemini-2.5-flash-preview-tts", ["generateContent"]),
    ("gemini-embedding-001", ["embedContent"]),
    ("gemini-2.5-flash-native-audio", ["generateContent"]),
    ("gemini-live-2.5-flash", ["generateContent"]),
    ("gemma-3-27b-it", ["generateContent"]),
    ("imagen-4.0-generate", ["predict"]),
    ("veo-3.0-generate", ["predictLongRunning"]),
    ("aqa", ["generateAnswer"]),
    ("gemini-2.5-pro-no-actions", None),
]


def test_discovery_filter_and_order():
    client = FakeClient({}, listed=LISTED)
    names = [n for n, origin in candidate_models(Settings(api_key="k"), client)]
    assert names == [
        "gemini-flash-latest",
        "gemini-2.5-flash",
        "gemini-2.0-flash",
        "gemini-2.5-flash-preview-09-2025",
        "gemini-2.0-flash-exp",
        "gemini-2.5-pro",
        "gemini-2.5-flash-lite",
    ]


def test_env_models_first_deduped_and_discovery_cached():
    client = FakeClient({}, listed=LISTED)
    s = Settings(api_key="k", model="gemini-2.5-pro", fallback_models=["models/gemini-2.0-flash", "gemini-2.5-pro"])
    models = candidate_models(s, client)
    assert models[:3] == [("gemini-2.5-pro", "env"), ("gemini-2.0-flash", "env_fallback"),
                          ("gemini-flash-latest", "discovered")]
    assert len({n for n, _ in models}) == len(models)
    candidate_models(s, client)
    assert client.list_calls == 1


def test_discovery_only_when_env_models_fail():
    client = FakeClient({"m1": ['{"ok": 1}']}, listed=LISTED)
    run(client)
    assert client.list_calls == 0


def test_discovered_model_used_after_env_models():
    client = FakeClient({"m1": [api_error(404, "not found")], "m2": [api_error(404, "not found")],
                         "gemini-flash-latest": ['{"ok": 3}']}, listed=LISTED)
    res, _ = run(client)
    assert res.model == "gemini-flash-latest"


def test_usable_and_sort_key_helpers():
    assert is_usable("gemini-2.5-flash", ["generateContent"])
    assert not is_usable("gemini-2.5-flash", ["countTokens"])
    assert not is_usable("gemini-2.5-flash-preview-tts", ["generateContent"])
    assert sort_key("gemini-2.5-flash") < sort_key("gemini-2.5-pro") < sort_key("gemini-2.5-flash-lite")
    assert not is_usable("gemini-robotics-er-2-preview", ["generateContent"])
    assert not is_usable("gemini-2.5-computer-use-preview-10-2025", ["generateContent"])
    # a version number that is not right after "gemini-" still counts; only -latest aliases go first
    order = sorted(["gemini-omni-1.1-flash", "gemini-3.8-flash", "gemini-flash-latest", "gemini-2.5-flash"], key=sort_key)
    assert order == ["gemini-flash-latest", "gemini-3.8-flash", "gemini-2.5-flash", "gemini-omni-1.1-flash"]
