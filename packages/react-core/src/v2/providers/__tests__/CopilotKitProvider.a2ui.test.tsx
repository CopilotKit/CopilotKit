import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render } from "@testing-library/react";
import { z } from "zod";
import {
  A2UI_SCHEMA_CONTEXT_DESCRIPTION,
  buildCatalogContextValue,
  Catalog,
} from "@copilotkit/a2ui-renderer";
import { randomUUID } from "@copilotkit/shared";
import type { CopilotKitCore } from "@copilotkit/core";
import { CopilotKitProvider, useCopilotKit } from "../CopilotKitProvider";

// `@a2ui/web_core` is not a direct dependency of react-core, so mirror the
// minimal `ComponentApi` shape locally (see copilotkit-provider-catalog.test).
type ComponentApi = { name: string; schema: z.ZodType<any> };

const CAPABILITIES_DESCRIPTION =
  "A2UI catalog capabilities: available catalog IDs and custom component definitions the client can render.";
const GENERATION_GUIDELINES_DESCRIPTION =
  "A2UI generation guidelines — protocol rules, tool arguments, path rules, data model format, and form/two-way-binding instructions.";
const DESIGN_GUIDELINES_DESCRIPTION =
  "A2UI design guidelines — visual design rules, component hierarchy tips, and action handler patterns.";

function makeCustomCatalog(): Catalog<ComponentApi> {
  return new Catalog<ComponentApi>(
    "copilotkit://custom-catalog",
    [
      { name: "FlightCard", schema: z.object({ airline: z.string() }) },
      {
        name: "PieChart",
        schema: z.object({ innerRadius: z.number().optional() }),
      },
    ],
    [],
  );
}

let capturedCore: CopilotKitCore | null = null;
function CoreCapture() {
  const { copilotkit } = useCopilotKit();
  capturedCore = copilotkit;
  return null;
}

function contextDescriptions(): string[] {
  return Object.values(capturedCore!.context).map((entry) => entry.description);
}

function capabilitiesValue(): string | undefined {
  return Object.values(capturedCore!.context).find(
    (entry) => entry.description === CAPABILITIES_DESCRIPTION,
  )?.value;
}

describe("CopilotKitProvider a2ui catalog context", () => {
  beforeEach(() => {
    capturedCore = null;
    // The shared test setup pins randomUUID to a single value, which would make
    // every context entry overwrite the previous one in `copilotkit.context`.
    let next = 0;
    vi.mocked(randomUUID).mockImplementation(() => `a2ui-context-${next++}`);
  });

  afterEach(() => {
    vi.mocked(randomUUID).mockImplementation(() => "mock-thread-id");
  });

  it("lists custom components by name only when includeSchema is false", () => {
    render(
      <CopilotKitProvider
        a2ui={{ catalog: makeCustomCatalog(), includeSchema: false }}
      >
        <CoreCapture />
      </CopilotKitProvider>,
    );

    expect(capabilitiesValue()).toBe(
      [
        "Available A2UI catalog:",
        "- copilotkit://custom-catalog",
        "  Custom catalog (does NOT include all basic components).",
        "  Custom components:",
        "  - FlightCard",
        "  - PieChart",
      ].join("\n"),
    );
    expect(contextDescriptions()).toEqual([CAPABILITIES_DESCRIPTION]);
  });

  it("includes custom component schemas by default, unchanged from before includeSchema", () => {
    const catalog = makeCustomCatalog();
    render(
      <CopilotKitProvider a2ui={{ catalog }}>
        <CoreCapture />
      </CopilotKitProvider>,
    );

    const value = capabilitiesValue();
    // The single-argument call is what the provider sent before includeSchema
    // was threaded through, so the default output stays byte-identical.
    expect(value).toBe(buildCatalogContextValue(catalog));
    expect(value).toContain("  - FlightCard:\n    {");
    expect(value).toContain('"airline"');
    expect(value).toContain('"innerRadius"');
    expect(contextDescriptions().sort()).toEqual(
      [
        CAPABILITIES_DESCRIPTION,
        A2UI_SCHEMA_CONTEXT_DESCRIPTION,
        GENERATION_GUIDELINES_DESCRIPTION,
        DESIGN_GUIDELINES_DESCRIPTION,
      ].sort(),
    );
  });
});
