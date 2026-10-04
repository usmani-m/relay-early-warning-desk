import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { categories, demoConfig, demoInputs } from "./fixtures";

vi.mock("../api", () => ({
  ApiError: class extends Error {
    messages: string[] = [];
  },
  api: { getConfig: vi.fn(), getInputs: vi.fn(), categories: vi.fn(), putInputs: vi.fn(), putConfig: vi.fn() },
}));
const { api } = await import("../api");
const { InputsTab } = await import("../inputs/InputsTab");

const heading = () => screen.getByRole("heading", { level: 2 });
const cardsIn = (side: "demand" | "supply") => within(screen.getByRole("region", { name: side === "demand" ? "Demand side" : "Supply side" })).queryAllByRole("article");

beforeEach(() => {
  window.location.hash = "";
  vi.mocked(api.getConfig).mockResolvedValue(demoConfig());
  vi.mocked(api.getInputs).mockResolvedValue(demoInputs());
  vi.mocked(api.categories).mockResolvedValue(categories);
  vi.mocked(api.putInputs).mockImplementation(async (cards) => cards);
  vi.mocked(api.putConfig).mockImplementation(async (config) => ({ config, inputs_added: 0, inputs_removed: 0 }));
});

async function renderTab() {
  const onDirty = vi.fn();
  render(<InputsTab dataVersion={0} onDirtyChange={onDirty} onDataChanged={() => {}} />);
  await screen.findByRole("heading", { level: 2 });
  return onDirty;
}

describe("InputsTab", () => {
  it("shows the selection, the scale line and one card per active category", async () => {
    await renderTab();
    expect(heading()).toHaveTextContent("EUROPE, Infrastructure");
    expect(screen.getByText(/it is not the same as neutral/)).toBeInTheDocument();
    expect(cardsIn("demand")).toHaveLength(3);
    expect(cardsIn("supply")).toHaveLength(3);
    expect(screen.getByText("Supply applies to all EUROPE segments.")).toBeInTheDocument();
    expect(screen.queryByText(/overview/i)).toBeNull();
  });

  it("switches the selection with the Region and Segment dropdowns (no Previous/Next)", async () => {
    await renderTab();
    expect(screen.queryByRole("button", { name: /Previous|Next/ })).toBeNull();
    fireEvent.change(screen.getByLabelText("Segment"), { target: { value: "Utilities" } });
    expect(heading()).toHaveTextContent("EUROPE, Utilities");
    fireEvent.change(screen.getByLabelText("Region"), { target: { value: "GLOBAL" } });
    fireEvent.change(screen.getByLabelText("Segment"), { target: { value: "Industry" } });
    expect(heading()).toHaveTextContent("GLOBAL, Industry (global trend)");
    expect(screen.getByText("Global supply applies to all segments.")).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Region"), { target: { value: "MEA" } });
    expect(heading()).toHaveTextContent("MEA, Industry");
  });

  it("says the GLOBAL supply level is used only when the region has no supply values", async () => {
    await renderTab();
    expect(screen.getByText(/will use the GLOBAL supply level for this region/)).toHaveTextContent("No supply values for EUROPE");
    fireEvent.change(screen.getByLabelText("Region"), { target: { value: "APAC" } });
    expect(screen.queryByText(/will use the GLOBAL supply level/)).toBeNull(); // APAC has (illustrative) supply values
    fireEvent.change(screen.getByLabelText("Region"), { target: { value: "GLOBAL" } });
    expect(screen.queryByText(/will use the GLOBAL supply level/)).toBeNull();
  });

  it("changes categories inline: max 3, ABB-internal labelled, unticked values are kept", async () => {
    const user = userEvent.setup();
    const onDirty = await renderTab();
    const demand = screen.getByRole("region", { name: "Demand side" });
    await user.click(within(demand).getByRole("button", { name: "Change categories" }));
    const picker = within(demand).getByRole("group", { name: "Demand categories" });
    expect(within(picker).getAllByRole("checkbox", { checked: true })).toHaveLength(3);
    expect(within(picker).getByRole("checkbox", { name: /Industry & macro economics/ })).toBeDisabled();
    expect(within(picker).getAllByText("ABB internal")).toHaveLength(2);

    await user.click(within(picker).getByRole("checkbox", { name: /Market & policy development/ }));
    expect(cardsIn("demand")).toHaveLength(2);
    expect(screen.getByText("Unsaved changes")).toBeInTheDocument();
    expect(onDirty).toHaveBeenLastCalledWith(true);
    await user.click(within(picker).getByRole("checkbox", { name: /Industry & macro economics/ }));
    expect(cardsIn("demand")).toHaveLength(3); // a placeholder card (no data) for the new category

    await user.click(within(picker).getByRole("checkbox", { name: /Industry & macro economics/ }));
    await user.click(within(picker).getByRole("checkbox", { name: /Market & policy development/ }));
    const market = screen.getByRole("article", { name: "Market & policy development, EUROPE Infrastructure" });
    expect(within(market).getByRole("slider")).toHaveAttribute("aria-valuenow", "2"); // value kept
    expect(screen.getByText("All changes saved")).toBeInTheDocument();
  });

  it("blocks Save for an invalid source link anywhere and jumps to it", async () => {
    const user = userEvent.setup();
    await renderTab();
    const card = screen.getByRole("article", { name: "Grid plans & investments, EUROPE Infrastructure" });
    const url = within(card).getByLabelText("Source link");
    await user.clear(url);
    await user.type(url, "http://insecure.example");
    expect(within(card).getByText(/Save is blocked/)).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Segment"), { target: { value: "Utilities" } });
    expect(heading()).toHaveTextContent("EUROPE, Utilities");
    expect(screen.getByRole("button", { name: "Save" })).toBeDisabled();
    const alert = screen.getByRole("alert");
    expect(alert).toHaveTextContent("Fix 1 source link(s)");
    await user.click(within(alert).getByRole("button", { name: "EUROPE Infrastructure" }));
    expect(heading()).toHaveTextContent("EUROPE, Infrastructure");
  });

  it("saves inputs first, then only the categories in the config", async () => {
    const user = userEvent.setup();
    await renderTab();
    const supply = screen.getByRole("region", { name: "Supply side" });
    await user.click(within(supply).getByRole("button", { name: "Change categories" }));
    await user.click(within(supply).getByRole("checkbox", { name: /Pricing & cost indices/ }));
    const slider = within(cardsIn("demand")[0]).getByRole("slider");
    slider.focus();
    await user.keyboard("{ArrowLeft}");
    await user.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(api.putConfig).toHaveBeenCalled());
    expect(vi.mocked(api.putInputs).mock.invocationCallOrder[0]).toBeLessThan(vi.mocked(api.putConfig).mock.invocationCallOrder[0]);
    const sent = vi.mocked(api.putConfig).mock.calls[0][0];
    expect(sent.active_datasets).not.toContain("Pricing & cost indices");
    expect(sent.supply_dependency).toEqual(demoConfig().supply_dependency); // nothing else changed
  });
});
