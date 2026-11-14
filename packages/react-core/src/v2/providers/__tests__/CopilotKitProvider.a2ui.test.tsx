import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render } from "@testing-library/react";
import { z } from "zod";
import {
  A2UI_SCHEMA_CONTEXT_DESCRIPTION,
  buildCatalogContextValue,
  Catalog,
  basicCatalogV1,
  extractCatalogComponentSchemas,
} from "@copilotkit/a2ui-renderer";
import type { InlineCatalogSchema } from "@copilotkit/a2ui-renderer";
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

function contextValue(description: string): string | undefined {
  return Object.values(capturedCore!.context).find(
    (entry) => entry.description === description,
  )?.value;
}

function capabilitiesValue(): string | undefined {
  return contextValue(CAPABILITIES_DESCRIPTION);
}

describe("CopilotKitProvider a2ui catalog context", () => {
  it("accepts an optional catalog through the public schema export", () => {
    const extractOptional = (catalog?: Catalog<ComponentApi>) =>
      extractCatalogComponentSchemas(catalog);
    const legacy: InlineCatalogSchema = extractCatalogComponentSchemas();
    expect(extractOptional()).toEqual(legacy);
    expect(extractCatalogComponentSchemas(undefined)).toEqual(legacy);
  });

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

  it("advertises native 1.0 schemas and guidelines when opted in", () => {
    render(
      <CopilotKitProvider a2ui={{ catalog: basicCatalogV1 }}>
        <CoreCapture />
      </CopilotKitProvider>,
    );
    const entries = Object.values(capturedCore!.context);
    const schema = JSON.parse(
      entries.find(
        (entry) => entry.description === A2UI_SCHEMA_CONTEXT_DESCRIPTION,
      )!.value,
    );
    expect(schema.protocolVersion).toBe("1.0");
    const guidelines = entries.find(
      (entry) => entry.description === GENERATION_GUIDELINES_DESCRIPTION,
    )!.value;
    expect(guidelines).toContain("Generate A2UI 1.0 JSON.");
    expect(guidelines).toContain('"@path"');
    expect(guidelines).toContain('"@call"');
    expect(guidelines).toContain(
      'children: { componentId: "card-id", path: "/items" }',
    );
    expect(guidelines).not.toContain("Generate A2UI v0.9 JSON");
    expect(guidelines).not.toContain('"value": { "path":');
  });

  it("retains the legacy generation guideline for existing catalogs", () => {
    render(
      <CopilotKitProvider a2ui={{ catalog: makeCustomCatalog() }}>
        <CoreCapture />
      </CopilotKitProvider>,
    );
    const guidelines = Object.values(capturedCore!.context).find(
      (entry) => entry.description === GENERATION_GUIDELINES_DESCRIPTION,
    )!.value;
    expect(guidelines).toContain("Generate A2UI v0.9 JSON.");
    expect(guidelines).toContain('"value": { "path":');
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

  it("sends each custom component schema once by default, in the Component Schema entry only", () => {
    const catalog = makeCustomCatalog();
    render(
      <CopilotKitProvider a2ui={{ catalog }}>
        <CoreCapture />
      </CopilotKitProvider>,
    );

    // The Component Schema entry already carries every component, so the
    // capabilities entry only names the custom components.
    expect(capabilitiesValue()).toBe(
      buildCatalogContextValue(catalog, { includeSchema: false }),
    );
    const schema = JSON.parse(contextValue(A2UI_SCHEMA_CONTEXT_DESCRIPTION)!);
    expect(Object.keys(schema.components)).toEqual(["FlightCard", "PieChart"]);
    expect(JSON.stringify(schema.components.FlightCard)).toContain('"airline"');
    expect(JSON.stringify(schema.components.PieChart)).toContain(
      '"innerRadius"',
    );
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
