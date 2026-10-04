import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { BalanceMatrix } from "../dashboard/BalanceMatrix";
import { STATUSES } from "../result/status";
import type { BalanceCell } from "../result/types";

// One cell per status: 2 regions x 4 segments.
const REGIONS = ["R1", "R2"];
const SEGMENTS = ["S1", "S2", "S3", "S4"];
const GAPS = [3, 2, 1, 0, -1, -2, -3, null];
const cells: BalanceCell[] = STATUSES.map((s, i) => ({
  region: REGIONS[Math.floor(i / 4)],
  segment: SEGMENTS[i % 4],
  status: s.key,
  gap: GAPS[i],
  demand: i === 7 ? null : 1,
  effective_supply: -1,
  supply_source: i === 0 ? "global_fallback" : "own",
}));

describe("BalanceMatrix", () => {
  it("renders all 7 statuses plus insufficient data with the right class and label", () => {
    render(<BalanceMatrix cells={cells} regions={REGIONS} segments={SEGMENTS} selected={null} onSelect={() => {}} />);
    const buttons = screen.getAllByRole("button");
    expect(buttons).toHaveLength(8);
    STATUSES.forEach((s, i) => {
      const b = buttons[i];
      expect(b).toHaveAttribute("data-status", s.key);
      expect(b).toHaveClass(`st-${s.key}`);
      expect(b).toHaveTextContent(s.label);
    });
    expect(buttons[0]).toHaveTextContent("Demand: Slightly favorable");
    expect(buttons[0]).toHaveTextContent("Supply: Slightly unfavorable (tightening)");
    expect(buttons[7]).toHaveTextContent("Demand: no data");
    for (const b of buttons) expect(b.textContent).not.toMatch(/[+−-][0-3]/); // names, not numbers
    expect(buttons[0]).toHaveTextContent("GLOBAL"); // fallback marker
  });

  it("has a legend with every status", () => {
    render(<BalanceMatrix cells={cells} regions={REGIONS} segments={SEGMENTS} selected={null} onSelect={() => {}} />);
    const legend = screen.getByLabelText("Status legend");
    for (const s of STATUSES) expect(within(legend).getByText(new RegExp(s.label.replace(/[()]/g, "\\$&")))).toBeInTheDocument();
  });

  it("selects a cell on click and marks it", async () => {
    const onSelect = vi.fn();
    const { rerender } = render(<BalanceMatrix cells={cells} regions={REGIONS} segments={SEGMENTS} selected={null} onSelect={onSelect} />);
    await userEvent.click(screen.getByRole("button", { name: /R2 S2/ }));
    expect(onSelect).toHaveBeenCalledWith({ region: "R2", segment: "S2" });
    rerender(<BalanceMatrix cells={cells} regions={REGIONS} segments={SEGMENTS} selected={{ region: "R2", segment: "S2" }} onSelect={onSelect} />);
    expect(screen.getByRole("button", { name: /R2 S2/ })).toHaveAttribute("aria-pressed", "true");
  });

  it("shows a cell missing from the result as insufficient data", () => {
    render(<BalanceMatrix cells={cells.slice(0, 1)} regions={["R1"]} segments={["S1", "S2"]} selected={null} onSelect={() => {}} />);
    expect(screen.getByRole("button", { name: /R1 S2/ })).toHaveAttribute("data-status", "insufficient_data");
  });
});
