import { describe, expect, it } from "vitest";

import { a2uiConfigForFeature } from "./a2ui-catalogs";

describe("a2uiConfigForFeature", () => {
  it("provides the shared declarative catalog for generation and recovery", () => {
    const declarative = a2uiConfigForFeature("declarative-gen-ui");
    const recovery = a2uiConfigForFeature("a2ui-recovery");

    expect(declarative?.catalog?.id).toBe("declarative-gen-ui-catalog");
    expect(recovery?.catalog).toBe(declarative?.catalog);
    expect(declarative?.catalog?.components.has("Metric")).toBe(true);
    expect(declarative?.catalog?.components.has("DataTable")).toBe(true);
  });

  it("matches the React layout alignment contract", () => {
    const catalog = a2uiConfigForFeature("declarative-gen-ui")?.catalog;
    const rowSchema = catalog?.components.get("Row")?.schema;
    const columnSchema = catalog?.components.get("Column")?.schema;

    expect(
      rowSchema?.safeParse({
        gap: 16,
        align: "baseline",
        justify: "spaceBetween",
        children: [],
      }).success,
    ).toBe(true);
    expect(
      rowSchema?.safeParse({
        align: "sideways",
        justify: "around",
        children: [],
      }).success,
    ).toBe(false);
    expect(
      columnSchema?.safeParse({ align: "stretch", children: [] }).success,
    ).toBe(true);
    expect(
      columnSchema?.safeParse({ align: "sideways", children: [] }).success,
    ).toBe(false);
  });

  it("provides the fixed flight schema only on its dedicated route", () => {
    const fixed = a2uiConfigForFeature("a2ui-fixed-schema");

    expect(fixed?.catalog?.id).toBe("copilotkit://flight-fixed-catalog");
    expect(fixed?.catalog?.components.has("Airport")).toBe(true);
    expect(a2uiConfigForFeature("agentic-chat")).toBeUndefined();
  });

  it("provides the flagship dashboard catalog for Beautiful Chat", () => {
    const flagship = a2uiConfigForFeature("beautiful-chat");

    expect(flagship?.catalog?.id).toBe("copilotkit://app-dashboard-catalog");
    expect(flagship?.catalog?.components.has("FlightCard")).toBe(true);
    expect(flagship?.catalog?.components.has("Metric")).toBe(true);
    expect(flagship?.catalog?.components.has("PieChart")).toBe(true);
    expect(flagship?.catalog?.components.has("BarChart")).toBe(true);
  });
});
