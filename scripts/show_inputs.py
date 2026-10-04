"""Prints the current inputs per region and segment (values only, no calculation).

Run from the project root:  python scripts/show_inputs.py
"""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from backend.inputs_sync import active_cards  # noqa: E402
from backend.models import GLOBAL  # noqa: E402
from backend.storage import load_config, load_inputs  # noqa: E402


def fmt(card) -> str:
    if card.level is None:
        return "no data"
    lv = f"{card.level:+d}" if card.level else "0"
    return f"{lv} {card.confidence}" + (" ILLUSTRATIVE" if card.is_illustrative else "")


def main() -> None:
    config = load_config()
    cards = active_cards(config, load_inputs())
    dormant = len(load_inputs()) - len(cards)
    print(f"Regions: {', '.join(config.regions)}   Segments: {', '.join(config.segments)}")
    print(f"Active: {'; '.join(config.active_datasets)}\n")
    for region in [GLOBAL] + config.regions:
        print(f"== {region} ==")
        for seg in config.segments:
            row = [c for c in cards if c.side == "demand" and c.region == region and c.segment == seg]
            print(f"  demand  {seg}")
            for c in row:
                print(f"      {c.dataset:<32} {fmt(c)}")
        print("  supply")
        for c in [c for c in cards if c.side == "supply" and c.region == region]:
            print(f"      {c.dataset:<32} {fmt(c)}")
    print("\nDependencies" + (" (EXAMPLE values)" if config.dependencies_are_examples else "") + ":")
    for r in config.regions:
        row = config.supply_dependency.get(r, {})
        others = ", ".join(f"{q} {v:.2f}" for q, v in row.items()) or "none"
        print(f"  {r:<8} own {config.own_share(r):.2f}; from {others}; demand competition "
              f"{config.demand_competition.get(r, 0):.2f}")
    print(f"  pool pressure factor {config.pool_pressure_factor}")
    if dormant:
        print(f"\n{dormant} dormant card(s) in inactive categories (kept, not sent).")


if __name__ == "__main__":
    main()
