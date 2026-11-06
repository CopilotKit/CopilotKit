/**
 * Config tools (`tools` with `execute`) run on the server: the fake model
 * calls them, the real `chat()` runs their `execute`, and the result goes
 * back as a TOOL_CALL_RESULT. Frontend tools have no executor and stay with
 * the client. A throwing `execute` is pinned in tool-error.test.ts. A
 * `defineTool()` tool also runs in a plain TanStack AI `chat()` call.
 */
import { describe, it, expect } from "vitest";
import { z } from "zod";
import { EventType } from "@ag-ui/client";
import { chat, maxIterations } from "@tanstack/ai";
import { defineTool } from "../index";
import {
  createFakeModel,
  eventsOfType,
  requestToolNames,
  runClassicAgent,
} from "./agent-test-helpers";

/** A tool that records the arguments of each call and returns `result`. */
function recordingTool<TParameters extends z.ZodObject>(
  name: string,
  parameters: TParameters,
  result: unknown,
) {
  const calls: unknown[] = [];
  const tool = defineTool({
    name,
    description: `The ${name} tool`,
    parameters,
    execute: async (args) => {
      calls.push(args);
      return result;
    },
  });
  return { tool, calls };
}

describe("Config tools with execute", () => {
  it("offers the tool to the model with its description and JSON Schema", async () => {
    const weatherTool = defineTool({
      name: "getWeather",
      description: "Get weather for a city",
      parameters: z.object({
        city: z.string().describe("The city name"),
        units: z.enum(["celsius", "fahrenheit"]).optional(),
      }),
      execute: async () => ({ temperature: 72 }),
    });

    const { requests } = await runClassicAgent({ tools: [weatherTool] });

    const offered = requests[0]?.tools?.find((t) => t.name === "getWeather");
    expect(offered?.description).toBe("Get weather for a city");
    expect(offered?.inputSchema).toMatchObject({
      type: "object",
      properties: {
        city: { type: "string", description: "The city name" },
        units: { type: "string", enum: ["celsius", "fahrenheit"] },
      },
      required: ["city"],
    });
    expect(offered?.execute).toBeTypeOf("function");
  });

  it("runs execute with the model's arguments and returns its result as JSON", async () => {
    const weather = recordingTool(
      "getWeather",
      z.object({
        city: z.string(),
        units: z.enum(["celsius", "fahrenheit"]),
      }),
      { weather: "sunny", temp: 72 },
    );

    const { events } = await runClassicAgent({ tools: [weather.tool] }, [
      {
        toolCalls: [
          {
            id: "tool-call-1",
            name: "getWeather",
            input: { city: "New York", units: "fahrenheit" },
          },
        ],
      },
    ]);

    expect(weather.calls).toEqual([{ city: "New York", units: "fahrenheit" }]);
    expect(eventsOfType(events, EventType.TOOL_CALL_RESULT)).toEqual([
      expect.objectContaining({
        toolCallId: "tool-call-1",
        content: '{"weather":"sunny","temp":72}',
      }),
    ]);
  });

  it("runs each of several config tools with its own arguments", async () => {
    const weather = recordingTool(
      "getWeather",
      z.object({ city: z.string() }),
      {
        temp: 72,
      },
    );
    const search = recordingTool("search", z.object({ query: z.string() }), {
      results: [],
    });

    const { events } = await runClassicAgent(
      { tools: [weather.tool, search.tool] },
      [
        {
          toolCalls: [
            { id: "c1", name: "getWeather", input: { city: "Oslo" } },
            { id: "c2", name: "search", input: { query: "fjords" } },
          ],
        },
      ],
    );

    expect(weather.calls).toEqual([{ city: "Oslo" }]);
    expect(search.calls).toEqual([{ query: "fjords" }]);
    expect(
      eventsOfType(events, EventType.TOOL_CALL_RESULT).map((e) => [
        e.toolCallId,
        e.content,
      ]),
    ).toEqual([
      ["c1", '{"temp":72}'],
      ["c2", '{"results":[]}'],
    ]);
  });
});

describe("Config tools vs input tools", () => {
  it("runs the config tool on the server and leaves the input tool to the client", async () => {
    const server = recordingTool("serverTool", z.object({ data: z.string() }), {
      result: "server",
    });

    const { events, requests } = await runClassicAgent(
      { tools: [server.tool] },
      [
        {
          toolCalls: [
            { id: "c1", name: "serverTool", input: { data: "x" } },
            { id: "c2", name: "clientTool", input: { input: "y" } },
          ],
        },
      ],
      {
        tools: [
          {
            name: "clientTool",
            description: "Runs on client",
            parameters: {
              type: "object",
              properties: { input: { type: "string" } },
            },
          },
        ],
      },
    );

    const offered = requests[0]?.tools ?? [];
    expect(offered.find((t) => t.name === "serverTool")?.execute).toBeTypeOf(
      "function",
    );
    expect(offered.find((t) => t.name === "clientTool")?.execute).toBe(
      undefined,
    );
    expect(server.calls).toEqual([{ data: "x" }]);
    expect(
      eventsOfType(events, EventType.TOOL_CALL_RESULT).map((e) => e.toolCallId),
    ).toEqual(["c1"]);
  });
});

describe("defineTool in a plain TanStack AI chat() call", () => {
  it("runs execute with the parsed arguments and returns its result", async () => {
    const weather = recordingTool(
      "getWeather",
      z.object({ city: z.string(), units: z.string().default("celsius") }),
      { temp: 21 },
    );
    const { model } = createFakeModel([
      {
        toolCalls: [
          { id: "tc-1", name: "getWeather", input: { city: "Oslo" } },
        ],
      },
      {},
    ]);

    const chunks = [];
    const stream = chat({
      adapter: model,
      messages: [{ role: "user", content: "weather?" }],
      tools: [weather.tool],
      agentLoopStrategy: maxIterations(2),
      threadId: "thread-1",
      stream: true,
    });
    for await (const chunk of stream) chunks.push(chunk);

    expect(weather.calls).toEqual([{ city: "Oslo", units: "celsius" }]);
    expect(
      chunks.find((chunk) => chunk.type === "TOOL_CALL_RESULT"),
    ).toMatchObject({ toolCallId: "tc-1", content: '{"temp":21}' });
  });
});

describe("Built-in state tools still work", () => {
  it("offers the state tools, with executors, after the config tools", async () => {
    const my = recordingTool("myTool", z.object({}), {});

    const { requests } = await runClassicAgent({ tools: [my.tool] }, [{}], {
      state: { value: 1 },
    });

    const request = requests[0]!;
    expect(requestToolNames(request)).toEqual([
      "myTool",
      "AGUISendStateSnapshot",
      "AGUISendStateDelta",
    ]);
    expect(request.tools?.every((t) => typeof t.execute === "function")).toBe(
      true,
    );
  });
});

describe("Multi-step execution (maxSteps)", () => {
  it("stops after maxSteps model calls even when the model keeps calling tools", async () => {
    const chain = recordingTool("chainTool", z.object({}), {});
    const callChain = (id: string) => ({
      toolCalls: [{ id, name: "chainTool", input: {} }],
    });

    const { requests } = await runClassicAgent(
      { tools: [chain.tool], maxSteps: 3 },
      [callChain("c1"), callChain("c2"), callChain("c3"), { text: "never" }],
    );

    expect(requests).toHaveLength(3);
    expect(chain.calls).toHaveLength(3);
  });
});
