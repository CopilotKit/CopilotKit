import { describe, expect, it } from "vitest";

import { generativeUIForFeature } from "./a2ui-catalogs";

type Schema = { "~standard": { validate(value: unknown): unknown } };

/** True when `schema` accepts `value` synchronously. */
function accepts(schema: Schema | undefined, value: unknown): boolean {
  const result = schema?.["~standard"].validate(value) as
    | { issues?: unknown }
    | undefined;
  return result !== undefined && !(result instanceof Promise) && !result.issues;
}

describe("generativeUIForFeature", () => {
  it("provides the shared declarative catalog for generation and recovery", () => {
    const declarative = generativeUIForFeature("declarative-gen-ui");
    const recovery = generativeUIForFeature("a2ui-recovery");

    expect(declarative?.id).toBe("declarative-gen-ui-catalog");
    expect(recovery).toBe(declarative);
    expect(declarative?.components.has("Metric")).toBe(true);
    expect(declarative?.components.has("DataTable")).toBe(true);
  });

  it("matches the React layout alignment contract", () => {
    const ui = generativeUIForFeature("declarative-gen-ui");
    const rowSchema = ui?.components.get("Row")?.props;
    const columnSchema = ui?.components.get("Column")?.props;

    expect(
      accepts(rowSchema, {
        gap: 16,
        align: "baseline",
        justify: "spaceBetween",
      }),
    ).toBe(true);
    expect(accepts(rowSchema, { align: "sideways", justify: "around" })).toBe(
      false,
    );
    expect(accepts(columnSchema, { align: "stretch" })).toBe(true);
    expect(accepts(columnSchema, { align: "sideways" })).toBe(false);
  });

  it("provides the fixed flight schema only on its dedicated route", () => {
    const fixed = generativeUIForFeature("a2ui-fixed-schema");

    expect(fixed?.id).toBe("copilotkit://flight-fixed-catalog");
    expect(fixed?.components.has("Airport")).toBe(true);
    expect(generativeUIForFeature("agentic-chat")).toBeUndefined();
  });

  it("provides the flagship dashboard catalog for Beautiful Chat", () => {
    const flagship = generativeUIForFeature("beautiful-chat");

    expect(flagship?.id).toBe("copilotkit://app-dashboard-catalog");
    expect(flagship?.components.has("FlightCard")).toBe(true);
    expect(flagship?.components.has("Metric")).toBe(true);
    expect(flagship?.components.has("PieChart")).toBe(true);
    expect(flagship?.components.has("BarChart")).toBe(true);
  });
});
