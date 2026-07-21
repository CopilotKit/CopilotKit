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

  it("provides the fixed flight schema only on its dedicated route", () => {
    const fixed = a2uiConfigForFeature("a2ui-fixed-schema");

    expect(fixed?.catalog?.id).toBe("copilotkit://flight-fixed-catalog");
    expect(fixed?.catalog?.components.has("Airport")).toBe(true);
    expect(a2uiConfigForFeature("agentic-chat")).toBeUndefined();
  });
});
