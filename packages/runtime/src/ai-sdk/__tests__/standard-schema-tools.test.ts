/**
 * Standard Schema tools (Zod, Valibot, ArkType) in `aiSdkAgent`, ported from
 * the classic BuiltInAgent `standard-schema-tools.test.ts`.
 */
import { describe, expect, it } from "vitest";
import { EventType } from "@ag-ui/client";
import { asSchema } from "ai";
import { type } from "arktype";
import * as v from "valibot";
import { toStandardJsonSchema } from "@valibot/to-json-schema";
import { z } from "zod";
import { defineTool } from "../../agent";
import { eventField } from "../../agent/__tests__/agent-test-helpers";
import { aiSdkAgent } from "../agent";
import { convertToolDefinitionsToVercelAITools } from "../tools";
import {
  eventsOfType,
  modelEmitting,
  offeredToolNames,
  runAgent,
  textTurn,
  toolCallTurn,
} from "./mock-model";

const toolCallOptions = { toolCallId: "tool-call-1", messages: [] };

/** The JSON Schema every `queryTool` parameters schema describes. */
const queryJsonSchema = {
  type: "object",
  properties: { query: { type: "string" } },
  required: ["query"],
};

/** A tool with one string `query` parameter that echoes it. */
function queryTool(vendor: "zod" | "valibot" | "arktype") {
  const execute = async ({ query }: { query: string }) => ({ echoed: query });
  const name = `${vendor}Tool`;
  const description = `A tool with a ${vendor} schema`;
  switch (vendor) {
    case "zod":
      return defineTool({
        name,
        description,
        parameters: z.object({ query: z.string() }),
        execute,
      });
    case "valibot":
      return defineTool({
        name,
        description,
        parameters: toStandardJsonSchema(v.object({ query: v.string() })),
        execute,
      });
    case "arktype":
      return defineTool({
        name,
        description,
        // `type.raw` skips ArkType's inference, which needs `strict`; this
        // package compiles without it.
        parameters: type.raw({ query: "string" }),
        execute,
      });
  }
}

const vendors = ["zod", "valibot", "arktype"] as const;

describe("defineTool with Standard Schema libraries", () => {
  it.each(vendors)("keeps a %s schema", (vendor) => {
    const tool = queryTool(vendor);

    expect(tool.parameters["~standard"].vendor).toBe(vendor);
  });
});

describe("convertToolDefinitionsToVercelAITools with Standard Schema", () => {
  it.each(vendors)(
    "converts a %s tool with its description, JSON Schema, and execute",
    async (vendor) => {
      const aiTools = convertToolDefinitionsToVercelAITools([
        queryTool(vendor),
      ]);

      const aiTool = aiTools[`${vendor}Tool`];
      expect(aiTool.description).toBe(`A tool with a ${vendor} schema`);
      expect(await asSchema(aiTool.inputSchema).jsonSchema).toMatchObject(
        queryJsonSchema,
      );
      await expect(
        aiTool.execute?.({ query: "cats" }, toolCallOptions),
      ).resolves.toEqual({ echoed: "cats" });
    },
  );

  it("keeps the order of mixed schema types", () => {
    const aiTools = convertToolDefinitionsToVercelAITools(
      vendors.map(queryTool),
    );

    expect(Object.keys(aiTools)).toEqual([
      "zodTool",
      "valibotTool",
      "arktypeTool",
    ]);
  });
});

describe("aiSdkAgent with Standard Schema tools", () => {
  it.each(vendors)(
    "offers a %s tool as JSON Schema and runs it",
    async (vendor) => {
      const model = modelEmitting(
        toolCallTurn("tc-1", `${vendor}Tool`, { query: "cats" }),
      );

      const events = await runAgent(
        aiSdkAgent({ model, tools: [queryTool(vendor)] }),
      );

      const offered = model.doStreamCalls[0].tools?.find(
        (tool) => tool.name === `${vendor}Tool`,
      );
      expect(offered).toMatchObject({ inputSchema: queryJsonSchema });
      const result = eventsOfType(events, EventType.TOOL_CALL_RESULT)[0];
      expect(eventField(result, "content")).toBe('{"echoed":"cats"}');
    },
  );

  it("mixes Zod, Valibot, and ArkType tools next to the state tools", async () => {
    const model = modelEmitting(textTurn("ok"));

    await runAgent(aiSdkAgent({ model, tools: vendors.map(queryTool) }));

    expect(offeredToolNames(model)).toEqual([
      "AGUISendStateSnapshot",
      "AGUISendStateDelta",
      "zodTool",
      "valibotTool",
      "arktypeTool",
    ]);
  });
});
