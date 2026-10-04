import copy

from backend.categories import DEMAND_CATEGORIES, SUPPLY_CATEGORIES
from backend.format_check import DECISION_AREAS, REQUIRED_KEYS, check_result, illustrative_feeding_matrix
from backend.storage import DATA, load_config, load_inputs


def valid_result() -> dict:
    r = {k: [] for k in REQUIRED_KEYS}
    r.update({
        "as_of_date": "2026-10-04",
        "executive_briefing": "x",
        "human_review_summary": "x",
        "ecosystem_data": {
            "demand_side": [{"dataset": d, "status": "no_data"} for d in DEMAND_CATEGORIES],
            "supply_side": [{"dataset": d, "status": "no_data"} for d in SUPPLY_CATEGORIES],
        },
        "illustrative_influence": {"any": False, "items": []},
        "capabilities": {"early_warnings": [{"level": "warning", "message": "x"}]},
        "input_assessment": [{"id": "S|GLOBAL|x", "level": -2}],
        "balance_matrix": [
            {"region": "EUROPE", "segment": "Industry", "demand_unrounded": 1.5, "demand": 2,
             "effective_supply": -2, "gap_unrounded": 2.04, "gap": 2, "status": "shortage_risk"},
            {"region": "MEA", "segment": "Industry", "demand": None, "effective_supply": -1, "gap": None,
             "status": "insufficient_data"},
        ],
        "supply_by_region": [{"region": "EUROPE", "own_supply": -1.67, "blended_supply": -1.83,
                              "pool_pressure": 0.25, "effective_supply_unrounded": -2.08, "effective_supply": -2}],
        "global_comparison": [{"region": "EUROPE", "region_level": 1, "global_level": -1, "difference": 2}],
        "action_evaluation": [{"score_surge": 1, "score_base": 2, "score_reversal": -1, "worst_case": -1}],
        "recommendations": [{"priority": 1, "region": "EUROPE", "segment": "Industry",
                             "requires_human_approval": True, "weighted_score": 1,
                             "objective_scores": {"profitability": 1, "customer_value": 2, "growth": 0, "resilience": 3}}],
        "decision_areas": [{"area": a, "questions": [{}, {}, {}]} for a in DECISION_AREAS],
        "optimisation_objectives": {"weights_used": "base",
                                    "weights": {"profitability": 30, "customer_value": 25, "growth": 25, "resilience": 20}},
    })
    return r


def test_valid_result_has_no_warnings():
    assert check_result(valid_result()) == []


def test_not_a_dict():
    assert "not a JSON object" in check_result([1, 2])[0]


def test_missing_keys():
    r = valid_result()
    del r["cross_region_effects"], r["global_comparison_commentary"]
    (w,) = check_result(r)
    assert "cross_region_effects" in w and "global_comparison_commentary" in w


def test_out_of_range_and_non_integer_scores():
    r = valid_result()
    r["balance_matrix"][0]["gap"] = 4
    r["recommendations"][0]["objective_scores"]["growth"] = -50
    r["action_evaluation"][0]["score_base"] = 1.5
    r["input_assessment"][0]["level"] = "high"  # a word is fine only for alert levels
    w = " ".join(check_result(r))
    assert "balance_matrix[0].gap = 4" in w
    assert "objective_scores.growth = -50" in w
    assert "score_base = 1.5" in w
    assert "input_assessment[0].level" not in w  # string levels are alert levels, skipped
    assert len(check_result(r)) == 3


def test_missing_category():
    r = valid_result()
    r["ecosystem_data"]["supply_side"].pop()
    (w,) = check_result(r)
    assert "1 of 16" in w and "Raw material & chemicals" in w


def test_decision_area_with_two_questions_and_missing_area():
    r = valid_result()
    r["decision_areas"][1]["questions"].pop()
    r["decision_areas"].pop()
    w = check_result(r)
    assert "Procurement has 2 questions" in w[0]
    assert "Investment & Strategy" in w[1]


def test_recommendation_without_approval():
    r = valid_result()
    r["recommendations"][0]["requires_human_approval"] = False
    assert check_result(r) == ["recommendations[0] does not require human approval."]


def test_one_recommendation_per_cell_with_large_gap():
    r = valid_result()
    r["balance_matrix"].append({"region": "AMER", "segment": "Infrastructure", "gap": -2, "status": "excess_risk"})
    r["balance_matrix"].append({"region": "AMER", "segment": "Utilities", "gap": 1, "status": "watch_shortage"})
    w = check_result(r)
    assert "1 recommendation(s) for 2 cell(s)" in w[0]
    assert "AMER Infrastructure" in w[1] and "AMER Utilities" not in w[1]
    r["recommendations"].append({"priority": 2, "region": "AMER", "segment": "Infrastructure",
                                 "requires_human_approval": True})
    assert check_result(r) == []


def test_recommendations_ordered_by_priority():
    r = valid_result()
    r["balance_matrix"].append({"region": "AMER", "segment": "Infrastructure", "gap": 3})
    r["recommendations"].insert(0, {"priority": 2, "region": "AMER", "segment": "Infrastructure",
                                    "requires_human_approval": True})
    assert check_result(r) == ["Recommendations are not ordered by priority."]


def test_no_large_gap_allows_single_monitor_recommendation():
    r = valid_result()
    r["balance_matrix"][0]["gap"] = 1
    assert check_result(r) == []


# ---------- checks that need the inputs ----------

def demo_inputs():
    return load_config(DATA / "demo" / "config.json"), load_inputs(DATA / "demo" / "inputs.json")


DEMO_ILLUSTRATIVE = {
    "D|AMER|Infrastructure|Project pipelines & permitting",
    "S|APAC|Lead times & allocations", "S|APAC|Pricing & cost indices", "S|APAC|Raw material & chemicals",
    "S|GLOBAL|Lead times & allocations", "S|GLOBAL|Pricing & cost indices", "S|GLOBAL|Raw material & chemicals",
}


def with_inputs_ok(config) -> dict:
    r = valid_result()
    r["illustrative_influence"] = {"any": True, "items": [{"card_id": c} for c in sorted(DEMO_ILLUSTRATIVE)]}
    r["cross_region_effects"] = [
        {"from_region": o, "to_region": reg, "channel": "supply_dependency"}
        for reg, row in config.supply_dependency.items() for o in row
    ]
    return r


def test_demo_illustrative_cards_feeding_matrix():
    config, cards = demo_inputs()
    # GLOBAL supply counts because EUROPE, AMER and MEA have no own supply and use the GLOBAL fallback
    assert illustrative_feeding_matrix(config, cards) == DEMO_ILLUSTRATIVE


def test_global_supply_not_counted_without_fallback():
    config, cards = demo_inputs()
    cards = [c.model_copy(update={"level": -1}) if c.side == "supply" and c.region in ("EUROPE", "AMER", "MEA")
             else c for c in cards]
    ids = illustrative_feeding_matrix(config, cards)
    assert not any(i.startswith("S|GLOBAL") for i in ids) and "S|APAC|Lead times & allocations" in ids


def test_inputs_checks_pass_on_complete_result():
    config, cards = demo_inputs()
    assert check_result(with_inputs_ok(config), config, cards) == []


def test_missing_illustrative_card_is_flagged():
    config, cards = demo_inputs()
    r = with_inputs_ok(config)
    r["illustrative_influence"]["items"] = [i for i in r["illustrative_influence"]["items"]
                                            if not i["card_id"].startswith("S|GLOBAL")]
    (w,) = check_result(r, config, cards)
    assert "misses 3 illustrative card(s)" in w and "S|GLOBAL|Pricing & cost indices" in w


def test_missing_dependency_link_is_flagged():
    config, cards = demo_inputs()
    r = with_inputs_ok(config)
    r["cross_region_effects"] = [e for e in r["cross_region_effects"]
                                 if (e["from_region"], e["to_region"]) != ("EUROPE", "APAC")]
    assert check_result(r, config, cards) == ["cross_region_effects misses supply-dependency link(s): EUROPE → APAC."]


def test_input_checks_skipped_without_inputs():
    r = valid_result()
    r["illustrative_influence"] = {"any": False, "items": []}
    assert check_result(r) == []


def test_check_does_not_change_result():
    r = valid_result()
    r["balance_matrix"][0]["gap"] = 9
    before = copy.deepcopy(r)
    check_result(r)
    assert r == before


def test_weird_shapes_never_raise():
    r = valid_result()
    r["ecosystem_data"] = "oops"
    r["decision_areas"] = {"a": 1}
    r["recommendations"] = [None]
    assert isinstance(check_result(r), list)
