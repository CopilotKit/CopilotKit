/**
 * Regression tests for Zod tools after the Standard Schema migration.
 *
 * Covers:
 * 1. The classic agent offers a Zod tool as JSON Schema and runs `execute`
 *    with the Zod-parsed arguments (defaults applied).
 * 2. Arguments that fail a Zod check (here a URL) come back as an Error
 *    result, and `execute` does not run.
 * 3. `convertToolDefinitionsToVercelAITools` (AI SDK factories) checks the
 *    arguments with the Zod schema before `execute`, so a failed check
 *    rejects and `execute` does not run.
 */
import { describe, it, expect } from "vitest";
import { z } from "zod";
import { EventType } from "@ag-ui/client";
import { defineTool } from "../index";
import { convertToolDefinitionsToVercelAITools } from "../ai-sdk";
import {
  eventsOfType,
  requestToolNames,
  runClassicAgent,
} from "./agent-test-helpers";

/** A tool that records the parsed arguments of each call. */
function recordingTool<TParameters extends z.ZodObject>(
  name: string,
  parameters: TParameters,
) {
  const calls: unknown[] = [];
  const tool = defineTool({
    name,
    description: `The ${name} tool`,
    parameters,
    execute: async (args) => {
      calls.push(args);
      return { ok: true };
    },
  });
  return { tool, calls };
}

/** Runs one model call to `tool` with `input` and returns the run's results. */
async function callTool(
  tool: ReturnType<typeof recordingTool>["tool"],
  input: unknown,
) {
  const { events, requests } = await runClassicAgent({ tools: [tool] }, [
    { toolCalls: [{ id: "tc-1", name: tool.name, input }] },
  ]);
  const offered = requests[0]?.tools?.find((t) => t.name === tool.name);
  const result = eventsOfType(events, EventType.TOOL_CALL_RESULT)[0]?.content;
  return { offered, result };
}

describe("BuiltInAgent with Zod tools", () => {
  it("offers a nested Zod schema as JSON Schema and applies its defaults before execute", async () => {
    const { tool, calls } = recordingTool(
      "complexTool",
      z.object({
        query: z.string().describe("Search query"),
        filters: z
          .object({
            category: z.enum(["books", "movies", "music"]).optional(),
            minRating: z.number().min(0).max(5).optional(),
            tags: z.array(z.string()).optional(),
          })
          .optional(),
        pagination: z
          .object({
            page: z.number().int().positive().default(1),
            perPage: z.number().int().positive().default(20),
          })
          .optional(),
      }),
    );

    const { offered, result } = await callTool(tool, {
      query: "dune",
      filters: { category: "books", tags: ["sci-fi"] },
      pagination: {},
    });

    expect(offered?.inputSchema).toMatchObject({
      type: "object",
      properties: {
        query: { type: "string", description: "Search query" },
        filters: {
          type: "object",
          properties: {
            category: { enum: ["books", "movies", "music"] },
            minRating: { type: "number", minimum: 0, maximum: 5 },
            tags: { type: "array", items: { type: "string" } },
          },
        },
      },
      required: ["query"],
    });
    expect(calls).toEqual([
      {
        query: "dune",
        filters: { category: "books", tags: ["sci-fi"] },
        pagination: { page: 1, perPage: 20 },
      },
    ]);
    expect(result).toBe('{"ok":true}');
  });

  it("runs a discriminated union tool with the chosen variant", async () => {
    const { tool, calls } = recordingTool(
      "actionTool",
      z.object({
        action: z.discriminatedUnion("type", [
          z.object({ type: z.literal("search"), query: z.string() }),
          z.object({ type: z.literal("navigate"), url: z.url() }),
          z.object({
            type: z.literal("execute"),
            code: z.string(),
            language: z.enum(["javascript", "python"]),
          }),
        ]),
      }),
    );
    const action = { type: "navigate", url: "https://copilotkit.ai" };

    await callTool(tool, { action });

    expect(calls).toEqual([{ action }]);
  });

  it("answers arguments that fail a Zod check with an Error result instead of running execute", async () => {
    const { tool, calls } = recordingTool(
      "navigate",
      z.object({ url: z.url() }),
    );

    const { result } = await callTool(tool, { url: "not a url" });

    expect(calls).toEqual([]);
    expect(result).toBe(
      'Error: Input validation failed for tool navigate: Validation failed: Invalid URL\nReceived arguments: {"url":"not a url"}',
    );
  });

  it("passes nullable and record fields through to execute", async () => {
    const { tool, calls } = recordingTool(
      "flexTool",
      z.object({
        title: z.string(),
        description: z.string().nullable(),
        metadata: z.record(z.string(), z.unknown()).optional(),
      }),
    );
    const args = {
      title: "Report",
      description: null,
      metadata: { owner: "ops", priority: 2 },
    };

    await callTool(tool, args);

    expect(calls).toEqual([args]);
  });

  it("offers Zod tools alongside the built-in state tools", async () => {
    const search = recordingTool("search", z.object({ query: z.string() }));
    const calculate = recordingTool(
      "calculate",
      z.object({
        expression: z.string(),
        precision: z.number().int().optional(),
      }),
    );

    const { requests } = await runClassicAgent({
      tools: [search.tool, calculate.tool],
    });

    expect(requestToolNames(requests[0]!)).toEqual([
      "search",
      "calculate",
      "AGUISendStateSnapshot",
      "AGUISendStateDelta",
    ]);
  });
});

describe("convertToolDefinitionsToVercelAITools Zod regression", () => {
  it("rejects arguments that fail a Zod check instead of running execute", async () => {
    const { tool, calls } = recordingTool(
      "navigate",
      z.object({ url: z.url() }),
    );

    const aiTool = convertToolDefinitionsToVercelAITools([tool]).navigate;
    const run = aiTool?.execute?.(
      { url: "not a url" },
      { toolCallId: "tc-1", messages: [] },
    );

    await expect(run).rejects.toThrow(
      "Invalid arguments for tool navigate: Invalid URL",
    );
    expect(calls).toEqual([]);
  });
});
