import { describe, it, expect, vi } from "vitest";
import { CopilotKitCore } from "../core";

describe("CopilotKitCore catalog components", () => {
  it("registers a component list readable via catalogComponents", () => {
    const core = new CopilotKitCore({});
    core.setCatalogComponents([
      { name: "PieChart", schema: { type: "object" } },
      { name: "FlightCard", description: "flight", schema: { type: "object" } },
    ]);
    expect(core.catalogComponents.map((c) => c.name)).toEqual([
      "PieChart",
      "FlightCard",
    ]);
    expect(core.catalogComponents[1]!.description).toBe("flight");
  });

  it("treats every component as enabled by default", () => {
    const core = new CopilotKitCore({});
    core.setCatalogComponents([{ name: "PieChart", schema: {} }]);
    expect(core.isCatalogComponentEnabled("PieChart")).toBe(true);
    expect(core.isCatalogComponentEnabled("Unknown")).toBe(true);
  });

  it("disables and re-enables a component", () => {
    const core = new CopilotKitCore({});
    core.setCatalogComponents([{ name: "PieChart", schema: {} }]);
    core.setCatalogComponentEnabled("PieChart", false);
    expect(core.isCatalogComponentEnabled("PieChart")).toBe(false);
    core.setCatalogComponentEnabled("PieChart", true);
    expect(core.isCatalogComponentEnabled("PieChart")).toBe(true);
  });

  it("preserves disabled state across setCatalogComponents re-registration", () => {
    const core = new CopilotKitCore({});
    core.setCatalogComponents([{ name: "PieChart", schema: {} }]);
    core.setCatalogComponentEnabled("PieChart", false);
    core.setCatalogComponents([
      { name: "PieChart", schema: {} },
      { name: "Badge", schema: {} },
    ]);
    expect(core.isCatalogComponentEnabled("PieChart")).toBe(false);
    expect(core.isCatalogComponentEnabled("Badge")).toBe(true);
  });

  it("notifies subscribers via onCatalogComponentsChanged on register and toggle", () => {
    const core = new CopilotKitCore({});
    const onCatalogComponentsChanged = vi.fn();
    core.subscribe({ onCatalogComponentsChanged });
    core.setCatalogComponents([{ name: "PieChart", schema: {} }]);
    core.setCatalogComponentEnabled("PieChart", false);
    expect(onCatalogComponentsChanged).toHaveBeenCalledTimes(2);
    const last = onCatalogComponentsChanged.mock.calls.at(-1)![0];
    expect(last.copilotkit).toBe(core);
    expect(last.catalogComponents.map((c: { name: string }) => c.name)).toEqual([
      "PieChart",
    ]);
  });
});
