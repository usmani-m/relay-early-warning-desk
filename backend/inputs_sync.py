"""Keeps input cards in step with the config. Pure functions; never changes a slider value."""

from backend.categories import side_of
from backend.models import GLOBAL, Config, InputCard


def card_id(side: str, region: str, segment: str | None, dataset: str) -> str:
    if side == "demand":
        return f"D|{region}|{segment}|{dataset}"
    return f"S|{region}|{dataset}"


def required_keys(config: Config) -> list[tuple[str, str, str | None, str]]:
    """(side, region, segment, dataset) for every card that must exist, GLOBAL rows first."""
    keys = []
    for region in [GLOBAL] + config.regions:
        for dataset in config.active_datasets:
            if side_of(dataset) == "demand":
                keys += [("demand", region, seg, dataset) for seg in config.segments]
        for dataset in config.active_datasets:
            if side_of(dataset) == "supply":
                keys.append(("supply", region, None, dataset))
    return keys


def _sort_key(config: Config):
    region_order = {r: i for i, r in enumerate([GLOBAL] + config.regions)}
    segment_order = {s: i for i, s in enumerate(config.segments)}

    def key(c: InputCard):
        return (
            0 if c.side == "demand" else 1,
            region_order.get(c.region, 999),
            segment_order.get(c.segment, -1),
            c.dataset,
        )

    return key


def sync_inputs(config: Config, cards: list[InputCard]) -> list[InputCard]:
    """Create missing cards (no data), drop cards of removed regions or segments, keep everything else.

    Cards of deactivated categories are kept (dormant) so their values return when the category is switched back on.
    """
    regions = {GLOBAL, *config.regions}
    segments = set(config.segments)
    kept: dict[str, InputCard] = {}
    for c in cards:
        if c.region not in regions:
            continue
        if c.side == "demand" and c.segment not in segments:
            continue
        cid = card_id(c.side, c.region, c.segment, c.dataset)
        kept[cid] = c if c.id == cid else c.model_copy(update={"id": cid})
    for side, region, segment, dataset in required_keys(config):
        cid = card_id(side, region, segment, dataset)
        if cid not in kept:
            kept[cid] = InputCard(id=cid, side=side, dataset=dataset, region=region, segment=segment)
    return sorted(kept.values(), key=_sort_key(config))


def active_cards(config: Config, cards: list[InputCard]) -> list[InputCard]:
    """Cards in active categories, i.e. what is sent to Gemini."""
    active = set(config.active_datasets)
    return [c for c in cards if c.dataset in active]


def _renamed_card(c: InputCard, **update) -> InputCard:
    c = c.model_copy(update=update)
    return c.model_copy(update={"id": card_id(c.side, c.region, c.segment, c.dataset)})


def rename_region(config: Config, cards: list[InputCard], old: str, new: str) -> tuple[Config, list[InputCard]]:
    if old not in config.regions:
        raise ValueError(f"Unknown region: {old}.")
    ren = lambda r: new if r == old else r
    data = config.model_dump()
    data["regions"] = [ren(r) for r in config.regions]
    data["supply_dependency"] = {
        ren(r): {ren(q): v for q, v in row.items()} for r, row in config.supply_dependency.items()
    }
    data["demand_competition"] = {ren(r): v for r, v in config.demand_competition.items()}
    new_config = Config.model_validate(data)
    new_cards = [_renamed_card(c, region=new) if c.region == old else c for c in cards]
    return new_config, sync_inputs(new_config, new_cards)


def rename_segment(config: Config, cards: list[InputCard], old: str, new: str) -> tuple[Config, list[InputCard]]:
    if old not in config.segments:
        raise ValueError(f"Unknown segment: {old}.")
    data = config.model_dump()
    data["segments"] = [new if s == old else s for s in config.segments]
    new_config = Config.model_validate(data)
    new_cards = [_renamed_card(c, segment=new) if c.segment == old else c for c in cards]
    return new_config, sync_inputs(new_config, new_cards)


def delete_region(config: Config, cards: list[InputCard], region: str) -> tuple[Config, list[InputCard]]:
    if region not in config.regions:
        raise ValueError(f"Unknown region: {region}.")
    data = config.model_dump()
    data["regions"] = [r for r in config.regions if r != region]
    data["supply_dependency"] = {
        r: {q: v for q, v in row.items() if q != region}
        for r, row in config.supply_dependency.items()
        if r != region
    }
    data["demand_competition"] = {r: v for r, v in config.demand_competition.items() if r != region}
    new_config = Config.model_validate(data)
    return new_config, sync_inputs(new_config, cards)


def delete_segment(config: Config, cards: list[InputCard], segment: str) -> tuple[Config, list[InputCard]]:
    if segment not in config.segments:
        raise ValueError(f"Unknown segment: {segment}.")
    data = config.model_dump()
    data["segments"] = [s for s in config.segments if s != segment]
    new_config = Config.model_validate(data)
    return new_config, sync_inputs(new_config, cards)
