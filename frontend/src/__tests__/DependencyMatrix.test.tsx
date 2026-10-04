import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { DependencyMatrix } from "../setup/DependencyMatrix";

const REGIONS = ["EUROPE", "AMER", "APAC"];

describe("DependencyMatrix", () => {
  it("shows the own share as 1 minus the row sum", () => {
    render(<DependencyMatrix regions={REGIONS} dependency={{ EUROPE: { APAC: 0.5, AMER: 0.1 } }} onChange={() => {}} />);
    expect(screen.getByTestId("own-EUROPE")).toHaveTextContent("0.40");
    expect(screen.getByTestId("own-AMER")).toHaveTextContent("1.00");
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("flags a row whose sum is above 1 and reports invalid", () => {
    const onValidity = vi.fn();
    render(
      <DependencyMatrix regions={REGIONS} dependency={{ EUROPE: { APAC: 0.6, AMER: 0.5 } }} onChange={() => {}} onValidityChange={onValidity} />,
    );
    expect(screen.getByRole("alert")).toHaveTextContent("add up to 1.10");
    expect(onValidity).toHaveBeenLastCalledWith(false);
    expect(screen.getByLabelText("Share of EUROPE electronics sourced from APAC")).toHaveAttribute("aria-invalid", "true");
    expect(screen.getByTestId("own-EUROPE")).toHaveTextContent("–");
  });

  it("reports valid again once the row is fixed, and slider changes are rounded", () => {
    const onValidity = vi.fn();
    const onChange = vi.fn();
    const { rerender } = render(
      <DependencyMatrix regions={REGIONS} dependency={{ EUROPE: { APAC: 0.6, AMER: 0.5 } }} onChange={onChange} onValidityChange={onValidity} />,
    );
    rerender(
      <DependencyMatrix regions={REGIONS} dependency={{ EUROPE: { APAC: 0.5, AMER: 0.5 } }} onChange={onChange} onValidityChange={onValidity} />,
    );
    expect(onValidity).toHaveBeenLastCalledWith(true);
    expect(screen.getByTestId("own-EUROPE")).toHaveTextContent("0.00");

    fireEvent.change(screen.getByLabelText("Share of AMER electronics sourced from APAC"), { target: { value: "0.35" } });
    expect(onChange).toHaveBeenLastCalledWith({ EUROPE: { APAC: 0.5, AMER: 0.5 }, AMER: { APAC: 0.35 } });
  });
});
