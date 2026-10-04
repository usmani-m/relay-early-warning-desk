"""Builds the user message for Gemini from config, inputs and decisions. Formatting only, no analysis."""

import json

from backend.categories import INTERNAL_CATEGORIES, side_of
from backend.inputs_sync import active_cards
from backend.models import GLOBAL, Config, Decision, InputCard

CARD_FIELDS = ["id", "side", "dataset", "region", "segment", "level", "confidence",
               "evidence_note", "source_url", "date", "is_illustrative"]


def _json(data) -> str:
    return json.dumps(data, indent=1, ensure_ascii=False)


def _block(tag: str, body: str) -> str:
    return f"<{tag}>\n{body}\n</{tag}>"


def _card_row(c: InputCard) -> dict:
    data = c.model_dump()
    return {k: data[k] for k in CARD_FIELDS}


def no_data_lines(config: Config, cards: list[InputCard], region: str) -> list[str]:
    """Short lines for the active region × side × segment combinations without a value."""
    empty = {(c.side, c.segment, c.dataset) for c in cards if c.region == region and c.level is None}
    lines = []
    for side in ("demand", "supply"):
        datasets = [d for d in config.active_datasets if side_of(d) == side]
        for seg in (config.segments if side == "demand" else [None]):
            missing = [d for d in datasets if (side, seg, d) in empty]
            if not missing:
                continue
            what = "all active categories" if len(missing) == len(datasets) else "; ".join(missing)
            label = f"{region} {side} {seg}" if seg else f"{region} {side}"
            lines.append(f"{label}: {what}")
    return lines


def _cards_block(config: Config, cards: list[InputCard], regions: list[str]) -> dict:
    return {
        "cards": [_card_row(c) for c in cards if c.region in regions and c.level is not None],
        "no_data": [line for r in regions for line in no_data_lines(config, cards, r)],
    }


def build_user_message(config: Config, cards: list[InputCard], decisions: list[Decision], *,
                       today: str, focus: str = "", notes: str = "") -> str:
    cards = active_cards(config, cards)
    context = {
        "today": today,
        "focus": focus,
        "regions": config.regions,
        "segments": config.segments,
        "active_datasets": [
            {"name": d, "side": side_of(d), "abb_internal": d in INTERNAL_CATEGORIES} for d in config.active_datasets
        ],
        "notes": notes,
    }
    dependencies = {
        "supply_dependency": {
            r: {"own_share": round(config.own_share(r), 4), "from": config.supply_dependency.get(r, {})}
            for r in config.regions
        },
        "demand_competition": {r: config.demand_competition.get(r, 0) for r in config.regions},
        "pool_pressure_factor": config.pool_pressure_factor,
        "dependencies_are_examples": config.dependencies_are_examples,
    }
    feedback = _json([d.model_dump() for d in decisions]) if decisions else "none yet"
    return "\n\n".join([
        _block("context", _json(context)),
        _block("inputs", _json(_cards_block(config, cards, config.regions))),
        _block("global_baseline", _json(_cards_block(config, cards, [GLOBAL]))),
        _block("dependencies", _json(dependencies)),
        _block("feedback", feedback),
        _block("policy", _json({"objective_weights_percent": config.policy_weights.model_dump()})),
    ])
