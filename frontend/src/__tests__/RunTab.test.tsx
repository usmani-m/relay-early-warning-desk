import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("../api", () => ({
  ApiError: class extends Error {},
  api: {
    getConfig: vi.fn().mockResolvedValue({
      regions: ["EUROPE", "AMER"],
      policy_weights: { profitability: 30, customer_value: 25, growth: 25, resilience: 20 },
    }),
    listResults: vi.fn().mockResolvedValue([]),
  },
}));
const { RunTab, weightsSum } = await import("../run/RunTab");

describe("RunTab weights", () => {
  it("sums the weights", () => {
    expect(weightsSum({ profitability: 30, customer_value: 25, growth: 25, resilience: 20 })).toBe(100);
  });

  it("shows an inline error and disables Run when the weights don't add up to 100", async () => {
    const onDirty = vi.fn();
    render(<RunTab dataVersion={0} unsavedElsewhere={false} currentRunId={undefined} onResult={() => {}} onWeightsDirty={onDirty} />);
    const growth = await screen.findByLabelText("Growth");
    const run = screen.getByRole("button", { name: "Load cached result" });
    expect(run).toBeEnabled();
    expect(screen.getByTestId("weights-sum")).toHaveTextContent("Sum 100%");

    fireEvent.change(growth, { target: { value: "40" } });
    expect(screen.getByTestId("weights-sum")).toHaveTextContent("Sum 115%");
    expect(screen.getByText(/must add up to 100%/)).toBeInTheDocument();
    expect(run).toBeDisabled();
    expect(screen.getByRole("button", { name: "Save weights" })).toBeDisabled();
    expect(onDirty).toHaveBeenLastCalledWith(true);

    fireEvent.change(screen.getByLabelText("Resilience"), { target: { value: "5" } });
    expect(screen.getByTestId("weights-sum")).toHaveTextContent("Sum 100%");
    expect(run).toBeEnabled();
    expect(screen.getByRole("button", { name: "Save weights" })).toBeEnabled();
  });

  it("explains the cached switch and live runs", async () => {
    render(<RunTab dataVersion={0} unsavedElsewhere currentRunId={undefined} onResult={() => {}} onWeightsDirty={() => {}} />);
    expect(await screen.findByText(/Loads the saved demo result instantly/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("switch"));
    expect(screen.getByRole("button", { name: "Run analysis" })).toBeInTheDocument();
    expect(screen.getByText(/uses the/)).toHaveTextContent("saved data");
  });
});
