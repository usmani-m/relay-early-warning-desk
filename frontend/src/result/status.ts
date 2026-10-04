// The 7 gap statuses from the system prompt plus insufficient_data: label, CSS class, legend order.

export interface StatusInfo {
  key: string;
  label: string;
  gap: string; // the gap level that produces it
  group: "shortage" | "watch" | "balanced" | "excess" | "none";
}

export const STATUSES: StatusInfo[] = [
  { key: "shortage_critical", label: "Shortage critical", gap: "+3", group: "shortage" },
  { key: "shortage_risk", label: "Shortage risk", gap: "+2", group: "shortage" },
  { key: "watch_shortage", label: "Watch (shortage)", gap: "+1", group: "watch" },
  { key: "balanced", label: "Balanced", gap: "0", group: "balanced" },
  { key: "watch_excess", label: "Watch (excess)", gap: "−1", group: "watch" },
  { key: "excess_risk", label: "Excess risk", gap: "−2", group: "excess" },
  { key: "excess_critical", label: "Excess critical", gap: "−3", group: "excess" },
  { key: "insufficient_data", label: "Insufficient data", gap: "", group: "none" },
];

const BY_KEY = new Map(STATUSES.map((s) => [s.key, s]));
// Older results used these names.
const ALIASES: Record<string, string> = { excess_stock_risk: "excess_risk" };

export function statusInfo(status: unknown): StatusInfo {
  const key = typeof status === "string" ? ALIASES[status] ?? status : "";
  return BY_KEY.get(key) ?? { key: "unknown", label: key ? key.replace(/_/g, " ") : "No status", gap: "", group: "none" };
}

/** Severity for choosing the default selected cell (higher = more urgent). */
export function severity(status: unknown): number {
  const order = ["shortage_critical", "excess_critical", "shortage_risk", "excess_risk", "watch_shortage", "watch_excess", "balanced"];
  const i = order.indexOf(statusInfo(status).key);
  return i < 0 ? -1 : order.length - i;
}
