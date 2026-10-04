"""API tests with FastAPI TestClient and the fake Gemini client. No real API calls."""

import json
import shutil
import threading
import time

import pytest
from fastapi.testclient import TestClient

from backend.gemini_client import Settings, SettingsError
from backend.main import create_app
from backend.storage import DATA
from tests.fakes import FakeClient, busy

SECRET = "secret-test-key-123"
SETTINGS = Settings(api_key=SECRET, model="m1")
GOOD = json.dumps({"executive_briefing": "fake run"})


@pytest.fixture
def data_dir(tmp_path):
    d = tmp_path / "data"
    (d / "demo").mkdir(parents=True)
    for name in ("config.json", "inputs.json"):
        shutil.copyfile(DATA / "demo" / name, d / name)
        shutil.copyfile(DATA / "demo" / name, d / "demo" / name)
    (d / "demo" / "demo_result.json").write_text(
        json.dumps({"saved_at": "2026-10-04T02:49:36", "model": "demo-model", "source": "gemini", "warnings": [],
                    "result": {"executive_briefing": "demo", "_meta": {"model": "demo-model"}}}), encoding="utf-8")
    (d / "decisions.json").write_text("[]", encoding="utf-8")
    env = tmp_path / ".env"
    env.write_text(f"GEMINI_API_KEY={SECRET}\nGEMINI_MODEL=m1\n", encoding="utf-8")
    return d


def make(data_dir, replies=None, gate=None, settings_loader=None):
    fake = FakeClient(replies or {"m1": [GOOD]}, gate=gate)
    app = create_app(data_dir=data_dir, settings_loader=settings_loader or (lambda: SETTINGS),
                     client_factory=lambda s: fake, env_path=data_dir.parent / ".env")
    return TestClient(app), fake


def wait_done(client, job_id, timeout=5.0):
    end = time.monotonic() + timeout
    while time.monotonic() < end:
        body = client.get(f"/api/analyze/{job_id}").json()
        if body["state"] != "running":
            return body
        time.sleep(0.02)
    raise AssertionError("job did not finish")


# ---------- health, categories ----------

def test_health_reports_booleans_only(data_dir):
    client, _ = make(data_dir)
    r = client.get("/api/health")
    assert r.json() == {"status": "ok", "env_file": True, "has_key": True, "has_model": True, "job_running": False}
    assert SECRET not in r.text


def test_health_without_env(data_dir):
    (data_dir.parent / ".env").unlink()
    client, _ = make(data_dir)
    body = client.get("/api/health").json()
    assert (body["env_file"], body["has_key"], body["has_model"]) == (False, False, False)


def test_categories(data_dir):
    client, _ = make(data_dir)
    body = client.get("/api/categories").json()
    assert len(body["demand"]) == 8 and len(body["supply"]) == 8 and body["max_active_per_side"] == 3
    assert {c["name"] for c in body["demand"] if c["abb_internal"]} == {"Customer forecasts & RFQs", "Order intake & backlog"}


def test_cors_for_frontend(data_dir):
    client, _ = make(data_dir)
    r = client.options("/api/config", headers={"Origin": "http://localhost:5173", "Access-Control-Request-Method": "PUT"})
    assert r.headers["access-control-allow-origin"] == "http://localhost:5173"


# ---------- config ----------

def test_put_config_adds_region_and_syncs_cards(data_dir):
    client, _ = make(data_dir)
    config = client.get("/api/config").json()
    config["regions"].append("NORDICS")
    r = client.put("/api/config", json=config)
    assert r.status_code == 200
    assert r.json()["inputs_added"] == 3 * 3 + 3  # 3 segments x 3 demand categories + 3 supply cards
    ids = {c["id"] for c in client.get("/api/inputs").json()}
    assert "S|NORDICS|Lead times & allocations" in ids


@pytest.mark.parametrize("change, message", [
    (lambda c: c["supply_dependency"]["EUROPE"].update({"APAC": 0.95}), "1 or less"),
    (lambda c: c["regions"].append("GLOBAL"), "reserved"),
    (lambda c: c["active_datasets"].append("Industry & macro economics"), "Up to 3"),
])
def test_put_config_validation_errors(data_dir, change, message):
    client, _ = make(data_dir)
    config = client.get("/api/config").json()
    change(config)
    r = client.put("/api/config", json=config)
    assert r.status_code == 422
    assert any(message in m for m in r.json()["detail"]), r.json()
    assert client.get("/api/config").json() != config  # nothing saved


def test_rename_region_keeps_values(data_dir):
    client, _ = make(data_dir)
    r = client.post("/api/config/rename", json={"kind": "region", "old": "EUROPE", "new": "EU"})
    assert r.status_code == 200 and "EU" in r.json()["config"]["regions"]
    cards = {c["id"]: c for c in client.get("/api/inputs").json()}
    assert cards["D|EU|Infrastructure|Market & policy development"]["level"] == 2
    assert "EU" in client.get("/api/config").json()["supply_dependency"]
    bad = client.post("/api/config/rename", json={"kind": "region", "old": "NOPE", "new": "X"})
    assert bad.status_code == 422 and "Unknown region" in bad.json()["detail"][0]


# ---------- inputs ----------

def test_put_inputs_persists_level(data_dir):
    client, _ = make(data_dir)
    cards = client.get("/api/inputs").json()
    target = next(c for c in cards if c["id"] == "S|MEA|Lead times & allocations")
    target.update(level=-1, confidence="low", evidence_note="test")
    r = client.put("/api/inputs", json=cards)
    assert r.status_code == 200
    saved = {c["id"]: c for c in client.get("/api/inputs").json()}
    assert saved["S|MEA|Lead times & allocations"]["level"] == -1


def test_put_inputs_rejects_unknown_region_bad_level_and_duplicates(data_dir):
    client, _ = make(data_dir)
    cards = client.get("/api/inputs").json()
    bad_region = [*cards, {**cards[0], "id": "x", "region": "MARS"}]
    r = client.put("/api/inputs", json=bad_region)
    assert r.status_code == 422 and "unknown region 'MARS'" in r.json()["detail"][0]
    bad_level = [{**cards[0], "level": 5}, *cards[1:]]
    r = client.put("/api/inputs", json=bad_level)
    assert r.status_code == 422 and "less than or equal to 3" in r.json()["detail"][0]
    r = client.put("/api/inputs", json=[*cards, cards[0]])
    assert r.status_code == 422 and "appears twice" in r.json()["detail"][0]


def test_demo_reset_restores_files(data_dir):
    client, _ = make(data_dir)
    config = client.get("/api/config").json()
    config["regions"].append("NORDICS")
    client.put("/api/config", json=config)
    r = client.post("/api/demo/reset")
    assert r.status_code == 200 and "NORDICS" not in r.json()["config"]["regions"] and r.json()["inputs"] == 60


# ---------- analysis jobs ----------

def test_job_flow_success_saves_run(data_dir):
    client, fake = make(data_dir)
    r = client.post("/api/analyze", json={"today": "2026-10-04", "focus": "F"})
    assert r.status_code == 200
    body = wait_done(client, r.json()["job_id"])
    assert body["state"] == "done" and body["source"] == "gemini"
    assert body["result"]["executive_briefing"] == "fake run" and body["meta"]["model"] == "m1"
    assert body["progress"]["model"] == "m1" and body["progress"]["last_outcome"] == "ok"
    assert body["run_id"] and any("Missing top-level keys" in w for w in body["warnings"])
    latest = client.get("/api/results/latest").json()
    assert latest["run_id"] == body["run_id"] and latest["model"] == "m1" and latest["source"] == "gemini"
    listed = client.get("/api/results").json()
    assert listed[0]["run_id"] == body["run_id"]
    assert client.get(f"/api/results/{body['run_id']}").json()["result"]["executive_briefing"] == "fake run"
    assert "<context>" in fake.calls[0][2] and '"today": "2026-10-04"' in fake.calls[0][2]
    assert SECRET not in json.dumps(body)


def test_only_one_job_at_a_time_and_cancel(data_dir):
    gate = threading.Event()
    client, fake = make(data_dir, gate=gate)
    first = client.post("/api/analyze", json={}).json()
    assert fake.started.wait(2)
    second = client.post("/api/analyze", json={}).json()
    assert second["job_id"] == first["job_id"] and second["already_running"] is True
    assert client.get("/api/health").json()["job_running"] is True
    assert client.post("/api/demo/reset").status_code == 409
    r = client.post(f"/api/analyze/{first['job_id']}/cancel")
    assert r.json()["state"] == "cancelled"
    gate.set()  # the in-flight call returns late; its result must be discarded
    time.sleep(0.2)
    body = client.get(f"/api/analyze/{first['job_id']}").json()
    assert body["state"] == "cancelled" and body["result"] is None
    assert client.get("/api/results").json() == []
    assert client.post(f"/api/analyze/{first['job_id']}/cancel").status_code == 409


def test_cancel_during_busy_wait_is_immediate(data_dir):
    client, fake = make(data_dir, replies={"m1": [busy(), GOOD]})
    job = client.post("/api/analyze", json={}).json()
    end = time.monotonic() + 2
    while client.get(f"/api/analyze/{job['job_id']}").json()["progress"]["last_outcome"] != "busy":
        assert time.monotonic() < end
        time.sleep(0.01)
    t0 = time.monotonic()
    client.post(f"/api/analyze/{job['job_id']}/cancel")
    time.sleep(0.2)
    assert len(fake.calls) == 1  # the retry after the 10 s wait never happened
    assert time.monotonic() - t0 < 2


def test_use_cache_returns_demo_immediately(data_dir):
    client, fake = make(data_dir)
    r = client.post("/api/analyze", json={"use_cache": True}).json()
    assert r["state"] == "done"
    body = client.get(f"/api/analyze/{r['job_id']}").json()
    assert body["source"] == "cache" and body["result"]["executive_briefing"] == "demo"
    assert body["meta"]["model"] == "demo-model" and fake.calls == []
    demo = client.get("/api/results/demo").json()
    assert demo["source"] == "cache" and demo["model"] == "demo-model" and demo["result"]["executive_briefing"] == "demo"


def test_settings_error_fails_job(data_dir):
    def loader():
        raise SettingsError("GEMINI_API_KEY is missing. Add this line to .env: GEMINI_API_KEY=<your key>")

    client, _ = make(data_dir, settings_loader=loader)
    job = client.post("/api/analyze", json={}).json()
    body = wait_done(client, job["job_id"])
    assert body["state"] == "failed" and "GEMINI_API_KEY=" in body["error"]


def test_all_models_fail_gives_cache(data_dir):
    client, _ = make(data_dir, replies={"m1": ["bad", "bad"]})
    body = wait_done(client, client.post("/api/analyze", json={}).json()["job_id"])
    assert body["state"] == "done" and body["source"] == "cache" and body["result"]["executive_briefing"] == "demo"
    assert body["run_id"] is None and client.get("/api/results").json() == []


def test_unknown_job_and_bad_run_id(data_dir):
    client, _ = make(data_dir)
    assert client.get("/api/analyze/nope").status_code == 404
    assert client.get("/api/results/latest").status_code == 404
    assert client.get("/api/results/..%2F..%2Fsecrets").status_code in (404, 422)
    assert client.get("/api/results/not-a-run").status_code == 422
    assert client.get("/api/results/20260101-000000").status_code == 404


# ---------- decisions ----------

def test_decisions_feed_next_run(data_dir):
    client, fake = make(data_dir)
    d = {"as_of": "2026-10-04", "region": "EUROPE", "segment": "Utilities",
         "recommendation": "flexible_commitment", "decision": "adjusted", "note": "smaller volume"}
    r = client.post("/api/decisions", json=d)
    assert r.status_code == 200 and r.json() == [d]
    assert client.get("/api/decisions").json() == [d]
    wait_done(client, client.post("/api/analyze", json={}).json()["job_id"])
    message = fake.calls[0][2]
    feedback = message.split("<feedback>")[1].split("</feedback>")[0]
    assert "smaller volume" in feedback and "adjusted" in feedback


def test_invalid_decision(data_dir):
    client, _ = make(data_dir)
    r = client.post("/api/decisions", json={"as_of": "2026-10-04", "region": "EUROPE", "segment": "Utilities",
                                            "recommendation": "x", "decision": "maybe"})
    assert r.status_code == 422 and "decision" in r.json()["detail"][0]


# ---------- Phase 5 additions ----------

def test_policy_weights_patch_only_weights(data_dir):
    client, _ = make(data_dir)
    before = client.get("/api/config").json()
    r = client.put("/api/policy-weights", json={"profitability": 20, "customer_value": 35, "growth": 15, "resilience": 30})
    assert r.status_code == 200
    after = client.get("/api/config").json()
    assert after["policy_weights"] == {"profitability": 20, "customer_value": 35, "growth": 15, "resilience": 30}
    assert {k: v for k, v in after.items() if k != "policy_weights"} == {k: v for k, v in before.items() if k != "policy_weights"}
    bad = client.put("/api/policy-weights", json={"profitability": 50, "customer_value": 35, "growth": 15, "resilience": 30})
    assert bad.status_code == 422 and "sum to 100" in bad.json()["detail"][0]


def test_decision_upsert_replaces_same_recommendation(data_dir):
    client, _ = make(data_dir)
    base = {"as_of": "2026-10-04", "region": "EUROPE", "segment": "Utilities", "recommendation": "flexible_commitment"}
    client.post("/api/decisions", json={**base, "decision": "approved", "note": ""})
    other = {**base, "segment": "Infrastructure", "decision": "rejected", "note": "x"}
    client.post("/api/decisions", json=other)
    r = client.post("/api/decisions", json={**base, "decision": "adjusted", "note": "smaller"})
    decisions = r.json()
    assert len(decisions) == 2
    assert [d["decision"] for d in decisions if d["segment"] == "Utilities"] == ["adjusted"]


def test_inputs_snapshot_saved_with_run_and_returned(data_dir):
    client, _ = make(data_dir)
    body = wait_done(client, client.post("/api/analyze", json={}).json()["job_id"])
    assert body["inputs"] and all(c["level"] is not None for c in body["inputs"])
    assert len(body["inputs"]) == 15  # the demo cards with a value in active categories
    run_file = json.loads((data_dir / "runs" / f"{body['run_id']}.json").read_text(encoding="utf-8"))
    assert len(run_file["inputs"]) == 15
    assert len(client.get("/api/results/latest").json()["inputs"]) == 15
    # later edits to the working inputs don't change the snapshot
    cards = client.get("/api/inputs").json()
    for c in cards:
        c["level"] = None
    client.put("/api/inputs", json=cards)
    assert len(client.get(f"/api/results/{body['run_id']}").json()["inputs"]) == 15


def test_demo_and_cache_results_carry_demo_inputs(data_dir):
    client, _ = make(data_dir, replies={"m1": ["bad", "bad"]})
    demo = client.get("/api/results/demo").json()
    assert len(demo["inputs"]) == 15
    job = client.post("/api/analyze", json={"use_cache": True}).json()
    assert len(client.get(f"/api/analyze/{job['job_id']}").json()["inputs"]) == 15
    fallback = wait_done(client, client.post("/api/analyze", json={}).json()["job_id"])
    assert fallback["source"] == "cache" and len(fallback["inputs"]) == 15


def test_older_run_without_snapshot_returns_none(data_dir):
    client, _ = make(data_dir)
    (data_dir / "runs").mkdir()
    (data_dir / "runs" / "20260101-000000.json").write_text(
        json.dumps({"saved_at": "2026-01-01T00:00:00", "model": "m", "source": "gemini", "warnings": [], "result": {"a": 1}}),
        encoding="utf-8")
    assert client.get("/api/results/20260101-000000").json()["inputs"] is None
