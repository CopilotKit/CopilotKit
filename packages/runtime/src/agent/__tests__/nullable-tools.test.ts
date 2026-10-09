import { expect, test } from "vitest";
import { asSchema } from "ai";
import { z as z4 } from "zod/v4";
import { convertToolsToVercelAITools } from "../index";

/** Builds the same tool boundary a frontend nullable field reaches. */
function setup(parameters: Record<string, unknown>) {
  const tools = convertToolsToVercelAITools([
    { name: "show_card", description: "Show a card", parameters },
  ]);
  const schema = asSchema(tools.show_card.inputSchema);
  if (!schema.validate) throw new Error("Expected tool argument validation");
  return { validate: schema.validate };
}

test("frontend nullable anyOf fields accept null without admitting other types", async () => {
  const { validate } = setup({
    type: "object",
    properties: {
      subtitle: { anyOf: [{ type: "string" }, { type: "null" }] },
    },
    required: ["subtitle"],
  });

  expect(await validate({ subtitle: null })).toEqual({
    success: true,
    value: { subtitle: null },
  });
  expect(await validate({ subtitle: "Details" })).toEqual({
    success: true,
    value: { subtitle: "Details" },
  });
  expect((await validate({ subtitle: 42 })).success).toBe(false);
  expect((await validate({})).success).toBe(false);
});

test("Zod v4 nullable tool fields survive their emitted JSON Schema", async () => {
  const frontend = z4.object({ subtitle: z4.string().nullable() });

  const { validate } = setup(z4.toJSONSchema(frontend));

  expect(await validate({ subtitle: null })).toEqual({
    success: true,
    value: { subtitle: null },
  });
  expect(await validate({ subtitle: "Details" })).toEqual({
    success: true,
    value: { subtitle: "Details" },
  });
  expect((await validate({ subtitle: false })).success).toBe(false);
  expect((await validate({})).success).toBe(false);
});

test("optional nullable array items preserve null and reject invalid values", async () => {
  const { validate } = setup({
    type: "object",
    properties: {
      values: {
        type: "array",
        items: { oneOf: [{ type: "number" }, { type: "null" }] },
      },
    },
  });

  expect(await validate({})).toEqual({ success: true, value: {} });
  expect(await validate({ values: [1, null] })).toEqual({
    success: true,
    value: { values: [1, null] },
  });
  expect((await validate({ values: ["invalid"] })).success).toBe(false);
});
