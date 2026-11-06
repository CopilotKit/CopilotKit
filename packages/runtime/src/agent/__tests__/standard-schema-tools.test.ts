/**
 * Config tools built with any Standard Schema library (Zod, Valibot, ArkType)
 * run in the classic agent: the model sees their JSON Schema, and `execute`
 * gets the arguments parsed by the tool's own schema. The AI SDK helper for
 * factories (`convertToolDefinitionsToVercelAITools`) accepts them too.
 */
import { describe, it, expect } from "vitest";
import { z } from "zod";
import * as v from "valibot";
import { toStandardJsonSchema } from "@valibot/to-json-schema";
import { type } from "arktype";
import { EventType } from "@ag-ui/client";
import { defineTool } from "../index";
import { convertToolDefinitionsToVercelAITools } from "../ai-sdk";
import {
  eventsOfType,
  requestToolNames,
  runClassicAgent,
} from "./agent-test-helpers";

/** One `search` tool per schema library, all recording into `calls`. */
function searchTools() {
  const calls: unknown[] = [];
  const execute = async (args: { query: string }) => {
    calls.push(args);
    return { found: args.query };
  };
  const tools = {
    zod: defineTool({
      name: "zodSearch",
      description: "Search (Zod)",
      parameters: z.object({ query: z.string() }),
      execute,
    }),
    valibot: defineTool({
      name: "valibotSearch",
      description: "Search (Valibot)",
      parameters: toStandardJsonSchema(v.object({ query: v.string() })),
      execute,
    }),
    arktype: defineTool({
      name: "arktypeSearch",
      description: "Search (ArkType)",
      // `type()` validates its definition only under `strict`, which this
      // package's tsconfig turns off; `type.raw()` builds the same schema.
      parameters: type.raw({ query: "string" }),
      execute,
    }),
  };
  return { tools, calls };
}

const LIBRARIES = ["zod", "valibot", "arktype"] as const;

describe("BuiltInAgent with Standard Schema tools", () => {
  it.each(LIBRARIES)(
    "offers a %s tool as JSON Schema and runs its execute",
    async (library) => {
      const { tools, calls } = searchTools();
      const tool = tools[library];

      const { events, requests } = await runClassicAgent({ tools: [tool] }, [
        {
          toolCalls: [
            { id: "tc-1", name: tool.name, input: { query: "cats" } },
          ],
        },
      ]);

      const offered = requests[0]?.tools?.find((t) => t.name === tool.name);
      expect(offered?.inputSchema).toMatchObject({
        type: "object",
        properties: { query: { type: "string" } },
        required: ["query"],
      });
      expect(calls).toEqual([{ query: "cats" }]);
      expect(eventsOfType(events, EventType.TOOL_CALL_RESULT)).toEqual([
        expect.objectContaining({ content: '{"found":"cats"}' }),
      ]);
    },
  );

  it("gives execute the Valibot output, with its defaults applied", async () => {
    const calls: unknown[] = [];
    const tool = defineTool({
      name: "searchValibot",
      description: "Search with a default limit",
      parameters: toStandardJsonSchema(
        v.object({ query: v.string(), limit: v.optional(v.number(), 5) }),
      ),
      execute: async (args) => {
        calls.push(args);
        return {};
      },
    });

    await runClassicAgent({ tools: [tool] }, [
      { toolCalls: [{ id: "tc-1", name: tool.name, input: { query: "x" } }] },
    ]);

    expect(calls).toEqual([{ query: "x", limit: 5 }]);
  });

  it("mixes Zod, Valibot, and ArkType tools in one agent, before the state tools", async () => {
    const { tools } = searchTools();

    const { requests } = await runClassicAgent({
      tools: [tools.zod, tools.valibot, tools.arktype],
    });

    expect(requestToolNames(requests[0]!)).toEqual([
      "zodSearch",
      "valibotSearch",
      "arktypeSearch",
      "AGUISendStateSnapshot",
      "AGUISendStateDelta",
    ]);
  });
});

describe("convertToolDefinitionsToVercelAITools", () => {
  it("converts Zod, Valibot, and ArkType tool definitions in order", () => {
    const { tools } = searchTools();

    const aiTools = convertToolDefinitionsToVercelAITools([
      tools.zod,
      tools.valibot,
      tools.arktype,
    ]);

    expect(Object.keys(aiTools)).toEqual([
      "zodSearch",
      "valibotSearch",
      "arktypeSearch",
    ]);
    for (const library of LIBRARIES) {
      const tool = tools[library];
      expect(aiTools[tool.name]?.description).toBe(tool.description);
      expect(aiTools[tool.name]?.inputSchema).toBeDefined();
      expect(aiTools[tool.name]?.execute).toBeTypeOf("function");
    }
  });
});
