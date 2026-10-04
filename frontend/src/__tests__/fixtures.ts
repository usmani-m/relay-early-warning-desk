// Real demo files from data/demo/ (Vitest runs from frontend/), plus the 16 categories as the API returns them.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { Categories, Config, InputCard } from "../types";

const fixture = (p: string) => JSON.parse(readFileSync(resolve(process.cwd(), "..", p), "utf8"));

export const demoConfig = (): Config => fixture("data/demo/config.json");
export const demoInputs = (): InputCard[] => fixture("data/demo/inputs.json");

const DEMAND = ["Market & policy development", "Project pipelines & permitting", "Grid plans & investments", "Customer forecasts & RFQs",
  "Order intake & backlog", "Industry & macro economics", "Commodity & energy prices", "News & events (ESG, geopolitics)"];
const SUPPLY = ["Component demand & market data", "Lead times & allocations", "Pricing & cost indices", "Supplier & capacity announcements",
  "Inventory & distributor data", "Product lifecycle & EOL notices", "Logistics & risk indicators", "Raw material & chemicals"];
const INTERNAL = ["Customer forecasts & RFQs", "Order intake & backlog"];

export const categories: Categories = {
  demand: DEMAND.map((name) => ({ name, abb_internal: INTERNAL.includes(name) })),
  supply: SUPPLY.map((name) => ({ name, abb_internal: false })),
  max_active_per_side: 3,
};
