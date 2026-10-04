from backend.inputs_sync import (
    active_cards,
    card_id,
    delete_region,
    delete_segment,
    rename_region,
    rename_segment,
    sync_inputs,
)
from backend.models import Config

DEP = {"EUROPE": {"APAC": 0.5, "AMER": 0.1}, "MEA": {"EUROPE": 0.4}}
COMP = {"EUROPE": 0.6, "AMER": 0.5}


def setup():
    config = Config(supply_dependency=DEP, demand_competition=COMP)
    return config, sync_inputs(config, [])


def by_id(cards):
    return {c.id: c for c in cards}


def set_level(cards, cid, level):
    return [c.model_copy(update={"level": level, "confidence": "high"}) if c.id == cid else c for c in cards]


def test_default_card_count():
    _, cards = setup()
    demand = [c for c in cards if c.side == "demand"]
    supply = [c for c in cards if c.side == "supply"]
    assert len([c for c in demand if c.region != "GLOBAL"]) == 36
    assert len([c for c in supply if c.region != "GLOBAL"]) == 12
    assert len([c for c in demand if c.region == "GLOBAL"]) == 9
    assert len([c for c in supply if c.region == "GLOBAL"]) == 3
    assert len(cards) == 60
    assert all(c.level is None for c in cards)
    assert len(by_id(cards)) == 60  # ids unique


def test_card_ids():
    assert card_id("demand", "EUROPE", "Industry", "Grid plans & investments") == "D|EUROPE|Industry|Grid plans & investments"
    assert card_id("supply", "GLOBAL", None, "Lead times & allocations") == "S|GLOBAL|Lead times & allocations"


def test_resync_keeps_values():
    config, cards = setup()
    cid = card_id("demand", "EUROPE", "Industry", "Grid plans & investments")
    cards = set_level(cards, cid, -2)
    again = sync_inputs(config, cards)
    assert by_id(again)[cid].level == -2 and by_id(again)[cid].confidence == "high"
    assert len(again) == 60


def test_add_segment_adds_only_new_cards():
    config, cards = setup()
    cid = card_id("demand", "AMER", "Utilities", "Market & policy development")
    cards = set_level(cards, cid, 1)
    bigger = Config(**{**config.model_dump(), "segments": config.segments + ["Marine"]})
    synced = sync_inputs(bigger, cards)
    assert len(synced) == 60 + 5 * 3  # (4 regions + GLOBAL) x 3 active demand categories
    assert by_id(synced)[cid].level == 1


def test_add_region_adds_demand_and_supply_cards():
    config, cards = setup()
    bigger = Config(**{**config.model_dump(), "regions": config.regions + ["LATAM"]})
    assert len(sync_inputs(bigger, cards)) == 60 + 9 + 3


def test_rename_region_keeps_values_and_keys():
    config, cards = setup()
    cid = card_id("supply", "EUROPE", None, "Lead times & allocations")
    cards = set_level(cards, cid, -3)
    new_config, new_cards = rename_region(config, cards, "EUROPE", "EMEA_N")
    assert new_config.regions[0] == "EMEA_N"
    assert new_config.supply_dependency["EMEA_N"] == {"APAC": 0.5, "AMER": 0.1}
    assert new_config.supply_dependency["MEA"] == {"EMEA_N": 0.4}
    assert new_config.demand_competition["EMEA_N"] == 0.6
    ids = by_id(new_cards)
    assert ids[card_id("supply", "EMEA_N", None, "Lead times & allocations")].level == -3
    assert not any(c.region == "EUROPE" for c in new_cards)
    assert len(new_cards) == 60


def test_rename_segment_keeps_values():
    config, cards = setup()
    cid = card_id("demand", "APAC", "Industry", "Grid plans & investments")
    cards = set_level(cards, cid, 3)
    new_config, new_cards = rename_segment(config, cards, "Industry", "Industrial")
    assert by_id(new_cards)[card_id("demand", "APAC", "Industrial", "Grid plans & investments")].level == 3
    assert "Industry" not in new_config.segments and len(new_cards) == 60


def test_delete_region_removes_cards_and_dependencies():
    config, cards = setup()
    new_config, new_cards = delete_region(config, cards, "EUROPE")
    assert "EUROPE" not in new_config.supply_dependency
    assert new_config.supply_dependency["MEA"] == {}
    assert "EUROPE" not in new_config.demand_competition
    assert not any(c.region == "EUROPE" for c in new_cards)
    assert len(new_cards) == 60 - 12


def test_delete_segment_removes_cards():
    config, cards = setup()
    new_config, new_cards = delete_segment(config, cards, "Utilities")
    assert not any(c.segment == "Utilities" for c in new_cards)
    assert len(new_cards) == 60 - 15


def test_dormant_cards_survive_category_toggle():
    config, cards = setup()
    cid = card_id("supply", "APAC", None, "Pricing & cost indices")
    cards = set_level(cards, cid, -1)
    swapped = [d for d in config.active_datasets if d != "Pricing & cost indices"] + ["Inventory & distributor data"]
    off = Config(**{**config.model_dump(), "active_datasets": swapped})
    synced = sync_inputs(off, cards)
    assert by_id(synced)[cid].level == -1  # kept dormant
    assert cid not in by_id(active_cards(off, synced))  # but not sent
    assert len(active_cards(off, synced)) == 60
    back = sync_inputs(config, synced)
    assert by_id(back)[cid].level == -1
    assert cid in by_id(active_cards(config, back))


def test_global_rows_come_first():
    _, cards = setup()
    demand = [c for c in cards if c.side == "demand"]
    assert all(c.region == "GLOBAL" for c in demand[:9])
