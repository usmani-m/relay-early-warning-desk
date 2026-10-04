from backend.categories import ALL_CATEGORIES
from backend.inputs_sync import sync_inputs
from backend.storage import DATA, load_config, load_inputs, read_json

DEMO = DATA / "demo"


def demo():
    config = load_config(DEMO / "config.json")
    cards = load_inputs(DEMO / "inputs.json")
    return config, cards, {c.id: c for c in cards}


def test_demo_files_validate_and_are_in_sync():
    config, cards, _ = demo()
    assert [c.model_dump() for c in sync_inputs(config, cards)] == [c.model_dump() for c in cards]
    assert config.dependencies_are_examples is True


def test_dataset_names_exact():
    config, cards, _ = demo()
    assert set(config.active_datasets) <= set(ALL_CATEGORIES)
    assert {c.dataset for c in cards} <= set(ALL_CATEGORIES)


ILLUSTRATIVE_IDS = [
    "D|AMER|Infrastructure|Project pipelines & permitting",
    "S|APAC|Lead times & allocations",
    "S|APAC|Pricing & cost indices",
    "S|APAC|Raw material & chemicals",
    "S|GLOBAL|Lead times & allocations",
    "S|GLOBAL|Pricing & cost indices",
    "S|GLOBAL|Raw material & chemicals",
]


def test_only_the_expected_inputs_are_illustrative():
    _, cards, _ = demo()
    assert sorted(c.id for c in cards if c.is_illustrative) == ILLUSTRATIVE_IDS


def test_illustrative_examples_are_marked_and_unsourced():
    _, _, ids = demo()
    for cid in ILLUSTRATIVE_IDS:
        c = ids[cid]
        assert c.level is not None and not c.source_url, cid
        assert "ILLUSTRATIVE" in c.evidence_note, cid
    assert (ids["S|APAC|Lead times & allocations"].level, ids["S|APAC|Lead times & allocations"].confidence) == (-2, "medium")
    amer = ids["D|AMER|Infrastructure|Project pipelines & permitting"]
    assert (amer.level, amer.confidence) == (1, "low")


def test_no_invented_sources():
    _, cards, _ = demo()
    real_urls = {s["url"] for s in read_json(DATA / "signals.json") if s["url"]}
    for c in cards:
        if c.source_url:
            assert c.source_url in real_urls, c.id
        if c.level is not None:
            assert c.evidence_note, c.id  # every value has its evidence
        else:
            assert not c.source_url and not c.evidence_note, c.id


def test_sourced_data_is_europe_demand_and_global_supply_only():
    _, cards, _ = demo()
    with_data = [c for c in cards if c.level is not None]
    assert len(with_data) == 15
    sourced = [c for c in with_data if c.id not in ILLUSTRATIVE_IDS]
    assert len(sourced) == 8
    assert all(c.side == "demand" and c.region == "EUROPE" for c in sourced)


def test_converted_levels():
    _, _, ids = demo()
    expect = {
        "D|EUROPE|Infrastructure|Project pipelines & permitting": (2, "high"),  # S3 +75, S4 +50
        "D|EUROPE|Industry|Project pipelines & permitting": (-2, "high"),  # S5 -50
        "D|EUROPE|Utilities|Project pipelines & permitting": (None, "medium"),  # no source
        "D|EUROPE|Infrastructure|Market & policy development": (2, "high"),  # S2, segment All
        "D|EUROPE|Industry|Market & policy development": (2, "high"),
        "D|EUROPE|Utilities|Grid plans & investments": (2, "low"),  # S1 +50 low
        "D|EUROPE|Infrastructure|Grid plans & investments": (0, "medium"),  # S1 +2 low with S6 -1 medium
        "S|GLOBAL|Lead times & allocations": (-2, "medium"),  # S7 -50
        "S|GLOBAL|Pricing & cost indices": (-1, "medium"),  # S8 -25
        "S|GLOBAL|Raw material & chemicals": (-2, "medium"),  # S9 -50
    }
    for cid, (level, confidence) in expect.items():
        assert (ids[cid].level, ids[cid].confidence) == (level, confidence), cid


def test_combined_card_names_both_signals():
    _, _, ids = demo()
    note = ids["D|EUROPE|Infrastructure|Grid plans & investments"].evidence_note
    assert "S1" in note and "S6" in note and "Combined" in note


def test_dependency_rows_valid():
    config, _, _ = demo()
    for r in config.regions:
        assert 0 <= config.own_share(r) <= 1
