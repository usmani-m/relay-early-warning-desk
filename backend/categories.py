"""The 16 data categories from ABB's "Vision for the solution". Names must stay exactly as written here."""

DEMAND_CATEGORIES = [
    "Market & policy development",
    "Project pipelines & permitting",
    "Grid plans & investments",
    "Customer forecasts & RFQs",
    "Order intake & backlog",
    "Industry & macro economics",
    "Commodity & energy prices",
    "News & events (ESG, geopolitics)",
]

SUPPLY_CATEGORIES = [
    "Component demand & market data",
    "Lead times & allocations",
    "Pricing & cost indices",
    "Supplier & capacity announcements",
    "Inventory & distributor data",
    "Product lifecycle & EOL notices",
    "Logistics & risk indicators",
    "Raw material & chemicals",
]

ALL_CATEGORIES = DEMAND_CATEGORIES + SUPPLY_CATEGORIES

# ABB-internal data: not available in this prototype unless the planner enters it.
INTERNAL_CATEGORIES = ["Customer forecasts & RFQs", "Order intake & backlog"]

MAX_ACTIVE_PER_SIDE = 3


def side_of(name: str) -> str | None:
    """Return "demand", "supply" or None for an unknown name."""
    if name in DEMAND_CATEGORIES:
        return "demand"
    if name in SUPPLY_CATEGORIES:
        return "supply"
    return None
