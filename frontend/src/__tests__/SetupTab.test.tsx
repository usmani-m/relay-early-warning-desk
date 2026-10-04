import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { structureLine } from "../setup/configEdit";
import { categories, demoConfig, demoInputs } from "./fixtures";

vi.mock("../api", () => ({
  ApiError: class extends Error {
    messages: string[] = [];
  },
  api: { getConfig: vi.fn(), getInputs: vi.fn(), categories: vi.fn(), rename: vi.fn(), putConfig: vi.fn() },
}));
const { api } = await import("../api");
const { SetupTab } = await import("../setup/SetupTab");

beforeEach(() => {
  vi.mocked(api.getConfig).mockResolvedValue(demoConfig());
  vi.mocked(api.getInputs).mockResolvedValue(demoInputs());
  vi.mocked(api.categories).mockResolvedValue(categories);
  vi.mocked(api.rename).mockImplementation(async (_k, old, n) => {
    const c = demoConfig();
    return { config: { ...c, regions: c.regions.map((r) => (r === old ? n : r)) } };
  });
});

async function renderTab(onGoInputs = vi.fn()) {
  render(<SetupTab inputsDirty={false} dataVersion={0} onDirtyChange={() => {}} onDataChanged={() => {}} onGoInputs={onGoInputs} />);
  await screen.findByRole("list", { name: "Regions" });
  return onGoInputs;
}

describe("structure summary", () => {
  it("writes one plain line per region, own share first, largest first", () => {
    const c = demoConfig();
    expect(structureLine(c, "AMER").text).toBe("AMER: 50% own, 40% APAC, 10% EUROPE");
    expect(structureLine(c, "EUROPE").text).toBe("EUROPE: 40% own, 50% APAC, 10% AMER");
    const bad = { ...c, supply_dependency: { ...c.supply_dependency, MEA: { EUROPE: 0.7, APAC: 0.4 } } };
    expect(structureLine(bad, "MEA").error).toMatch(/110%/);
  });
});

describe("SetupTab", () => {
  it("shows regions and segments as plain chips and short help", async () => {
    await renderTab();
    const regions = screen.getByRole("list", { name: "Regions" });
    expect(within(regions).getByRole("button", { name: "EUROPE" })).toHaveTextContent(/^EUROPE$/);
    expect(within(regions).queryByText(/filled/)).toBeNull();
    expect(within(regions).getByRole("button", { name: "Add region" })).toBeInTheDocument();
    expect(screen.queryByText(/A rename is saved right away/)).toBeNull(); // no long helper sentences
    await userEvent.click(screen.getByRole("button", { name: "Help: Regions" }));
    expect(screen.getByRole("status")).toHaveTextContent("Rename keeps all values");
  });

  it("chip popover: rename calls the API, delete asks with the filled-card count", async () => {
    const user = userEvent.setup();
    await renderTab();
    await user.click(screen.getByRole("button", { name: "EUROPE" }));
    const pop = screen.getByRole("dialog", { name: "EUROPE options" });
    await user.click(within(pop).getByRole("button", { name: "Rename" }));
    const input = within(pop).getByLabelText(/New name/);
    await user.clear(input);
    await user.type(input, "EU{Enter}");
    expect(api.rename).toHaveBeenCalledWith("region", "EUROPE", "EU");
    expect(await screen.findByRole("button", { name: "EU" })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "APAC" }));
    await user.click(within(screen.getByRole("dialog", { name: "APAC options" })).getByRole("button", { name: "Delete" }));
    expect(screen.getByRole("heading", { name: "Delete region APAC?" })).toBeInTheDocument();
    expect(screen.getByText("3 filled card(s)")).toBeInTheDocument();
  });

  it("lists the active categories read-only with a link to the Inputs tab", async () => {
    const onGo = await renderTab();
    expect(screen.queryByRole("checkbox", { name: /Market & policy development/ })).toBeNull();
    expect(screen.getByText(/Project pipelines & permitting, Grid plans & investments, Market & policy development/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Change on the Inputs tab" }));
    expect(onGo).toHaveBeenCalled();
  });

  it("supply chain structure is collapsed to plain lines; Edit structure opens the matrix", async () => {
    const user = userEvent.setup();
    await renderTab();
    expect(screen.getByText("AMER: 50% own, 40% APAC, 10% EUROPE")).toBeInTheDocument();
    expect(screen.getByText("Example values")).toBeInTheDocument();
    expect(screen.queryByLabelText("Share of AMER electronics sourced from APAC")).toBeNull();
    await user.click(screen.getByRole("button", { name: "Edit structure" }));
    expect(screen.getByLabelText("Share of AMER electronics sourced from APAC")).toBeInTheDocument();
    expect(screen.getByLabelText("Pool pressure factor")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Done" }));
    expect(screen.getByText("AMER: 50% own, 40% APAC, 10% EUROPE")).toBeInTheDocument();
  });
});
