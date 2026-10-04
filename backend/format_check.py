"""Light format check of a Gemini result. Returns warnings only; never raises and never changes the result.

It does not verify Gemini's arithmetic (see CLAUDE.md, decision 4).
"""

from backend.categories import ALL_CATEGORIES
from backend.inputs_sync import active_cards
from backend.models import GLOBAL, Config, InputCard

REQUIRED_KEYS = [
    "as_of_date", "executive_briefing", "ecosystem_data", "input_assessment", "agent_log", "orchestration",
    "knowledge_graph", "supply_by_region", "balance_matrix", "global_comparison", "global_comparison_commentary",
    "cross_region_effects", "illustrative_influence", "pestle_coverage", "capabilities", "scenarios",
    "action_evaluation", "recommendations", "decision_areas", "optimisation_objectives", "expected_outcomes",
    "data_gaps", "human_review_summary",
]
DECISION_AREAS = [
    "Demand & Sales", "Procurement", "Manufacturing", "Inventory & Working Capital",
    "Customer & Order Allocation", "Product & Engineering", "Investment & Strategy",
]
SCORE_KEYS = {"level", "demand", "effective_supply", "gap", "region_level", "global_level", "difference",
              "worst_case", "weighted_score"}
OBJECTIVES = ("profitability", "customer_value", "growth", "resilience")


def _is_score_key(key: str, parent: str) -> bool:
    return key in SCORE_KEYS or key.startswith("score_") or (parent == "objective_scores" and key in OBJECTIVES)


def _scores(node, path: str, parent: str, out: list[str]) -> None:
    if isinstance(node, dict):
        for k, v in node.items():
            p = f"{path}.{k}" if path else k
            if _is_score_key(k, parent) and not (k == "level" and isinstance(v, str)):  # alert levels are words
                if v is None:
                    continue
                if isinstance(v, bool) or not isinstance(v, (int, float)):
                    out.append(f"{p} should be a score from -3 to +3, got {v!r}.")
                elif v != int(v) or not -3 <= v <= 3:
                    out.append(f"{p} = {v} is outside the scale (whole numbers -3..+3).")
            else:
                _scores(v, p, k, out)
    elif isinstance(node, list):
        for i, v in enumerate(node):
            _scores(v, f"{path}[{i}]", parent, out)


def _categories(result: dict, out: list[str]) -> None:
    eco = result.get("ecosystem_data")
    if not isinstance(eco, dict):
        return
    seen = set()
    for side in ("demand_side", "supply_side"):
        for item in eco.get(side) or []:
            if isinstance(item, dict):
                seen.add(item.get("dataset"))
    missing = [c for c in ALL_CATEGORIES if c not in seen]
    if missing:
        out.append(f"ecosystem_data is missing {len(missing)} of 16 categories: {', '.join(missing)}.")


def _decision_areas(result: dict, out: list[str]) -> None:
    areas = result.get("decision_areas")
    if not isinstance(areas, list):
        return
    by_name = {a.get("area"): a for a in areas if isinstance(a, dict)}
    for name in DECISION_AREAS:
        if name not in by_name:
            out.append(f"Decision area missing: {name}.")
            continue
        questions = by_name[name].get("questions")
        n = len(questions) if isinstance(questions, list) else 0
        if n != 3:
            out.append(f"Decision area {name} has {n} questions; expected 3.")


def _approvals(result: dict, out: list[str]) -> None:
    recs = result.get("recommendations")
    if not isinstance(recs, list):
        return
    for i, rec in enumerate(recs):
        if not isinstance(rec, dict) or rec.get("requires_human_approval") is not True:
            out.append(f"recommendations[{i}] does not require human approval.")


def _recommendation_coverage(result: dict, out: list[str]) -> None:
    """One recommendation per balance-matrix cell with |gap| >= 2, ordered by priority."""
    rows, recs = result.get("balance_matrix"), result.get("recommendations")
    if not isinstance(rows, list) or not isinstance(recs, list):
        return
    cells = [(r.get("region"), r.get("segment")) for r in rows
             if isinstance(r, dict) and isinstance(r.get("gap"), int) and not isinstance(r.get("gap"), bool)
             and abs(r["gap"]) >= 2]
    if cells:
        if len(recs) != len(cells):
            out.append(f"{len(recs)} recommendation(s) for {len(cells)} cell(s) with |gap| >= 2; expected one per cell.")
        covered = {(r.get("region"), r.get("segment")) for r in recs if isinstance(r, dict)}
        missing = [f"{reg} {seg}" for reg, seg in cells if (reg, seg) not in covered]
        if missing:
            out.append(f"No recommendation for cell(s) with |gap| >= 2: {', '.join(missing)}.")
    priorities = [r.get("priority") for r in recs if isinstance(r, dict)]
    if all(isinstance(p, (int, float)) for p in priorities) and priorities != sorted(priorities):
        out.append("Recommendations are not ordered by priority.")


def illustrative_feeding_matrix(config: Config, cards: list[InputCard]) -> set[str]:
    """Ids of illustrative cards that feed some number in the balance matrix (per the prompt's formulas).

    Regional demand and supply cards always feed it; GLOBAL supply cards feed it when any region uses the GLOBAL
    fallback; GLOBAL demand cards only feed the global comparison. Set membership only, no arithmetic.
    """
    valued = [c for c in active_cards(config, cards) if c.level is not None]
    with_own_supply = {c.region for c in valued if c.side == "supply" and c.region != GLOBAL}
    fallback_used = any(r not in with_own_supply for r in config.regions)
    ids = set()
    for c in valued:
        if not c.is_illustrative:
            continue
        if c.region != GLOBAL or (c.side == "supply" and fallback_used):
            ids.add(c.id)
    return ids


def _illustrative(result: dict, config: Config, cards: list[InputCard], out: list[str]) -> None:
    expected = illustrative_feeding_matrix(config, cards)
    influence = result.get("illustrative_influence")
    items = influence.get("items") if isinstance(influence, dict) else None
    listed = {i.get("card_id") for i in items if isinstance(i, dict)} if isinstance(items, list) else set()
    missing = sorted(expected - listed)
    if missing:
        out.append(f"illustrative_influence misses {len(missing)} illustrative card(s) that feed the balance matrix: "
                   f"{', '.join(missing)}.")
    if expected and isinstance(influence, dict) and influence.get("any") is not True:
        out.append("illustrative_influence.any should be true: illustrative cards feed the balance matrix.")


def _cross_region(result: dict, config: Config, out: list[str]) -> None:
    effects = result.get("cross_region_effects")
    if not isinstance(effects, list):
        return
    present = {(e.get("from_region"), e.get("to_region")) for e in effects
               if isinstance(e, dict) and e.get("channel") == "supply_dependency"}
    missing = [f"{o} → {r}" for r, row in config.supply_dependency.items() for o, share in row.items()
               if share > 0 and (o, r) not in present]
    if missing:
        out.append(f"cross_region_effects misses supply-dependency link(s): {', '.join(missing)}.")


def check_result(result, config: Config | None = None, cards: list[InputCard] | None = None) -> list[str]:
    """config and cards are optional; with them, the input-dependent checks (illustrative, dependency links) run too."""
    if not isinstance(result, dict):
        return [f"Result is not a JSON object (got {type(result).__name__})."]
    out: list[str] = []
    missing = [k for k in REQUIRED_KEYS if k not in result]
    if missing:
        out.append(f"Missing top-level keys: {', '.join(missing)}.")
    try:
        _scores(result, "", "", out)
        _categories(result, out)
        _decision_areas(result, out)
        _approvals(result, out)
        _recommendation_coverage(result, out)
        if config is not None and cards is not None:
            _illustrative(result, config, cards, out)
            _cross_region(result, config, out)
    except Exception as e:  # a warning tool must never break a run
        out.append(f"Format check stopped early ({type(e).__name__}: {e}).")
    return out
