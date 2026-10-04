import json
import re

from backend.message_builder import build_user_message, no_data_lines
from backend.inputs_sync import sync_inputs
from backend.models import Config, Decision
from backend.storage import DATA, load_config, load_inputs

BLOCKS = ["context", "inputs", "global_baseline", "dependencies", "feedback", "policy"]


def blocks(message: str) -> dict:
    return {tag: body for tag, body in re.findall(r"<(\w+)>\n(.*?)\n</\1>", message, re.DOTALL)}


def demo_message(decisions=()):
    config = load_config(DATA / "demo" / "config.json")
    cards = load_inputs(DATA / "demo" / "inputs.json")
    return config, cards, build_user_message(config, cards, list(decisions), today="2026-10-04", focus="F", notes="N")


def test_blocks_in_order():
    _, _, msg = demo_message()
    assert re.findall(r"^<(\w+)>$", msg, re.MULTILINE) == BLOCKS


def test_context():
    config, _, msg = demo_message()
    ctx = json.loads(blocks(msg)["context"])
    assert (ctx["today"], ctx["focus"], ctx["notes"]) == ("2026-10-04", "F", "N")
    assert ctx["regions"] == config.regions and ctx["segments"] == config.segments
    assert [d["name"] for d in ctx["active_datasets"]] == config.active_datasets


def test_only_regional_cards_with_values_in_inputs():
    _, cards, msg = demo_message()
    sent = json.loads(blocks(msg)["inputs"])["cards"]
    expected = {c.id for c in cards if c.level is not None and c.region != "GLOBAL"}
    assert {c["id"] for c in sent} == expected
    assert all(c["level"] is not None and c["region"] != "GLOBAL" for c in sent)
    amer = next(c for c in sent if c["id"] == "D|AMER|Infrastructure|Project pipelines & permitting")
    assert amer["is_illustrative"] is True and amer["confidence"] == "low"


def test_global_cards_only_in_global_baseline():
    _, _, msg = demo_message()
    glob = json.loads(blocks(msg)["global_baseline"])
    assert {c["id"] for c in glob["cards"]} == {
        "S|GLOBAL|Lead times & allocations", "S|GLOBAL|Pricing & cost indices", "S|GLOBAL|Raw material & chemicals"}
    assert "GLOBAL demand Infrastructure: all active categories" in glob["no_data"]


def test_empty_cards_are_summarised_not_listed():
    _, cards, msg = demo_message()
    for c in cards:
        if c.level is None:
            assert c.id not in msg
    no_data = json.loads(blocks(msg)["inputs"])["no_data"]
    assert "AMER demand Utilities: all active categories" in no_data
    assert "MEA supply: all active categories" in no_data
    assert "EUROPE demand Utilities: Project pipelines & permitting" in no_data
    assert "AMER demand Infrastructure: Grid plans & investments; Market & policy development" in no_data
    assert not any(line.startswith("APAC supply") for line in no_data)


def test_dormant_categories_not_sent():
    config, cards, _ = demo_message()
    data = config.model_dump()
    data["active_datasets"] = ["Market & policy development", "Lead times & allocations"]
    narrow = Config.model_validate(data)
    msg = build_user_message(narrow, sync_inputs(narrow, cards), [], today="2026-10-04")
    assert "Project pipelines & permitting" not in msg
    assert "Pricing & cost indices" not in msg


def test_dependencies_include_own_share():
    _, _, msg = demo_message()
    deps = json.loads(blocks(msg)["dependencies"])
    assert deps["supply_dependency"]["EUROPE"] == {"own_share": 0.4, "from": {"APAC": 0.5, "AMER": 0.1}}
    assert deps["supply_dependency"]["APAC"]["own_share"] == 0.9
    assert deps["dependencies_are_examples"] is True and deps["pool_pressure_factor"] == 0.5


def test_feedback_and_policy():
    _, _, msg = demo_message()
    assert blocks(msg)["feedback"] == "none yet"
    assert json.loads(blocks(msg)["policy"])["objective_weights_percent"]["profitability"] == 30
    d = Decision(as_of="2026-09-01", region="EUROPE", segment="Utilities", recommendation="buy", decision="rejected", note="x")
    _, _, msg = demo_message([d])
    assert json.loads(blocks(msg)["feedback"])[0]["decision"] == "rejected"


def test_no_data_lines_full_region():
    config = Config()
    cards = sync_inputs(config, [])
    lines = no_data_lines(config, cards, "MEA")
    assert lines == [f"MEA demand {s}: all active categories" for s in config.segments] + ["MEA supply: all active categories"]
