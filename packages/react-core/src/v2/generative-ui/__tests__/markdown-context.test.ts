import { describe, expect, it } from "vitest";
import { GENERATIVE_UI_MARKDOWN_GUIDELINES } from "@copilotkit/shared";
import { createGenerativeUIDispatcher } from "../dispatcher";
import { buildGenerativeUIManifest } from "../manifest";
import { standardUI } from "../standard";
import { GenerativeUISurfaceManager } from "../surface-manager";
import type {
  GenerativeUIJSONSchema,
  GenerativeUIManifest,
} from "@copilotkit/shared";
import { buildCompactGenerativeUISchema } from "../markdown/context";

function createManifest(
  overrides?: Partial<GenerativeUIManifest>,
): GenerativeUIManifest {
  return {
    catalogId: "shop",
    components: {},
    functions: {},
    targets: [{ id: "chat", kind: "chat" }],
    surfaces: {},
    ...overrides,
  };
}

/** The compact type of one optional prop with this schema. */
function compactPropOf(schema: GenerativeUIJSONSchema) {
  const compact = buildCompactGenerativeUISchema(
    createManifest({
      components: {
        Box: { props: { type: "object", properties: { value: schema } } },
      },
    }),
  );
  return compact.components.Box.props["value?"];
}

describe("buildCompactGenerativeUISchema", () => {
  it("keeps the catalog id, targets, and surfaces, and makes each component and function short", () => {
    const manifest = createManifest({
      components: {
        Button: {
          description: "A clickable button",
          props: {
            type: "object",
            properties: {
              label: { type: "string", description: "Shown on the button" },
              size: { enum: ["sm", "md"] },
            },
            required: ["label"],
          },
          events: {
            press: { description: "The user pressed it", parameters: {} },
            hover: {
              parameters: {
                type: "object",
                properties: { x: { type: "number" } },
                required: ["x"],
              },
            },
          },
          slots: { icon: "single" },
        },
      },
      functions: {
        addToCart: {
          description: "Adds an item to the cart",
          parameters: {
            type: "object",
            properties: { sku: { type: "string" } },
            required: ["sku"],
          },
        },
      },
      targets: [
        { id: "chat", kind: "chat" },
        { id: "sidebar", kind: "inline", description: "Next to the cart" },
      ],
      surfaces: {
        s1: {
          target: "sidebar",
          dataModel: { "/qty": 2 },
          rejected: ['operation 1: unknown component "Missing"'],
        },
      },
    });

    expect(buildCompactGenerativeUISchema(manifest)).toEqual({
      catalogId: "shop",
      targets: [
        { id: "chat", kind: "chat" },
        { id: "sidebar", kind: "inline", description: "Next to the cart" },
      ],
      functions: {
        addToCart: {
          description: "Adds an item to the cart",
          parameters: "{ sku: string }",
        },
      },
      components: {
        Button: {
          description: "A clickable button",
          props: {
            label: "string // Shown on the button",
            "size?": '"sm" | "md"',
          },
          events: { press: "The user pressed it", hover: "{ x: number }" },
          slots: { icon: "single" },
        },
      },
      surfaces: {
        s1: {
          target: "sidebar",
          dataModel: { "/qty": 2 },
          rejected: ['operation 1: unknown component "Missing"'],
        },
      },
    });
  });

  it("leaves out the description, events, and slots of a component that has none", () => {
    const manifest = createManifest({
      components: { Box: { props: {} } },
      functions: { refresh: { parameters: {} } },
    });

    const compact = buildCompactGenerativeUISchema(manifest);

    expect(compact.components).toStrictEqual({ Box: { props: {} } });
    expect(compact.functions).toStrictEqual({
      refresh: { parameters: "unknown" },
    });
  });

  it.each<[string, GenerativeUIJSONSchema, string]>([
    ["a const", { const: "sm" }, '"sm"'],
    [
      "a union of variants",
      { anyOf: [{ type: "string" }, { type: "integer" }] },
      "string | number",
    ],
    ["a list of types", { type: ["string", "null"] }, "string | null"],
    [
      "a list of a union",
      { type: "array", items: { enum: ["a", "b"] } },
      '("a" | "b")[]',
    ],
    ["a list with no item schema", { type: "array" }, "unknown[]"],
    [
      "a map",
      { type: "object", additionalProperties: { type: "boolean" } },
      "Record<string, boolean>",
    ],
    ["an object with no properties", { type: "object" }, "object"],
    [
      "an object nested past the depth limit",
      {
        type: "object",
        properties: {
          inner: { type: "object", properties: { deep: { type: "string" } } },
        },
      },
      "{ inner?: object }",
    ],
    ["a schema with no type", {}, "unknown"],
  ])("writes %s as a short type", (_name, schema, expected) => {
    expect(compactPropOf(schema)).toBe(expected);
  });
});

function compactStandardSchema() {
  const manager = new GenerativeUISurfaceManager(standardUI);
  const dispatcher = createGenerativeUIDispatcher({
    getDeclared: () => standardUI.functions,
  });
  const manifest = buildGenerativeUIManifest(
    { ui: standardUI, manager, dispatcher },
    undefined,
  );
  return buildCompactGenerativeUISchema(manifest);
}

describe("buildCompactGenerativeUISchema with standardUI", () => {
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
    const schema = JSON.stringify(compactStandardSchema());
    expect(schema.length).toBeLessThan(52_000);
    expect(
      schema.length + GENERATIVE_UI_MARKDOWN_GUIDELINES.length,
    ).toBeLessThan(56_000);
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

  it("says when the agent may call an app function", () => {
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
  });

  it("explains commonProps in the guideline", () => {
    expect(GENERATIVE_UI_MARKDOWN_GUIDELINES).toContain("includesCommonProps");
  });
});
