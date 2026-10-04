"""Pydantic models for config.json, inputs.json and decisions.json. Validation only, no analysis."""

from typing import Literal

from pydantic import BaseModel, Field, field_validator, model_validator

from backend.categories import MAX_ACTIVE_PER_SIDE, side_of

GLOBAL = "GLOBAL"
DEFAULT_REGIONS = ["EUROPE", "AMER", "APAC", "MEA"]
DEFAULT_SEGMENTS = ["Infrastructure", "Utilities", "Industry"]
DEFAULT_ACTIVE = [
    "Project pipelines & permitting",
    "Grid plans & investments",
    "Market & policy development",
    "Lead times & allocations",
    "Pricing & cost indices",
    "Raw material & chemicals",
]

Side = Literal["demand", "supply"]
Confidence = Literal["low", "medium", "high"]


class PolicyWeights(BaseModel):
    profitability: float = 30
    customer_value: float = 25
    growth: float = 25
    resilience: float = 20

    @model_validator(mode="after")
    def _check(self):
        values = [self.profitability, self.customer_value, self.growth, self.resilience]
        if any(v < 0 for v in values):
            raise ValueError("Objective weights cannot be negative.")
        if abs(sum(values) - 100) > 1e-6:
            raise ValueError(f"Objective weights must sum to 100 (they sum to {sum(values):g}).")
        return self


def _clean_names(names: list[str], what: str) -> list[str]:
    cleaned = [n.strip() for n in names]
    if not cleaned:
        raise ValueError(f"Add at least one {what}.")
    if any(not n for n in cleaned):
        raise ValueError(f"A {what} name cannot be empty.")
    if len({n.upper() for n in cleaned}) != len(cleaned):
        raise ValueError(f"{what.capitalize()} names must be unique.")
    if any(n.upper() == GLOBAL for n in cleaned):
        raise ValueError(f'"{GLOBAL}" is reserved for the global baseline and cannot be a {what} name.')
    return cleaned


class Config(BaseModel):
    regions: list[str] = Field(default_factory=lambda: list(DEFAULT_REGIONS))
    segments: list[str] = Field(default_factory=lambda: list(DEFAULT_SEGMENTS))
    active_datasets: list[str] = Field(default_factory=lambda: list(DEFAULT_ACTIVE))
    supply_dependency: dict[str, dict[str, float]] = Field(default_factory=dict)
    demand_competition: dict[str, float] = Field(default_factory=dict)
    pool_pressure_factor: float = 0.5
    policy_weights: PolicyWeights = Field(default_factory=PolicyWeights)
    dependencies_are_examples: bool = False

    @field_validator("regions")
    @classmethod
    def _regions(cls, v):
        return _clean_names(v, "region")

    @field_validator("segments")
    @classmethod
    def _segments(cls, v):
        return _clean_names(v, "segment")

    @field_validator("active_datasets")
    @classmethod
    def _active(cls, v):
        unknown = [d for d in v if side_of(d) is None]
        if unknown:
            raise ValueError(f"Unknown data category: {', '.join(unknown)}. Use ABB's exact category names.")
        if len(set(v)) != len(v):
            raise ValueError("A data category is listed twice in active_datasets.")
        for side in ("demand", "supply"):
            n = sum(1 for d in v if side_of(d) == side)
            if n < 1:
                raise ValueError(f"Keep at least one {side}-side category active.")
            if n > MAX_ACTIVE_PER_SIDE:
                raise ValueError(f"Up to {MAX_ACTIVE_PER_SIDE} {side}-side categories can be active ({n} given).")
        return v

    @field_validator("pool_pressure_factor")
    @classmethod
    def _pool(cls, v):
        if v < 0:
            raise ValueError("pool_pressure_factor cannot be negative.")
        return v

    @model_validator(mode="after")
    def _dependencies(self):
        regions = set(self.regions)
        for r, row in self.supply_dependency.items():
            if r not in regions:
                raise ValueError(f"supply_dependency has an unknown region: {r}.")
            for q, share in row.items():
                if q not in regions:
                    raise ValueError(f"supply_dependency[{r}] has an unknown region: {q}.")
                if q == r:
                    raise ValueError(f"supply_dependency[{r}] cannot list {r} itself; own share is 1 minus the row sum.")
                if not 0 <= share <= 1:
                    raise ValueError(f"supply_dependency[{r}][{q}] must be between 0 and 1.")
            total = sum(row.values())
            if total > 1 + 1e-9:
                raise ValueError(f"supply_dependency[{r}] sums to {total:.2f}; it must be 1 or less.")
        for r, value in self.demand_competition.items():
            if r not in regions:
                raise ValueError(f"demand_competition has an unknown region: {r}.")
            if not 0 <= value <= 1:
                raise ValueError(f"demand_competition[{r}] must be between 0 and 1.")
        return self

    def own_share(self, region: str) -> float:
        return 1 - sum(self.supply_dependency.get(region, {}).values())


class InputCard(BaseModel):
    id: str
    side: Side
    dataset: str
    region: str
    segment: str | None = None
    level: int | None = Field(default=None, ge=-3, le=3)
    confidence: Confidence = "medium"
    evidence_note: str = ""
    source_url: str = ""
    date: str = ""
    is_illustrative: bool = False

    @model_validator(mode="after")
    def _check(self):
        actual = side_of(self.dataset)
        if actual is None:
            raise ValueError(f"Card {self.id}: unknown data category {self.dataset!r}.")
        if actual != self.side:
            raise ValueError(f"Card {self.id}: {self.dataset} is a {actual}-side category, not {self.side}.")
        if self.side == "demand" and not self.segment:
            raise ValueError(f"Card {self.id}: demand cards need a segment.")
        if self.side == "supply" and self.segment is not None:
            raise ValueError(f"Card {self.id}: supply cards are per region and have no segment.")
        if self.source_url and not self.source_url.startswith(("http://", "https://")):
            raise ValueError(f"Card {self.id}: source_url should start with https://")
        return self


class Decision(BaseModel):
    as_of: str
    region: str
    segment: str
    recommendation: str
    decision: Literal["approved", "adjusted", "rejected"]
    note: str = ""
