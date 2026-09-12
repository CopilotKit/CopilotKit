import { expect, test } from "vitest";
import { asSchema } from "ai";
import { RENDER_A2UI_TOOL } from "@ag-ui/a2ui-middleware";
import { convertToolsToVercelAITools } from "../index";

test("A2UI component objects keep their model-visible fields open", async () => {
  const tools = convertToolsToVercelAITools([RENDER_A2UI_TOOL]);

  const schema = await asSchema(tools.render_a2ui.inputSchema).jsonSchema;

  // An omitted additionalProperties permits fields. Preserve the exact schema,
  // including its descriptions, instead of closing the component objects.
  expect(schema).toEqual(RENDER_A2UI_TOOL.parameters);
  expect(tools.render_a2ui.strict).toBe(false);
});

test("AG-UI tools preserve explicit constraints and local references", async () => {
  const parameters = {
    type: "object",
    additionalProperties: false,
    properties: {
      label: { $ref: "#/$defs/label" },
      count: { type: "integer", minimum: 1, maximum: 10 },
    },
    required: ["label", "count"],
    $defs: { label: { type: "string", minLength: 1 } },
  };

  const tools = convertToolsToVercelAITools([
    { name: "draw", description: "Draw labeled shapes", parameters },
  ]);
  const schema = await asSchema(tools.draw.inputSchema).jsonSchema;

  expect(schema).toEqual(parameters);
});

test("AG-UI tools reject an invalid schema before the model call", () => {
  const tools = [
    {
      name: "invalid",
      description: "Invalid tool",
      parameters: { invalid: true },
    },
  ];

  expect(() => convertToolsToVercelAITools(tools)).toThrow(
    "Invalid JSON schema for tool invalid",
  );
});

test("ordinary tools retain the provider's default strictness", () => {
  const tools = convertToolsToVercelAITools([
    {
      name: "lookup",
      description: "Lookup",
      parameters: { type: "object", properties: { query: { type: "string" } } },
    },
  ]);
  expect(tools.lookup).not.toHaveProperty("strict");
});
