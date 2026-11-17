import { describe, expect, it } from "vitest";
import {
  defaultGenerativeUIPromptSpec,
  GENERATIVE_UI_AGENT_FUNCTION_CALLS,
  GENERATIVE_UI_FUNCTIONS,
  GENERATIVE_UI_MARKDOWN_GUIDELINES,
  renderGenerativeUISchema,
} from "@copilotkit/shared";
import type { GenerativeUIJSONSchema } from "@copilotkit/shared";
import {
  buildGenerativeUIManifest,
  createGenerativeUIDispatcher,
  GenerativeUISurfaceManager,
} from "@copilotkit/core/generative-ui";
import { exportA2UICatalog } from "@copilotkit/shared/generative-ui";
import type { AnyGenerativeUI } from "@copilotkit/shared/generative-ui";
import { buildCompactGenerativeUISchema } from "../../markdown/context";
import { standardUI } from "../index";

// The `describe("buildCompactGenerativeUISchema with standardUI")` block of
// React's `__tests__/markdown-context.test.ts`, with the Vue standardUI. The
// rest of that file is ported in `__tests__/markdown-context.test.ts`.

function standardManifest() {
  // The engine's `ui` type takes function and class components only.
  const engineUI: AnyGenerativeUI = standardUI;
  const manager = new GenerativeUISurfaceManager(engineUI);
  const dispatcher = createGenerativeUIDispatcher({
    getDeclared: () => standardUI.functions,
  });
  return buildGenerativeUIManifest(
    { ui: engineUI, manager, dispatcher },
    undefined,
  );
}

function compactStandardSchema() {
  return buildCompactGenerativeUISchema(standardManifest());
}

/** The schema text that ships: the standard components in the default notation. */
function shippedStandardSchema() {
  return renderGenerativeUISchema(
    standardManifest(),
    defaultGenerativeUIPromptSpec().schema.markdown,
  );
}

describe("buildCompactGenerativeUISchema with standardUI", () => {
  it("preserves chart and series guidance in the exported catalog and compact schema", () => {
    const catalog = exportA2UICatalog(standardUI);
    const compact = compactStandardSchema();
    const properties: Record<string, GenerativeUIJSONSchema> =
      catalog.components.Chart.properties ?? {};
    const axis = String(properties.yAxis?.description);
    // The fields are in the type; the description only explains them.
    expect(compact.components.Chart.props["yAxis?"]).toContain(
      "{ label?: string; min?: number; max?: number; width?: number }",
    );
    expect(axis).toContain('label: "Revenue (USD)"');
    expect(axis).toContain("horizontal axis");
    expect(axis).toContain("width sets the category axis width");
    expect(axis).not.toContain("width: 64");
    expect(compact.components.Chart.props["yAxis?"]).toContain(axis);

    const format = String(properties.format?.description);
    expect(format).toContain("data values and axis min/max");
    expect(format).toContain("0.4");
    expect(format).toContain("40%");
    expect(format).toContain("max: 0.1");
    expect(compact.components.Chart.props["format?"]).toContain(format);
    expect(catalog.functions.series.description).toBe(
      GENERATIVE_UI_FUNCTIONS.series.description,
    );
    expect(compact.functions.series.description).toBe(
      GENERATIVE_UI_FUNCTIONS.series.description,
    );
  });

  it("lists the props that many components share once, in commonProps", () => {
    const schema = compactStandardSchema();
    const common = schema.commonProps ?? {};
    // The layout props of every container.
    expect(Object.keys(common)).toEqual(
      expect.arrayContaining(["gap?", "padding?", "border?", "radius?"]),
    );
    expect(schema.components.Column.includesCommonProps).toBe(true);
    expect(schema.components.Column.props).not.toHaveProperty("gap?");
    expect(schema.components.Card.includesCommonProps).toBe(true);
    expect(schema.components.Card.props).toHaveProperty("variant?");
    // A component without the layout props keeps all of its own.
    expect(schema.components.Text.includesCommonProps).toBeUndefined();
    expect(schema.components.Text.props).toHaveProperty("text?");
  });

  it("keeps the schema and the guideline of the standard components small", () => {
    // About 38k and 14k characters today (13.0k o200k tokens together).
    const schema = shippedStandardSchema();
    expect(schema.length).toBeLessThan(40_000);
    expect(
      schema.length + GENERATIVE_UI_MARKDOWN_GUIDELINES.length,
    ).toBeLessThan(54_000);
  });

  it("lists the built-in functions with their signatures, from the manifest", () => {
    const schema = compactStandardSchema();
    expect(schema.functions.formatCurrency).toEqual({
      description: expect.stringContaining("ISO 4217"),
      parameters:
        "{ value: number; currency: string; decimals?: number; grouping?: boolean }",
    });
    expect(schema.functions.calc.parameters).toContain("expression: string");
  });

  it.skipIf(GENERATIVE_UI_AGENT_FUNCTION_CALLS)(
    "writes no callers while the agent path is off",
    () => {
      const schema = buildCompactGenerativeUISchema({
        catalogId: "shop",
        components: {},
        targets: [],
        surfaces: {},
        functions: {
          reload: {
            parameters: { type: "number" },
            allowedCallers: "agentOnly",
          },
        },
      });
      expect(schema.functions).toEqual({ reload: { parameters: "number" } });
    },
  );

  it.skipIf(!GENERATIVE_UI_AGENT_FUNCTION_CALLS)(
    "says when the agent may call an app function",
    () => {
      const n = { type: "number" };
      const schema = buildCompactGenerativeUISchema({
        catalogId: "shop",
        components: {},
        targets: [],
        surfaces: {},
        functions: {
          addToCart: { parameters: n, allowedCallers: "rendererOrAgent" },
          track: { parameters: n, allowedCallers: "rendererOnly" },
          reload: { parameters: n, allowedCallers: "agentOnly" },
          share: { parameters: n, requiresUserActivation: true },
        },
      });
      // No mark means the UI only, the default; the marks are for the agent.
      expect(schema.functions).toEqual({
        addToCart: { parameters: "number", callers: "UI or agent" },
        track: { parameters: "number" },
        reload: { parameters: "number", callers: "agent only" },
        share: { parameters: "number" },
      });
    },
  );

  it("explains the common props of the lines schema in the guideline", () => {
    expect(GENERATIVE_UI_MARKDOWN_GUIDELINES).toContain("+common");
  });
});
