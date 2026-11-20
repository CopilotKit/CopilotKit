import { Component } from "@angular/core";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import {
  A2UI_CHILD_LIST_REF,
  A2UI_COMPONENT_ID_REF,
  GENERATIVE_UI_FUNCTIONS,
} from "@copilotkit/shared";
import type { StandardSchemaV1 } from "@copilotkit/shared";
import {
  argsSchemaFromSignature,
  exportA2UICatalog,
} from "@copilotkit/shared/generative-ui";
import { createGenerativeUI } from "../catalog";
import { standardUI } from "../standard";

@Component({ template: "" })
class Card {}

const COMMON = "common_types.json#/$defs/";
const ref = (name: string) => ({ $ref: `${COMMON}${name}` });

describe("exportA2UICatalog", () => {
  const catalog = exportA2UICatalog(standardUI, {
    title: "Standard",
    instructions: "Use Row and Column for layout.",
  });

  it("is a 1.0 catalog definition with every component and function listed in $defs, and survives JSON", () => {
    expect(catalog.protocolVersion).toBe("1.0");
    expect(catalog.catalogId).toBe(standardUI.id);
    expect(catalog.title).toBe("Standard");
    expect(catalog.instructions).toBe("Use Row and Column for layout.");
    const names = Object.keys(catalog.components);
    expect(names).toHaveLength(standardUI.components.size);
    expect(names).not.toContain("Surface");
    expect(catalog.$defs.anyComponent).toEqual({
      oneOf: names.map((name) => ({ $ref: `#/components/${name}` })),
      discriminator: { propertyName: "component" },
    });
    expect(catalog.$defs.anyFunction.oneOf!.map((entry) => entry.$ref)).toEqual(
      Object.keys(catalog.functions).map((name) => `#/functions/${name}`),
    );
    expect(JSON.parse(JSON.stringify(catalog))).toEqual(catalog);
  });

  it("writes component as a const, keeps references, and lets every other prop be a value, a binding or a call", () => {
    const tabs = catalog.components.Tabs;
    expect(tabs!.type).toBe("object");
    expect(tabs!.required).toEqual(["component", "tabs"]);
    const properties = tabs!.properties as Record<string, any>;
    expect(properties.component).toEqual({ const: "Tabs" });
    // The list of tabs is data, so it can be bound; the panel of a tab is a reference.
    expect(properties.tabs.anyOf[1]).toEqual(ref("DataBinding"));
    expect(properties.tabs.anyOf[2]).toEqual(ref("FunctionCall"));
    // Inside the list, each tab is dynamic too, and its title as well; the
    // panel stays a reference.
    const tab = properties.tabs.anyOf[0].items;
    expect(tab.anyOf[1]).toEqual(ref("DataBinding"));
    expect(tab.anyOf[0].properties.title.anyOf).toEqual([
      { type: "string" },
      ref("DataBinding"),
      ref("FunctionCall"),
    ]);
    expect(tab.anyOf[0].properties.child).toEqual({
      $ref: A2UI_COMPONENT_ID_REF,
      description: expect.any(String),
    });
    // A check condition is a function call at depth two.
    const checks = (catalog.components.Button!.properties as any).checks;
    expect(
      checks.anyOf[0].items.anyOf[0].properties.condition.anyOf[2],
    ).toEqual(ref("FunctionCall"));
    const column = catalog.components.Column!.properties as Record<string, any>;
    expect(column.children).toEqual({ $ref: A2UI_CHILD_LIST_REF });
    expect(catalog.components.Column!.required).toEqual(["component"]);
    const button = catalog.components.Button!.properties as Record<string, any>;
    expect(button.child).toEqual({ $ref: A2UI_COMPONENT_ID_REF });
    expect(button.onClick).toEqual({
      $ref: `${COMMON}Action`,
      description: expect.any(String),
    });
    expect(button.label.anyOf[0]).toEqual({ type: "string" });
    expect(catalog.components.Button!.description).toEqual(expect.any(String));
  });

  it("describes the built-in functions with their return type, callers and typed args", () => {
    const required = catalog.functions.required;
    expect(required).toEqual({
      type: "object",
      description: GENERATIVE_UI_FUNCTIONS.required!.description,
      returnType: "validationResult",
      allowedCallers: "rendererOnly",
      requiresUserActivation: false,
      properties: {
        "@call": { const: "required" },
        args: {
          type: "object",
          properties: { value: ref("DynamicValue") },
          required: ["value"],
          additionalProperties: false,
        },
      },
      required: ["@call", "args"],
    });
    expect(catalog.functions.openUrl).toMatchObject({
      returnType: "void",
      allowedCallers: "rendererOnly",
      requiresUserActivation: true,
    });
    // The metaschema's activation rule matches an entry without the key,
    // so every entry writes the value out.
    expect(catalog.functions.formatNumber!.requiresUserActivation).toBe(false);
    // A list arg can be bound as a whole.
    const and = catalog.functions.and!.properties as Record<string, any>;
    expect(and.args.properties.values).toEqual({
      anyOf: [
        { type: "array", items: ref("DynamicBoolean") },
        ref("DataBinding"),
        ref("FunctionCall"),
      ],
    });
    const length = catalog.functions.length!.properties as Record<string, any>;
    expect(length.args.properties.min).toEqual(ref("DynamicNumber"));
    expect(length.args.required).toEqual(["value"]);
    const calc = catalog.functions.calc!.properties as Record<string, any>;
    expect(calc.args.additionalProperties).toEqual({
      anyOf: [
        ref("DynamicNumber"),
        ref("DynamicString"),
        ref("DynamicBoolean"),
      ],
    });
    expect(catalog.functions.series!.returnType).toBe("array");
    expect(Object.keys(catalog.functions)).toEqual(
      Object.keys(GENERATIVE_UI_FUNCTIONS),
    );
  });

  it("describes declared functions from their schema, with the default callers written out, and lets one shadow a built-in", () => {
    const ui = createGenerativeUI({
      id: "acme/shop@1",
      functions: {
        addToCart: {
          description: "Add a product to the cart",
          parameters: z.object({ productId: z.string(), quantity: z.number() }),
          returnType: "object",
        },
        track: {
          parameters: z.object({ event: z.string() }),
          allowedCallers: "rendererOnly",
        },
        formatNumber: { parameters: z.object({ value: z.number() }) },
      },
      components: {},
    });
    const { functions } = exportA2UICatalog(ui);
    expect(functions.addToCart).toEqual({
      type: "object",
      description: "Add a product to the cart",
      returnType: "object",
      allowedCallers: "rendererOnly",
      requiresUserActivation: false,
      properties: {
        "@call": { const: "addToCart" },
        // Each arg may be bound or computed, as the renderer resolves them.
        args: {
          type: "object",
          properties: {
            productId: {
              anyOf: [
                { type: "string" },
                ref("DataBinding"),
                ref("FunctionCall"),
              ],
            },
            quantity: {
              anyOf: [
                { type: "number" },
                ref("DataBinding"),
                ref("FunctionCall"),
              ],
            },
          },
          required: ["productId", "quantity"],
          additionalProperties: false,
        },
      },
      required: ["@call", "args"],
    });
    expect(functions.track).toMatchObject({
      returnType: "any",
      allowedCallers: "rendererOnly",
    });
    expect(functions.formatNumber).toMatchObject({
      allowedCallers: "rendererOnly",
      properties: {
        args: {
          properties: { value: { anyOf: [{ type: "number" }, {}, {}] } },
        },
      },
    });
    expect(functions.formatNumber!.description).toBeUndefined();
  });

  it("requires args only when an arg is required, escapes names in references, keeps literal defaults, and walks intersections", () => {
    const ui = createGenerativeUI({
      id: "acme/app@1",
      functions: {
        ping: { parameters: z.object({}) },
        "acme/locate": {
          parameters: z.intersection(
            z.object({ city: z.string() }),
            z.object({ zoom: z.number().optional() }),
          ),
        },
      },
      components: {
        "acme/Card": {
          component: Card,
          props: z.object({
            tags: z
              .object({ items: z.array(z.string()) })
              .default({ items: ["a"] }),
            default: z.tuple([z.string(), z.number()]),
          }),
        },
      },
    });
    const catalog = exportA2UICatalog(ui);
    expect(catalog.functions.ping!.required).toEqual(["@call"]);
    expect(catalog.functions.ping!.requiresUserActivation).toBe(false);
    expect(catalog.functions["acme/locate"]!.required).toEqual([
      "@call",
      "args",
    ]);
    expect(catalog.$defs.anyComponent.oneOf).toEqual([
      { $ref: "#/components/acme~1Card" },
    ]);
    expect(catalog.$defs.anyFunction.oneOf).toContainEqual({
      $ref: "#/functions/acme~1locate",
    });
    const tags = (catalog.components["acme/Card"]!.properties as any).tags;
    expect(tags.anyOf[0].default).toEqual({ items: ["a"] });
    // A prop named like a literal keyword is still a schema.
    const defaultProp = (catalog.components["acme/Card"]!.properties as any)
      .default;
    expect(defaultProp.anyOf[0].prefixItems).toHaveLength(2);
    expect(defaultProp.anyOf[0].items).toBeUndefined();
    expect(tags.anyOf[0].properties.items.anyOf[0].items.anyOf[1]).toEqual(
      ref("DataBinding"),
    );
    const locate = (catalog.functions["acme/locate"]!.properties as any).args;
    expect(locate.allOf[0].properties.city.anyOf[1]).toEqual(
      ref("DataBinding"),
    );
  });

  it("requires args when every variant of a union requires a key, and rebases the local references of an embedded schema", () => {
    const withDefs = {
      "~standard": {
        version: 1,
        vendor: "custom",
        validate: (value: unknown) => ({ value }),
        jsonSchema: {
          input: () => ({
            type: "object",
            properties: { point: { $ref: "#/$defs/Point" } },
            required: ["point"],
            $defs: {
              Point: {
                type: "object",
                properties: { lat: { type: "number" } },
              },
            },
          }),
        },
      },
    } as unknown as StandardSchemaV1<
      Record<string, unknown>,
      Record<string, unknown>
    >;
    const ui = createGenerativeUI({
      id: "acme/geo@1",
      functions: {
        lookup: {
          parameters: z.union([
            z.object({ id: z.string() }),
            z.object({ query: z.string() }),
          ]),
        },
        maybe: {
          parameters: z.union([z.object({ id: z.string() }), z.object({})]),
        },
        locate: { parameters: withDefs },
      },
      components: {
        Pin: { component: Card, props: withDefs },
      },
    });
    const catalog = exportA2UICatalog(ui);
    expect(catalog.functions.lookup!.required).toEqual(["@call", "args"]);
    // A recursive schema refers to its own root with "#".
    const tree = exportA2UICatalog(
      createGenerativeUI({
        id: "t",
        functions: {
          plant: {
            parameters: {
              ...withDefs,
              "~standard": {
                ...withDefs["~standard"],
                jsonSchema: {
                  input: () => ({
                    type: "object",
                    properties: {
                      children: { type: "array", items: { $ref: "#" } },
                    },
                  }),
                },
              },
            } as unknown as StandardSchemaV1<
              Record<string, unknown>,
              Record<string, unknown>
            >,
          },
        },
        components: {},
      }),
    );
    const plant = (tree.functions.plant!.properties as any).args;
    expect(plant.properties.children.anyOf[0].items.anyOf[0]).toEqual({
      $ref: "#/functions/plant/properties/args",
    });
    expect(catalog.functions.maybe!.required).toEqual(["@call"]);
    const args = (catalog.functions.locate!.properties as any).args;
    expect(args.properties.point.anyOf[0]).toEqual({
      $ref: "#/functions/locate/properties/args/$defs/Point",
    });
    expect(args.$defs.Point.properties.lat.anyOf[0]).toEqual({
      type: "number",
    });
    const pin = catalog.components.Pin as any;
    expect(pin.properties.point.anyOf[0]).toEqual({
      $ref: "#/components/Pin/$defs/Point",
    });
    // The definitions are value positions too.
    expect(pin.$defs.Point.properties.lat.anyOf).toEqual([
      { type: "number" },
      ref("DataBinding"),
      ref("FunctionCall"),
    ]);
  });

  it("writes draft 2020-12 for tuples, makes record values dynamic, and matches nothing for an empty component set", () => {
    const ui = createGenerativeUI({
      id: "acme/geo@1",
      functions: {
        locate: {
          parameters: z.object({
            point: z.tuple([z.number(), z.number()]),
            labels: z.record(z.string(), z.string()),
          }),
        },
      },
      components: {},
    });
    const catalog = exportA2UICatalog(ui);
    expect(catalog.$defs.anyComponent).toEqual({
      not: {},
      discriminator: { propertyName: "component" },
    });
    const args = (catalog.functions.locate!.properties as any).args;
    expect(args.properties.point.anyOf[0]).toEqual({
      type: "array",
      minItems: 2,
      maxItems: 2,
      prefixItems: [
        {
          anyOf: [{ type: "number" }, ref("DataBinding"), ref("FunctionCall")],
        },
        {
          anyOf: [{ type: "number" }, ref("DataBinding"), ref("FunctionCall")],
        },
      ],
    });
    expect(JSON.stringify(catalog)).not.toContain('"items":[');
    expect(args.properties.labels.anyOf[0]).toEqual({
      type: "object",
      additionalProperties: {
        anyOf: [{ type: "string" }, ref("DataBinding"), ref("FunctionCall")],
      },
    });
    // A record by key pattern, as another converter writes it.
    const byPattern = exportA2UICatalog(
      createGenerativeUI({
        id: "p",
        functions: {
          read: {
            parameters: {
              "~standard": {
                version: 1,
                vendor: "custom",
                validate: (value: unknown) => ({ value }),
                jsonSchema: {
                  input: () => ({
                    type: "object",
                    properties: {
                      readings: {
                        type: "object",
                        patternProperties: { "^a": { type: "number" } },
                      },
                    },
                  }),
                },
              },
            } as unknown as StandardSchemaV1<
              Record<string, unknown>,
              Record<string, unknown>
            >,
          },
        },
        components: {},
      }),
    );
    const read = (byPattern.functions.read!.properties as any).args;
    expect(
      read.properties.readings.anyOf[0].patternProperties["^a"].anyOf[1],
    ).toEqual(ref("DataBinding"));
  });
});

describe("argsSchemaFromSignature", () => {
  it("reads named args, optional marks, unions, lists and an index signature", () => {
    expect(
      argsSchemaFromSignature(
        "{ value: string | number; format: string; values?: boolean[]; tags?: string[]; item: unknown }",
      ),
    ).toEqual({
      type: "object",
      properties: {
        value: { anyOf: [ref("DynamicString"), ref("DynamicNumber")] },
        format: ref("DynamicString"),
        values: {
          anyOf: [
            { type: "array", items: ref("DynamicBoolean") },
            ref("DataBinding"),
            ref("FunctionCall"),
          ],
        },
        tags: ref("DynamicStringList"),
        item: ref("DynamicValue"),
      },
      required: ["value", "format", "item"],
      additionalProperties: false,
    });
    expect(
      argsSchemaFromSignature("{ count: number; [name: string]: unknown }"),
    ).toEqual({
      type: "object",
      properties: { count: ref("DynamicNumber") },
      required: ["count"],
      additionalProperties: ref("DynamicValue"),
    });
    expect(argsSchemaFromSignature("{}")).toEqual({
      type: "object",
      properties: {},
      additionalProperties: false,
    });
  });
});
