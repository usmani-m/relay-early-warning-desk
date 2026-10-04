import pytest
from pydantic import ValidationError

from backend.categories import ALL_CATEGORIES, DEMAND_CATEGORIES, SUPPLY_CATEGORIES
from backend.models import Config, InputCard, PolicyWeights


def test_defaults_are_valid():
    c = Config()
    assert c.regions == ["EUROPE", "AMER", "APAC", "MEA"]
    assert c.segments == ["Infrastructure", "Utilities", "Industry"]
    assert c.pool_pressure_factor == 0.5
    assert c.policy_weights.model_dump() == {"profitability": 30, "customer_value": 25, "growth": 25, "resilience": 20}


def test_sixteen_categories():
    assert len(DEMAND_CATEGORIES) == 8 and len(SUPPLY_CATEGORIES) == 8 and len(set(ALL_CATEGORIES)) == 16


def test_own_share():
    c = Config(supply_dependency={"EUROPE": {"APAC": 0.5, "AMER": 0.1}})
    assert c.own_share("EUROPE") == pytest.approx(0.4)
    assert c.own_share("MEA") == 1


@pytest.mark.parametrize(
    "kwargs, message",
    [
        ({"supply_dependency": {"EUROPE": {"APAC": 0.7, "AMER": 0.4}}}, "1 or less"),
        ({"supply_dependency": {"EUROPE": {"EUROPE": 0.2}}}, "itself"),
        ({"supply_dependency": {"EUROPE": {"MARS": 0.2}}}, "unknown region"),
        ({"supply_dependency": {"EUROPE": {"APAC": 1.5}}}, "between 0 and 1"),
        ({"demand_competition": {"EUROPE": 1.2}}, "between 0 and 1"),
        ({"pool_pressure_factor": -0.1}, "negative"),
        ({"regions": ["EUROPE", "GLOBAL"]}, "reserved"),
        ({"regions": ["EUROPE", "europe"]}, "unique"),
        ({"regions": []}, "at least one"),
        ({"segments": ["Industry", " "]}, "empty"),
        ({"active_datasets": ["Market & policy development", "Grid plans & investments",
                              "Project pipelines & permitting", "Industry & macro economics",
                              "Lead times & allocations"]}, "Up to 3 demand"),
        ({"active_datasets": ["Market & policy development"]}, "at least one supply"),
        ({"active_datasets": ["Market and policy development", "Lead times & allocations"]}, "Unknown data category"),
    ],
)
def test_config_rejects(kwargs, message):
    with pytest.raises(ValidationError, match=message):
        Config(**kwargs)


def test_weights_must_sum_to_100():
    with pytest.raises(ValidationError, match="sum to 100"):
        PolicyWeights(profitability=30, customer_value=30, growth=30, resilience=20)
    PolicyWeights(profitability=20, customer_value=35, growth=15, resilience=30)


def card(**kw):
    base = dict(id="x", side="demand", dataset="Grid plans & investments", region="EUROPE", segment="Industry")
    base.update(kw)
    return InputCard(**base)


def test_card_defaults_to_no_data():
    c = card()
    assert c.level is None and c.confidence == "medium" and c.is_illustrative is False


@pytest.mark.parametrize(
    "kw, message",
    [
        ({"level": 4}, "less than or equal to 3"),
        ({"level": -4}, "greater than or equal to -3"),
        ({"confidence": "very high"}, "low"),
        ({"side": "supply", "dataset": "Lead times & allocations", "segment": "Industry"}, "no segment"),
        ({"segment": None}, "need a segment"),
        ({"dataset": "Lead times & allocations"}, "supply-side category"),
        ({"dataset": "Grid plans and investments"}, "unknown data category"),
        ({"source_url": "www.example.com"}, "https://"),
    ],
)
def test_card_rejects(kw, message):
    with pytest.raises(ValidationError, match=message):
        card(**kw)
