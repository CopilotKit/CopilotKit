import { AbstractAgent, EventType } from "@ag-ui/client";
import type {
  ActivitySnapshotEvent,
  BaseEvent,
  RunAgentInput,
} from "@ag-ui/client";
import {
  A2UIMiddleware,
  A2UI_SCHEMA_CONTEXT_DESCRIPTION,
} from "@ag-ui/a2ui-middleware";
import { firstValueFrom, from, toArray } from "rxjs";
import type { Observable } from "rxjs";
import { describe, expect, it } from "vitest";
import {
  A2UI_DEFAULT_DESIGN_GUIDELINES,
  A2UI_DEFAULT_GENERATION_GUIDELINES,
} from "@copilotkit/shared";
import type {
  CopilotKitUIEnvelope,
  GenerativeUIComponentManifest,
} from "@copilotkit/shared";
import {
  STANDARD_CATALOG_ID,
  createGenerativeUI,
  standardDeclarations,
  withStandardParameterOrder,
} from "@copilotkit/shared/generative-ui";
import { buildA2UIV09CatalogContext } from "../generative-ui/a2ui-v09-catalog";

class ScriptedAgent extends AbstractAgent {
  constructor(private readonly script: BaseEvent[]) {
    super();
  }
  run(): Observable<BaseEvent> {
    return from(this.script);
  }
}

// The description strings the removed v0.9 client (`@copilotkit/a2ui-renderer`)
// sent, copied from its catalog-context.ts and catalog-description.ts.
const CAPABILITIES =
  "A2UI catalog capabilities: available catalog IDs and custom component definitions the client can render.";
const SCHEMA =
  "A2UI Component Schema — available components for generating UI surfaces. Use these component names and properties when creating A2UI operations.";
const GENERATION =
  "A2UI generation guidelines — protocol rules, tool arguments, path rules, data model format, and form/two-way-binding instructions.";
const DESIGN =
  "A2UI design guidelines — visual design rules, component hierarchy tips, and action handler patterns.";

const BASIC_CATALOG_ID =
  "https://a2ui.org/specification/v0_9/basic_catalog.json";
const COMMON = "common_types.json#/$defs/";
const DATA_BINDING = { $ref: `${COMMON}DataBinding` };

/** The components of the v0.9 basic catalog, in the order of the standard catalog. */
const V09_BASIC = [
  "Column",
  "Row",
  "Card",
  "Divider",
  "Tabs",
  "Text",
  "Button",
  "TextField",
  "CheckBox",
  "Slider",
  "ChoicePicker",
  "DateTimeInput",
  "Modal",
  "List",
  "Image",
  "Icon",
  "Video",
  "AudioPlayer",
];
const FUNCTION_CALL = { $ref: `${COMMON}FunctionCall` };

/** The 1.0 manifest of the standard catalog, as the client sends it. */
const standardComponents = createGenerativeUI({
  id: STANDARD_CATALOG_ID,
  components: withStandardParameterOrder(
    Object.fromEntries(
      Object.entries(standardDeclarations).map(([name, declaration]) => [
        name,
        { ...declaration, component: () => null },
      ]),
    ) as never,
  ) as never,
}).manifestComponents;

type InlineCatalog = NonNullable<
  CopilotKitUIEnvelope["1.0"]["inlineCatalogs"]
>[number];

function envelope(
  supportedCatalogIds: string[],
  catalog: Partial<InlineCatalog> = {},
): CopilotKitUIEnvelope {
  return {
    "1.0": {
      supportedCatalogIds,
      inlineCatalogs: [
        {
          catalogId: supportedCatalogIds[0]!,
          protocolVersion: "1.0",
          components: {},
          functions: {},
          ...catalog,
        },
      ],
    },
    metadata: {
      extensions: {
        copilotkit_format: 3,
        copilotkit_transport: "tool",
        copilotkit_targets: [{ id: "chat", kind: "chat" }],
        copilotkit_surfaces: {},
        copilotkit_contextSent: false,
      },
    },
  };
}

function runInput(forwardedProps: unknown): RunAgentInput {
  return {
    threadId: "t1",
    runId: "r1",
    state: {},
    messages: [],
    tools: [],
    context: [],
    forwardedProps,
  };
}

const withUI = (ui: CopilotKitUIEnvelope) => runInput({ copilotkit: { ui } });

/** The context of a run, which the test expects to be there. */
function build(ui: CopilotKitUIEnvelope) {
  const result = buildA2UIV09CatalogContext(withUI(ui));
  if (!result) throw new Error("expected a v0.9 catalog context");
  return result;
}

interface InlineSchema {
  catalogId: string;
  components: Record<
    string,
    {
      description?: string;
      allOf: [
        { $ref: string },
        {
          properties: Record<string, Record<string, unknown>>;
          required: string[];
          $defs?: Record<string, unknown>;
        },
      ];
    }
  >;
  functions: Array<{ name: string; returnType: string; parameters: unknown }>;
  "common_types.json": { $defs: Record<string, Record<string, unknown>> };
}

function schemaOf(result: ReturnType<typeof build>) {
  const entry = result.context.find((c) => c.description === SCHEMA);
  if (!entry) throw new Error("expected a schema entry");
  return JSON.parse(entry.value) as InlineSchema;
}

const propsOf = (schema: InlineSchema, name: string) =>
  schema.components[name]!.allOf[1].properties;

const capabilitiesOf = (result: ReturnType<typeof build>) =>
  result.context.find((c) => c.description === CAPABILITIES)!.value;

const productCard: GenerativeUIComponentManifest = {
  description: 'A product. Bind name with { "@path": "/name" }',
  props: {
    type: "object",
    properties: {
      name: { type: "string", description: "The product name" },
      price: { type: "number" },
      inStock: { type: "boolean" },
      tags: { type: "array", items: { type: "string" } },
      size: { type: "string", enum: ["sm", "lg"] },
    },
    required: ["name"],
  },
  events: { onClick: { description: "Opens the product", parameters: {} } },
  slots: { footer: "single", children: "multiple" },
};

describe("buildA2UIV09CatalogContext", () => {
  it("returns undefined when the run has no generative UI envelope", () => {
    expect(buildA2UIV09CatalogContext(runInput(undefined))).toBeUndefined();
    expect(buildA2UIV09CatalogContext(runInput({}))).toBeUndefined();
    expect(
      buildA2UIV09CatalogContext(
        runInput({ copilotkit: { ui: { "1.0": {} } } }),
      ),
    ).toBeUndefined();
  });

  it("uses the description strings of the v0.9 client and of A2UIMiddleware", () => {
    const result = build(
      envelope([STANDARD_CATALOG_ID], { components: standardComponents }),
    );
    expect(result.context.map((c) => c.description)).toEqual([
      CAPABILITIES,
      SCHEMA,
      GENERATION,
      DESIGN,
    ]);
    // A2UIMiddleware finds (and can replace) the schema entry by this string.
    expect(SCHEMA).toBe(A2UI_SCHEMA_CONTEXT_DESCRIPTION);
    expect(result.context[2]!.value).toBe(A2UI_DEFAULT_GENERATION_GUIDELINES);
    expect(result.context[3]!.value).toBe(A2UI_DEFAULT_DESIGN_GUIDELINES);
  });

  describe("a UI of the standard catalog only", () => {
    const result = build(
      envelope([STANDARD_CATALOG_ID], { components: standardComponents }),
    );
    const schema = schemaOf(result);

    it("names the v0.9 basic catalog", () => {
      expect(result.catalogId).toBe(BASIC_CATALOG_ID);
      expect(schema.catalogId).toBe(BASIC_CATALOG_ID);
    });

    it("lists only the v0.9 basic components, in the v0.9 inline format", () => {
      expect(Object.keys(schema.components)).toEqual(
        Object.keys(standardComponents).filter((name) =>
          V09_BASIC.includes(name),
        ),
      );
      expect(Object.keys(schema.components).sort()).toEqual(
        [...V09_BASIC].sort(),
      );
      expect(schema.components).not.toHaveProperty("Title");
      expect(schema.components).not.toHaveProperty("Chart");
      const column = schema.components.Column!;
      expect(column.allOf[0]).toEqual({ $ref: `${COMMON}ComponentCommon` });
      expect(column.allOf[1].properties.component).toEqual({ const: "Column" });
      expect(column.allOf[1].required).toEqual(["component"]);
      expect(schema.components.Image!.allOf[1].required).toEqual([
        "component",
        "url",
      ]);
    });

    it("states props with v0.9 dynamic types and bindings", () => {
      const tabs = propsOf(schema, "Tabs");
      expect(tabs.selectedIndex).toMatchObject({
        $ref: `${COMMON}DynamicNumber`,
      });
      expect(propsOf(schema, "Image").url).toMatchObject({
        $ref: `${COMMON}DynamicString`,
      });
      expect(propsOf(schema, "CheckBox").value).toMatchObject({
        $ref: `${COMMON}DynamicBoolean`,
      });
      expect(propsOf(schema, "ChoicePicker").value).toMatchObject({
        $ref: `${COMMON}DynamicStringList`,
      });
      // A value that is not a plain primitive keeps its literal schema.
      expect(propsOf(schema, "Text").text).toEqual({
        description: "Text with inline markdown. A bound number shows as text",
        anyOf: [{ type: ["string", "number"] }, DATA_BINDING, FUNCTION_CALL],
      });
      // A component reference nested in a value stays one.
      const tab = (tabs.tabs!.anyOf as Array<Record<string, any>>)[0]!;
      expect(tab.items.properties.child.$ref).toBe(`${COMMON}ComponentId`);
    });

    it("states slots as v0.9 component ids and child lists", () => {
      expect(propsOf(schema, "Row").children).toEqual({
        $ref: `${COMMON}ChildList`,
      });
      expect(propsOf(schema, "Card").child).toEqual({
        $ref: `${COMMON}ComponentId`,
      });
      expect(propsOf(schema, "Modal").trigger).toEqual({
        $ref: `${COMMON}ComponentId`,
      });
    });

    it("renames the props that v0.9 names differently", () => {
      const button = propsOf(schema, "Button");
      expect(button.action).toEqual({
        $ref: `${COMMON}Action`,
        description: "Sent when the user clicks the button.",
      });
      expect(button).not.toHaveProperty("onClick");
      // An event without a v0.9 name keeps its 1.0 name.
      expect(propsOf(schema, "Image").onOverlayClick).toMatchObject({
        $ref: `${COMMON}Action`,
      });
    });

    it("writes binding and call examples in descriptions the v0.9 way", () => {
      const value = result.context[1]!.value;
      expect(value).not.toContain("@path");
      expect(value).not.toContain("@call");
      expect(propsOf(schema, "Tabs").selectedIndex!.description).toBe(
        'The open tab. Default 0. Bind it with { "path": "/x" } to read it',
      );
    });

    it("defines every common type it references, in v0.9 shapes", () => {
      const defs = schema["common_types.json"].$defs;
      const refs = new Set(
        [
          ...result.context[1]!.value.matchAll(
            /common_types\.json#\/\$defs\/(\w+)/g,
          ),
        ].map((match) => match[1]!),
      );
      for (const name of refs) expect(defs).toHaveProperty(name);
      expect(defs.DataBinding).toEqual({
        type: "object",
        properties: {
          path: {
            type: "string",
            description: "A JSON Pointer path to a value in the data model.",
          },
        },
        required: ["path"],
        additionalProperties: false,
      });
      expect(defs.FunctionCall!.required).toEqual(["call"]);
    });

    it("lists the basic functions under their v0.9 names and return types", () => {
      const required = schema.functions.find((fn) => fn.name === "required");
      expect(required).toMatchObject({
        returnType: "boolean",
        parameters: {
          properties: { value: { $ref: `${COMMON}DynamicValue` } },
          required: ["value"],
        },
      });
      expect(schema.functions.map((fn) => fn.name)).toContain("formatString");
    });

    it("names the basic catalog in the capabilities", () => {
      expect(capabilitiesOf(result)).toBe(
        `Available A2UI catalog:\n- ${BASIC_CATALOG_ID} (basic catalog)`,
      );
    });
  });

  describe("a UI that adds custom components to the standard catalog", () => {
    const result = build(
      envelope(["acme/app@1", STANDARD_CATALOG_ID], {
        components: { ...standardComponents, ProductCard: productCard },
      }),
    );
    const schema = schemaOf(result);

    it("names the v0.9 basic catalog", () => {
      expect(result.catalogId).toBe(BASIC_CATALOG_ID);
      expect(schema.catalogId).toBe(BASIC_CATALOG_ID);
    });

    it("states custom props from their JSON schema, bindable the v0.9 way", () => {
      const card = schema.components.ProductCard!;
      expect(card.description).toBe(
        'A product. Bind name with { "path": "/name" }',
      );
      expect(card.allOf[1].required).toEqual(["component", "name"]);
      expect(card.allOf[1].properties).toEqual({
        component: { const: "ProductCard" },
        name: {
          $ref: `${COMMON}DynamicString`,
          description: "The product name",
        },
        price: { $ref: `${COMMON}DynamicNumber` },
        inStock: { $ref: `${COMMON}DynamicBoolean` },
        tags: { $ref: `${COMMON}DynamicStringList` },
        size: {
          anyOf: [
            { type: "string", enum: ["sm", "lg"] },
            DATA_BINDING,
            FUNCTION_CALL,
          ],
        },
        // The prop map is for standard components only.
        onClick: { $ref: `${COMMON}Action`, description: "Opens the product" },
        footer: { $ref: `${COMMON}ComponentId` },
        children: { $ref: `${COMMON}ChildList` },
      });
    });

    it("lists the basic components and the custom one only", () => {
      expect(Object.keys(schema.components).sort()).toEqual(
        [...V09_BASIC, "ProductCard"].sort(),
      );
    });

    it("lists the custom component in the capabilities", () => {
      expect(capabilitiesOf(result)).toBe(
        [
          "Available A2UI catalog:",
          `- ${BASIC_CATALOG_ID}`,
          "  Extends the basic catalog with all standard components plus:",
          "  - ProductCard",
        ].join("\n"),
      );
    });
  });

  describe("a UI without the standard catalog", () => {
    const button: GenerativeUIComponentManifest = {
      props: { type: "object", properties: { label: { type: "string" } } },
      events: { onClick: { parameters: {} } },
    };
    const result = build(
      envelope(["acme/kiosk@1"], {
        components: { Button: button, ProductCard: productCard },
        functions: {
          addToCart: {
            description: 'Adds { "@path": "/item" }',
            parameters: {
              type: "object",
              properties: { id: { type: "string" } },
            },
            allowedCallers: "rendererOrAgent",
          },
          refundOrder: {
            parameters: { type: "object" },
            allowedCallers: "agentOnly",
          },
        },
      }),
    );
    const schema = schemaOf(result);

    it("names the catalog of the UI", () => {
      expect(result.catalogId).toBe("acme/kiosk@1");
      expect(schema.catalogId).toBe("acme/kiosk@1");
    });

    it("keeps the 1.0 prop names of a custom component named like a standard one", () => {
      expect(propsOf(schema, "Button")).toHaveProperty("onClick");
      expect(propsOf(schema, "Button")).not.toHaveProperty("action");
    });

    it("lists the app functions that the renderer may call", () => {
      const names = schema.functions.map((fn) => fn.name);
      expect(names).toContain("addToCart");
      expect(names).not.toContain("refundOrder");
      expect(schema.functions.find((fn) => fn.name === "addToCart")).toEqual({
        name: "addToCart",
        description: 'Adds { "path": "/item" }',
        returnType: "any",
        parameters: {
          type: "object",
          properties: { id: { $ref: `${COMMON}DynamicString` } },
        },
      });
    });

    it("says the catalog lacks basic components", () => {
      expect(capabilitiesOf(result)).toBe(
        [
          "Available A2UI catalog:",
          "- acme/kiosk@1",
          "  Custom catalog (does NOT include all basic components).",
          "  Custom components:",
          "  - ProductCard",
        ].join("\n"),
      );
    });
  });

  it("points local refs of a props schema to where it is embedded", () => {
    const tree: GenerativeUIComponentManifest = {
      props: {
        type: "object",
        properties: { root: { $ref: "#/$defs/Node" } },
        $defs: {
          Node: {
            type: "object",
            properties: {
              label: { type: "string" },
              children: { type: "array", items: { $ref: "#/$defs/Node" } },
            },
          },
        },
      },
    };
    const schema = schemaOf(
      build(envelope(["acme/tree@1"], { components: { Tree: tree } })),
    );
    const body = schema.components.Tree!.allOf[1];
    const node = "#/components/Tree/allOf/1/$defs/Node";
    expect(body.properties.root).toEqual({
      anyOf: [{ $ref: node }, DATA_BINDING, FUNCTION_CALL],
    });
    expect(body.$defs).toEqual({
      Node: {
        type: "object",
        properties: {
          label: { type: "string" },
          children: { type: "array", items: { $ref: node } },
        },
      },
    });
  });

  it("sends only the capabilities when the client left the components out", () => {
    const ui = envelope([STANDARD_CATALOG_ID]);
    delete ui["1.0"].inlineCatalogs![0]!.components;
    expect(buildA2UIV09CatalogContext(withUI(ui))).toEqual({
      catalogId: BASIC_CATALOG_ID,
      context: [
        {
          description: CAPABILITIES,
          value: `Available A2UI catalog:\n- ${BASIC_CATALOG_ID}`,
        },
      ],
    });
  });

  it("gives A2UIMiddleware the catalog id for the surfaces of render_a2ui", async () => {
    const { context } = build(
      envelope(["acme/kiosk@1"], { components: { ProductCard: productCard } }),
    );
    const args = {
      surfaceId: "s1",
      components: [{ id: "root", component: "ProductCard", name: "Lamp" }],
    };
    const agent = new ScriptedAgent([
      { type: EventType.RUN_STARTED, threadId: "t1", runId: "r1" },
      {
        type: EventType.TOOL_CALL_START,
        toolCallId: "c1",
        toolCallName: "render_a2ui",
      },
      {
        type: EventType.TOOL_CALL_ARGS,
        toolCallId: "c1",
        delta: JSON.stringify(args),
      },
      { type: EventType.TOOL_CALL_END, toolCallId: "c1" },
      { type: EventType.RUN_FINISHED, threadId: "t1", runId: "r1" },
    ] as BaseEvent[]);
    const events = await firstValueFrom(
      new A2UIMiddleware({ injectA2UITool: true })
        .run({ ...runInput(undefined), context }, agent)
        .pipe(toArray()),
    );
    const surface = events.find(
      (e): e is ActivitySnapshotEvent =>
        e.type === EventType.ACTIVITY_SNAPSHOT &&
        Array.isArray((e as ActivitySnapshotEvent).content?.a2ui_operations),
    );
    expect(surface?.content.a2ui_operations[0]).toEqual({
      version: "v0.9",
      createSurface: { surfaceId: "s1", catalogId: "acme/kiosk@1" },
    });
  });
});
