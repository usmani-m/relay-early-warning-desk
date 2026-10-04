import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { LevelSlider } from "../components/LevelSlider";
import { plainLabel } from "../scale";

function Controlled({ initial, side = "supply", onChange }: { initial: number | null; side?: "demand" | "supply"; onChange?: (v: number | null) => void }) {
  const [value, setValue] = useState<number | null>(initial);
  return (
    <LevelSlider
      value={value}
      label="Lead times"
      side={side}
      onChange={(v) => {
        setValue(v);
        onChange?.(v);
      }}
    />
  );
}

describe("plain labels", () => {
  it("describe demand as growth and supply as loose/tight", () => {
    expect(plainLabel(2, "demand")).toBe("Favorable: clear growth");
    expect(plainLabel(-3, "demand")).toBe("Strongly unfavorable: sharp decline");
    expect(plainLabel(-2, "supply")).toBe("Unfavorable: tight");
    expect(plainLabel(3, "supply")).toBe("Strongly favorable: very loose");
    expect(plainLabel(0, "supply")).toBe("Neutral: normal");
    expect(plainLabel(null, "demand")).toBe("No data");
  });
});

describe("LevelSlider", () => {
  it("shows no data differently from 0", () => {
    const { unmount } = render(<LevelSlider value={null} onChange={() => {}} label="x" side="demand" />);
    const slider = screen.getByRole("slider");
    expect(slider).not.toHaveAttribute("aria-valuenow");
    expect(slider).toHaveAttribute("aria-valuetext", "No data");
    expect(slider).toHaveClass("none");
    expect(screen.getByTestId("level-number")).toHaveTextContent("No data");
    expect(screen.getByTestId("level-text")).toHaveTextContent("Nothing known yet");
    expect(screen.getByText("Strongly unfavorable")).toBeInTheDocument(); // scale ends are words, not -3/+3
    expect(screen.queryByRole("button", { name: /clear/i })).toBeNull();
    unmount();

    render(<LevelSlider value={0} onChange={() => {}} label="x" side="demand" />);
    const zero = screen.getByRole("slider");
    expect(zero).toHaveAttribute("aria-valuenow", "0");
    expect(zero).toHaveAttribute("aria-valuetext", "Neutral: flat");
    expect(zero).not.toHaveClass("none");
    expect(screen.getByTestId("level-number")).toHaveTextContent("Neutral");
    expect(screen.getByTestId("level-text")).toHaveTextContent("flat");
    expect(screen.getByRole("button", { name: "Clear to no data" })).toBeInTheDocument();
  });

  it("arrow keys set a value from no data and move by one step, clamped; labels follow the side", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<Controlled initial={null} onChange={onChange} />);
    const slider = screen.getByRole("slider");
    slider.focus();
    await user.keyboard("{ArrowRight}");
    expect(onChange).toHaveBeenLastCalledWith(1);
    expect(slider).toHaveAttribute("aria-valuetext", "Slightly favorable: easing");
    expect(screen.getByTestId("level-number")).toHaveTextContent("Slightly favorable");
    expect(document.body.textContent).not.toMatch(/[+−-][1-3]/);
    await user.keyboard("{End}{ArrowRight}");
    expect(slider).toHaveAttribute("aria-valuenow", "3");
    await user.keyboard("{Home}{ArrowRight}");
    expect(slider).toHaveAttribute("aria-valuetext", "Unfavorable: tight");
    expect(screen.getByTestId("level-number")).toHaveTextContent("Unfavorable");
    expect(screen.getByTestId("level-text")).toHaveTextContent("tight");
  });

  it("Enter on no data sets 0; the Clear link and the Delete key go back to no data", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<Controlled initial={null} side="demand" onChange={onChange} />);
    const slider = screen.getByRole("slider");
    slider.focus();
    await user.keyboard("{Enter}");
    expect(onChange).toHaveBeenLastCalledWith(0);
    expect(slider).toHaveAttribute("aria-valuenow", "0");

    await user.click(screen.getByRole("button", { name: "Clear to no data" }));
    expect(onChange).toHaveBeenLastCalledWith(null);
    expect(slider).toHaveAttribute("aria-valuetext", "No data");

    slider.focus();
    await user.keyboard("{ArrowLeft}");
    expect(onChange).toHaveBeenLastCalledWith(-1);
    await user.keyboard("{Delete}");
    expect(onChange).toHaveBeenLastCalledWith(null);
    expect(slider).not.toHaveAttribute("aria-valuenow");
  });
});
