"""Builds the demo config and input cards from data/signals.json and the assessment in data/demo_result.json.

Run from the project root:  python scripts/build_demo_inputs.py [--reset]

Writes data/demo/config.json and data/demo/inputs.json. Copies them to data/config.json and data/inputs.json
only if those don't exist yet, or when --reset is given (which overwrites your working inputs).
No new sources are added: every non-empty card comes from one or more of the original signals, except the few
ILLUSTRATIVE_EXAMPLES below, which have no source and are always marked is_illustrative.
"""

import math
import shutil
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from backend.categories import side_of  # noqa: E402
from backend.inputs_sync import card_id, sync_inputs  # noqa: E402
from backend.models import Config, InputCard  # noqa: E402
from backend.storage import DATA, read_json, save_config, save_inputs, write_json  # noqa: E402

DEMO_DIR = DATA / "demo"
CONF_WEIGHT = {"low": 1, "medium": 2, "high": 3}

# Plausible example values, labelled as examples in the UI (dependencies_are_examples = True).
EXAMPLE_DEPENDENCY = {
    "EUROPE": {"APAC": 0.5, "AMER": 0.1},
    "AMER": {"APAC": 0.4, "EUROPE": 0.1},
    "APAC": {"EUROPE": 0.1},
    "MEA": {"EUROPE": 0.4, "APAC": 0.4},
}
EXAMPLE_COMPETITION = {"EUROPE": 0.6, "AMER": 0.5, "APAC": 0.6, "MEA": 0.3}

# Illustrative example values with no source, added so the demo shows cross-region effects. Always is_illustrative.
_APAC_NOTE = ("ILLUSTRATIVE EXAMPLE VALUE, no source: assumed tighter APAC supply, added so the demo shows how APAC "
              "supply affects EUROPE, AMER and MEA through the example dependencies. Replace with real data.")
ILLUSTRATIVE_EXAMPLES = {
    "S|APAC|Lead times & allocations": (-2, "medium", _APAC_NOTE),
    "S|APAC|Pricing & cost indices": (-2, "medium", _APAC_NOTE),
    "S|APAC|Raw material & chemicals": (-2, "medium", _APAC_NOTE),
    "D|AMER|Infrastructure|Project pipelines & permitting": (
        1, "low",
        "ILLUSTRATIVE EXAMPLE VALUE, no source: assumed slight growth in AMER infrastructure projects, added so the "
        "demo shows AMER demand competing for the shared component pool. Replace with real data.",
    ),
}


def round_half_away(x: float) -> int:
    return int(math.copysign(math.floor(abs(x) + 0.5 + 1e-9), x))


def to_level(score_9pt: int) -> int:
    """Old scale -100..100 in steps of 25 -> 7-point scale."""
    return max(-3, min(3, round_half_away(score_9pt * 3 / 100)))


def is_illustrative(sig: dict) -> bool:
    text = " ".join(str(sig.get(k, "")) for k in ("source", "value", "previous_value", "note"))
    return "ILLUSTRATIVE" in text.upper()


def describe(sig: dict) -> str:
    parts = [f"{sig['id']} ({sig['source']}, {sig['published_date']}): {sig['indicator']}: {sig['value']}"]
    if sig.get("previous_value"):
        parts.append(f"before: {sig['previous_value']}")
    if sig.get("note"):
        parts.append(sig["note"])
    return "; ".join(parts) + "."


def build_card(cid: str, side: str, region: str, segment: str | None, dataset: str, items: list[tuple[dict, dict]]) -> InputCard:
    """items = [(input signal, assessed signal from demo_result)]."""
    levels = [(to_level(a["score"]), a["confidence"]) for _, a in items]
    if len(items) == 1:
        level, confidence = levels[0]
        prefix = ""
    else:
        total = sum(CONF_WEIGHT[c] for _, c in levels)
        level = round_half_away(sum(lv * CONF_WEIGHT[c] for lv, c in levels) / total)
        confidence = max((c for _, c in levels), key=CONF_WEIGHT.get)
        ids = " and ".join(s["id"] for s, _ in items)
        prefix = f"Combined from {ids} with the confidence-weighted rule when converting the demo; adjust if needed. "
    # Primary source: highest confidence, then most recent.
    ordered = sorted(items, key=lambda it: (CONF_WEIGHT[it[1]["confidence"]], it[0]["published_date"]), reverse=True)
    primary = ordered[0][0]
    notes = [describe(s) for s, _ in ordered]
    extra_urls = [s["url"] for s, _ in ordered[1:] if s.get("url")]
    if extra_urls:
        notes.append("Also: " + " ".join(extra_urls))
    stale = [s["id"] for s, a in items if a.get("stale")]
    if stale:
        notes.append(f"Stale source: {', '.join(stale)}.")
    return InputCard(
        id=cid,
        side=side,
        dataset=dataset,
        region=region,
        segment=segment,
        level=level,
        confidence=confidence,
        evidence_note=prefix + " ".join(notes),
        source_url=primary.get("url", ""),
        date=max(s["published_date"] for s, _ in items),
        is_illustrative=any(is_illustrative(s) for s, _ in items),
    )


def build() -> tuple[Config, list[InputCard]]:
    signals = read_json(DATA / "signals.json")
    assessed = {s["id"]: s for s in read_json(DATA / "demo_result.json")["signals"]}
    config = Config(
        supply_dependency=EXAMPLE_DEPENDENCY,
        demand_competition=EXAMPLE_COMPETITION,
        dependencies_are_examples=True,
    )
    groups: dict[str, dict] = {}
    for sig in signals:
        side = side_of(sig["dataset"])
        segments = [None] if side == "supply" else (config.segments if sig["segment"] == "All" else [sig["segment"]])
        for seg in segments:
            cid = card_id(side, sig["region"], seg, sig["dataset"])
            g = groups.setdefault(cid, {"side": side, "region": sig["region"], "segment": seg, "dataset": sig["dataset"], "items": []})
            g["items"].append((sig, assessed[sig["id"]]))
    cards = [build_card(cid, g["side"], g["region"], g["segment"], g["dataset"], g["items"]) for cid, g in groups.items()]
    cards = [apply_example(c) for c in sync_inputs(config, cards)]
    return config, cards


def apply_example(card: InputCard) -> InputCard:
    if card.id not in ILLUSTRATIVE_EXAMPLES:
        return card
    if card.level is not None:
        raise ValueError(f"{card.id} already has a sourced value; refusing to overwrite it with an example.")
    level, confidence, note = ILLUSTRATIVE_EXAMPLES[card.id]
    return card.model_copy(update={"level": level, "confidence": confidence, "evidence_note": note, "is_illustrative": True})


def main() -> None:
    reset = "--reset" in sys.argv
    config, cards = build()
    save_config(config, DEMO_DIR / "config.json")
    save_inputs(cards, DEMO_DIR / "inputs.json")
    print(f"Wrote data/demo/config.json and data/demo/inputs.json ({len(cards)} cards, "
          f"{sum(c.level is not None for c in cards)} with data).")
    for name in ("config.json", "inputs.json"):
        target = DATA / name
        if reset or not target.exists():
            shutil.copyfile(DEMO_DIR / name, target)
            print(f"Copied to data/{name}.")
        else:
            print(f"data/{name} already exists; kept it (use --reset to overwrite).")
    if not (DATA / "decisions.json").exists():
        write_json(DATA / "decisions.json", [])
        print("Created data/decisions.json.")


if __name__ == "__main__":
    main()
