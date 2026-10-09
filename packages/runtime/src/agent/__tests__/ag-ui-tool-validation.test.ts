import { asSchema } from "ai";
import { expect, test } from "vitest";
import { z } from "zod/v4";
import { convertToolsToVercelAITools } from "../index";

/** Creates the provider-facing validation boundary for an AG-UI tool. */
function setup(parameters: Record<string, unknown>) {
  const tools = convertToolsToVercelAITools([
    { name: "show_card", description: "Show a card", parameters },
  ]);
  const schema = asSchema(tools.show_card.inputSchema);
  const validate = async (value: unknown) =>
    schema.validate ? schema.validate(value) : { success: true, value };
  return { schema, validate };
}

test("AG-UI nullable fields accept null but reject wrong types and missing values", async () => {
  const { validate } = setup({
    type: "object",
    properties: { subtitle: { anyOf: [{ type: "string" }, { type: "null" }] } },
    required: ["subtitle"],
  });

  expect((await validate({ subtitle: null })).success).toBe(true);
  expect((await validate({ subtitle: "Details" })).success).toBe(true);
  expect((await validate({ subtitle: 42 })).success).toBe(false);
  expect((await validate({})).success).toBe(false);
});

test("AG-UI validates JSON Schema emitted by nullable Zod v4 fields", async () => {
  const { validate } = setup(
    z.toJSONSchema(z.object({ subtitle: z.string().nullable() })),
  );

  expect((await validate({ subtitle: null })).success).toBe(true);
  expect((await validate({ subtitle: "Details" })).success).toBe(true);
  expect((await validate({ subtitle: false })).success).toBe(false);
  expect((await validate({})).success).toBe(false);
});

test("AG-UI optional nullable array items preserve null and reject wrong types", async () => {
  const { validate } = setup({
    type: "object",
    properties: {
      values: {
        type: "array",
        items: { oneOf: [{ type: "number" }, { type: "null" }] },
      },
    },
  });

  expect((await validate({})).success).toBe(true);
  expect((await validate({ values: [1, null] })).success).toBe(true);
  expect((await validate({ values: ["invalid"] })).success).toBe(false);
});

test("AG-UI argument validation enforces references and numeric constraints", async () => {
  const { validate } = setup({
    type: "object",
    properties: {
      label: { $ref: "#/$defs/label" },
      count: { type: "integer", minimum: 1, maximum: 10 },
    },
    required: ["label", "count"],
    additionalProperties: false,
    $defs: { label: { type: "string", minLength: 1 } },
  });

  expect((await validate({ label: "Shapes", count: 2 })).success).toBe(true);
  expect((await validate({ label: "", count: 2 })).success).toBe(false);
  expect((await validate({ label: "Shapes", count: 1.5 })).success).toBe(false);
  expect((await validate({ label: "Shapes", count: 11 })).success).toBe(false);
  expect(
    (await validate({ label: "Shapes", count: 2, extra: true })).success,
  ).toBe(false);
});

test("AG-UI validation preserves open object fields without mutating arguments", async () => {
  const parameters = {
    type: "object",
    properties: { component: { type: "object" } },
    required: ["component"],
  };
  const { schema, validate } = setup(parameters);
  const value = Object.freeze({
    component: Object.freeze({ Text: Object.freeze({ text: "Hello" }) }),
  });

  const result = await validate(value);

  expect(result).toEqual({ success: true, value });
  expect(await schema.jsonSchema).toEqual(parameters);
  expect((await validate({ component: "invalid" })).success).toBe(false);
});

test("AG-UI validates modern tuple constraints", async () => {
  const { validate } = setup({
    $schema: "https://json-schema.org/draft/2020-12/schema",
    type: "object",
    properties: {
      point: {
        type: "array",
        prefixItems: [{ type: "number" }, { type: "number" }],
        items: false,
        minItems: 2,
      },
    },
    required: ["point"],
  });

  expect((await validate({ point: [1, 2] })).success).toBe(true);
  expect((await validate({ point: [1, "invalid"] })).success).toBe(false);
  expect((await validate({ point: [1, 2, 3] })).success).toBe(false);
});
