import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { Recommendations } from "../dashboard/Recommendations";
import type { AnalysisResult } from "../result/types";
import type { Decision } from "../types";

const result: AnalysisResult = {
  as_of_date: "2026-10-04",
  recommendations: [
    { priority: 2, region: "AMER", segment: "Infrastructure", action: "flexible_commitment", horizon: "short", requires_human_approval: true },
    { priority: 1, region: "EUROPE", segment: "Utilities", action: "flexible_commitment", horizon: "medium", requires_human_approval: true },
  ],
};

/** Mimics the backend upsert so the component sees the saved decisions. */
function Harness({ onPost }: { onPost: (d: Decision) => void }) {
  const [decisions, setDecisions] = useState<Decision[]>([]);
  return (
    <Recommendations
      result={result}
      decisions={decisions}
      keep={() => true}
      onDecide={async (d) => {
        onPost(d);
        const k = (x: Decision) => [x.as_of, x.region, x.segment, x.recommendation].join("|");
        setDecisions((list) => [...list.filter((x) => k(x) !== k(d)), d]);
      }}
    />
  );
}

describe("Recommendations decision flow", () => {
  it("lists recommendations in priority order", () => {
    render(<Harness onPost={() => {}} />);
    const cards = screen.getAllByRole("article");
    expect(cards[0]).toHaveTextContent("Priority 1");
    expect(cards[0]).toHaveTextContent("EUROPE · Utilities");
  });

  it("approve, then change to adjust (note required), then reject", async () => {
    const user = userEvent.setup();
    const onPost = vi.fn();
    render(<Harness onPost={onPost} />);
    const group = () => screen.getByRole("group", { name: /EUROPE Utilities/ });
    const approve = () => screen.getAllByRole("button", { name: "Approve" })[0];

    await user.click(approve());
    expect(onPost).toHaveBeenLastCalledWith({
      as_of: "2026-10-04", region: "EUROPE", segment: "Utilities", recommendation: "flexible_commitment", decision: "approved", note: "",
    });
    expect(screen.getByTestId("decision-status")).toHaveTextContent("Approved");

    await user.click(screen.getByRole("button", { name: "Change decision" }));
    await user.click(screen.getAllByRole("button", { name: "Adjust" })[0]);
    const save = screen.getByRole("button", { name: "Save adjustment" });
    expect(save).toBeDisabled();
    expect(screen.getByText("An adjustment needs a note.")).toBeInTheDocument();
    await user.type(screen.getByLabelText(/What do you change/), "smaller volume");
    expect(save).toBeEnabled();
    await user.click(save);
    expect(onPost).toHaveBeenLastCalledWith(expect.objectContaining({ decision: "adjusted", note: "smaller volume" }));
    expect(screen.getByTestId("decision-status")).toHaveTextContent("Adjusted · smaller volume");

    await user.click(screen.getByRole("button", { name: "Change decision" }));
    expect(group()).toBeInTheDocument();
    await user.click(screen.getAllByRole("button", { name: "Reject" })[0]);
    await user.click(screen.getByRole("button", { name: "Confirm rejection" })); // the note is optional
    expect(onPost).toHaveBeenLastCalledWith(expect.objectContaining({ decision: "rejected" }));
    expect(screen.getByTestId("decision-status")).toHaveTextContent("Rejected");
    expect(onPost).toHaveBeenCalledTimes(3);
  });
});
