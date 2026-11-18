import { describe, expect, it } from "vitest";
import { effectScope, ref } from "vue";
import { z } from "zod";
import {
  GENERATIVE_UI_MARKDOWN_GUIDELINES_DESCRIPTION,
  GENERATIVE_UI_MARKDOWN_SCHEMA_CONTEXT_DESCRIPTION,
} from "@copilotkit/shared";
import type {
  GenerativeUIJSONSchema,
  GenerativeUIManifest,
} from "@copilotkit/shared";
import {
  createGenerativeUIDispatcher,
  GenerativeUISurfaceManager,
} from "@copilotkit/core/generative-ui";
import type { AnyGenerativeUI } from "@copilotkit/shared/generative-ui";
import { CopilotKitCoreVue } from "../../lib/vue-core";
import { createGenerativeUI } from "../catalog";
import {
  buildCompactGenerativeUISchema,
  useGenerativeUIMarkdownContext,
} from "../markdown/context";
import { CapturingAgent, runOnce } from "./helpers/capturing-agent";

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

describe("useGenerativeUIMarkdownContext (Vue-specific semantics)", () => {
  const ui = createGenerativeUI({
    id: "shop",
    components: {
      Button: { component: () => null, props: z.object({ label: z.string() }) },
    },
  });

  function setup(options: { agentIds?: string[] } = {}) {
    CapturingAgent.inputs = [];
    const agent = new CapturingAgent();
    const other = new CapturingAgent();
    const copilotkit = new CopilotKitCoreVue({
      agents__unsafe_dev_only: { default: agent, other },
    });
    // The engine's `ui` type takes function and class components only.
    const engineUI: AnyGenerativeUI = ui;
    const manager = new GenerativeUISurfaceManager(engineUI);
    const dispatcher = createGenerativeUIDispatcher({
      getDeclared: () => ui.functions,
    });
    const enabled = ref(true);
    const scope = effectScope();
    scope.run(() =>
      useGenerativeUIMarkdownContext(
        copilotkit,
        { ui: engineUI, manager, dispatcher },
        { enabled, agentIds: () => options.agentIds },
      ),
    );
    /** The context entries that core holds now, by description. */
    const entries = () =>
      Object.values(copilotkit.context).map(({ description }) => description);
    /** The value of the schema entry. */
    const schema = () =>
      Object.values(copilotkit.context).find(
        ({ description }) =>
          description === GENERATIVE_UI_MARKDOWN_SCHEMA_CONTEXT_DESCRIPTION,
      )?.value;
    return {
      agent,
      other,
      copilotkit,
      manager,
      enabled,
      scope,
      entries,
      schema,
    };
  }

  it("sends the guideline and the schema only to the agents in agentIds", async () => {
    const { copilotkit, agent, other } = setup({ agentIds: ["default"] });

    const listed = await runOnce(copilotkit, agent);
    const unlisted = await runOnce(copilotkit, other);

    expect(listed.context.map(({ description }) => description)).toEqual([
      GENERATIVE_UI_MARKDOWN_GUIDELINES_DESCRIPTION,
      GENERATIVE_UI_MARKDOWN_SCHEMA_CONTEXT_DESCRIPTION,
    ]);
    expect(unlisted.context).toEqual([]);
  });

  it("removes the entries when enabled turns false, and adds them when it turns true", async () => {
    const { enabled, entries } = setup();

    enabled.value = false;
    await Promise.resolve();
    expect(entries()).toEqual([]);

    enabled.value = true;
    await Promise.resolve();
    expect(entries()).toEqual([
      GENERATIVE_UI_MARKDOWN_GUIDELINES_DESCRIPTION,
      GENERATIVE_UI_MARKDOWN_SCHEMA_CONTEXT_DESCRIPTION,
    ]);
  });

  it("builds the schema again when a target mounts", () => {
    const { manager, schema } = setup();
    expect(schema()).not.toContain("recommendations");

    manager.registerTarget("recommendations", {
      description: "Next to the product list.",
    });

    expect(schema()).toContain(
      "recommendations (inline): Next to the product list.",
    );
  });

  it("removes the entries when the effect scope is disposed", () => {
    const { scope, entries } = setup();

    scope.stop();

    expect(entries()).toEqual([]);
  });
});
