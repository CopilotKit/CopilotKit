import { expect, test } from "vitest";
import { z } from "zod";
import { z as z4 } from "zod/v4";
import { convertToolsToVercelAITools } from "../index";

/** Builds the same tool boundary a frontend nullable field reaches. */
function toolSchema(parameters: Record<string, unknown>) {
  const tools = convertToolsToVercelAITools([
    { name: "show_card", description: "Show a card", parameters },
  ]);
  const schema: unknown = tools.show_card.inputSchema;
  if (!(schema instanceof z.ZodType))
    throw new Error("Expected a Zod tool schema");
  return schema;
}

test("frontend nullable anyOf fields accept null without admitting other types", () => {
  const schema = toolSchema({
    type: "object",
    properties: {
      subtitle: { anyOf: [{ type: "string" }, { type: "null" }] },
    },
    required: ["subtitle"],
  });

  expect(schema.parse({ subtitle: null })).toEqual({ subtitle: null });
  expect(schema.parse({ subtitle: "Details" })).toEqual({
    subtitle: "Details",
  });
  expect(schema.safeParse({ subtitle: 42 }).success).toBe(false);
  expect(schema.safeParse({}).success).toBe(false);
});

test("Zod v4 nullable tool fields survive their emitted JSON Schema", () => {
  const frontend = z4.object({ subtitle: z4.string().nullable() });

  const schema = toolSchema(z4.toJSONSchema(frontend));

  expect(schema.parse({ subtitle: null })).toEqual({ subtitle: null });
  expect(schema.parse({ subtitle: "Details" })).toEqual({
    subtitle: "Details",
  });
  expect(schema.safeParse({ subtitle: false }).success).toBe(false);
  expect(schema.safeParse({}).success).toBe(false);
});

test("optional nullable array items preserve null and reject invalid values", () => {
  const schema = toolSchema({
    type: "object",
    properties: {
      values: {
        type: "array",
        items: { oneOf: [{ type: "number" }, { type: "null" }] },
      },
    },
  });

  expect(schema.parse({})).toEqual({});
  expect(schema.parse({ values: [1, null] })).toEqual({ values: [1, null] });
  expect(schema.safeParse({ values: ["invalid"] }).success).toBe(false);
});
