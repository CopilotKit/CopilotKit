/**
 * `aiSdkAgent` end to end on AI SDK v6: a real `streamText` over a mock
 * LanguageModelV3, real MCP and learned-skills servers on localhost.
 */
import http from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import { EventType } from "@ag-ui/client";
import type { BaseEvent, RunAgentInput } from "@ag-ui/client";
import { jsonSchema, tool } from "ai";
import { MockLanguageModelV3, simulateReadableStream } from "ai/test";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import { defineTool } from "../../agent";
import type { BuiltInAgent } from "../../agent";
import {
  collectEvents,
  createDefaultInput,
  eventField,
} from "../../agent/__tests__/agent-test-helpers";
import { aiSdkAgent } from "../agent";
import type { AiSdkAgentConfig } from "../agent";
import fixtures from "../../../../intelligence-delivery-core/conformance/snapshots.v1.json";

type StreamPart =
  Awaited<
    ReturnType<MockLanguageModelV3["doStream"]>
  >["stream"] extends ReadableStream<infer Part>
    ? Part
    : never;

const USAGE = {
  inputTokens: { total: 1, noCache: 1, cacheRead: 0, cacheWrite: 0 },
  outputTokens: { total: 1, text: 1, reasoning: 0 },
};

const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0)) await cleanup();
});

/** Starts an HTTP server on a random local port and returns its base URL. */
async function listen(handler: http.RequestListener) {
  const server = http.createServer(handler);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  cleanups.push(
    () =>
      new Promise<void>((resolve) => {
        server.closeAllConnections();
        server.close(() => resolve());
      }),
  );
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}

/**
 * A real MCP server over SSE with one `getWeather` tool that echoes its
 * arguments. `streamClosed` resolves when the client closes its stream.
 */
async function startWeatherMcpServer() {
  const transports = new Map<string, SSEServerTransport>();
  let resolveStreamClosed = () => {};
  const streamClosed = new Promise<void>((resolve) => {
    resolveStreamClosed = resolve;
  });
  const baseUrl = await listen(async (req, res) => {
    if (req.method === "GET") {
      const transport = new SSEServerTransport("/messages", res);
      transports.set(transport.sessionId, transport);
      res.on("close", () => resolveStreamClosed());
      const mcp = new Server(
        { name: "weather", version: "1.0.0" },
        { capabilities: { tools: {} } },
      );
      mcp.setRequestHandler(ListToolsRequestSchema, () => ({
        tools: [
          {
            name: "getWeather",
            description: "Weather from MCP.",
            inputSchema: {
              type: "object",
              properties: { city: { type: "string" } },
            },
          },
        ],
      }));
      mcp.setRequestHandler(CallToolRequestSchema, (request) => ({
        content: [
          {
            type: "text",
            text: `MCP:${JSON.stringify(request.params.arguments)}`,
          },
        ],
      }));
      await mcp.connect(transport);
      return;
    }
    const sessionId = new URL(req.url ?? "/", baseUrl).searchParams.get(
      "sessionId",
    );
    const transport = transports.get(sessionId ?? "");
    if (!transport) {
      res.writeHead(404).end();
      return;
    }
    await transport.handlePostMessage(req, res);
  });
  return { url: `${baseUrl}/sse`, streamClosed };
}

/** A learned-skills delivery server that serves one skill. */
async function startSkillsServer() {
  const fixture = fixtures.cases.find((item) => item.name === "text-skill")!;
  const apiUrl = await listen((_req, res) => {
    res.writeHead(200, {
      "content-type": "application/zip",
      "x-copilotkit-skills-revision": fixture.revision,
      etag: fixture.etag,
    });
    res.end(Buffer.from(fixture.archiveBase64, "base64"));
  });
  return {
    apiKey: "test-delivery-key",
    apiUrl,
    containerId: "learning",
    freshnessWindowMs: 0,
  };
}

function finishPart(unified: "stop" | "tool-calls"): StreamPart {
  return {
    type: "finish",
    finishReason: { unified, raw: unified },
    usage: USAGE,
  };
}

function textTurn(text: string): StreamPart[] {
  return [
    { type: "text-start", id: "t1" },
    { type: "text-delta", id: "t1", delta: text },
    { type: "text-end", id: "t1" },
    finishPart("stop"),
  ];
}

function toolCallTurn(
  toolCallId: string,
  toolName: string,
  input: unknown,
): StreamPart[] {
  return [
    {
      type: "tool-call",
      toolCallId,
      toolName,
      input: JSON.stringify(input),
    },
    finishPart("tool-calls"),
  ];
}

/** A model that streams `turn` on every call. */
function modelEmitting(turn: StreamPart[]) {
  return new MockLanguageModelV3({
    doStream: async () => ({
      stream: simulateReadableStream({ chunks: turn }),
    }),
  });
}

async function runAgent(
  agent: BuiltInAgent,
  input: Partial<RunAgentInput> = {},
) {
  return collectEvents(
    agent.run(
      createDefaultInput({
        messages: [{ id: "u1", role: "user", content: "hi" }],
        ...input,
      }),
    ),
  );
}

function eventsOfType(events: BaseEvent[], type: EventType) {
  return events.filter((event) => event.type === type);
}

function runOutcome(events: BaseEvent[]) {
  const finished = events.find(
    (event) => event.type === EventType.RUN_FINISHED,
  );
  return eventField(finished!, "outcome");
}

const pingTool = defineTool({
  name: "ping",
  description: "Ping.",
  parameters: z.object({}),
  execute: async () => "pong",
});

describe("aiSdkAgent runs", () => {
  it("streams the model's text and sends the prompt as the system message", async () => {
    const model = modelEmitting(textTurn("Hello there"));
    const agent = aiSdkAgent({ model, prompt: "Be brief." });

    const events = await runAgent(agent);

    const deltas = eventsOfType(events, EventType.TEXT_MESSAGE_CHUNK).map(
      (event) => eventField(event, "delta"),
    );
    expect(deltas).toEqual(["Hello there"]);
    expect(model.doStreamCalls[0].prompt[0]).toEqual({
      role: "system",
      content: "Be brief.",
    });
  });

  it("streams a frontend tool call without running it", async () => {
    const model = modelEmitting(
      toolCallTurn("tc-1", "showCard", { title: "Hi" }),
    );
    const agent = aiSdkAgent({ model });

    const events = await runAgent(agent, {
      tools: [
        {
          name: "showCard",
          description: "Show a card.",
          parameters: {
            type: "object",
            properties: { title: { type: "string" } },
          },
        },
      ],
    });

    const start = eventsOfType(events, EventType.TOOL_CALL_START)[0];
    expect(eventField(start, "toolCallName")).toBe("showCard");
    expect(eventsOfType(events, EventType.TOOL_CALL_RESULT)).toEqual([]);
    expect(runOutcome(events)).toBeUndefined();
  });

  it("turns an AGUISendStateSnapshot call into STATE_SNAPSHOT", async () => {
    const model = modelEmitting(
      toolCallTurn("tc-1", "AGUISendStateSnapshot", {
        snapshot: { count: 2 },
      }),
    );
    const agent = aiSdkAgent({ model });

    const events = await runAgent(agent, { state: { count: 1 } });

    const snapshot = eventsOfType(events, EventType.STATE_SNAPSHOT)[0];
    expect(eventField(snapshot, "snapshot")).toEqual({ count: 2 });
  });

  it("runs a defineTool server tool and streams its result", async () => {
    const calls: unknown[] = [];
    const getWeather = defineTool({
      name: "getWeather",
      description: "Weather for a city.",
      parameters: z.object({ city: z.string() }),
      execute: async (args) => {
        calls.push(args);
        return { temperature: 20 };
      },
    });
    const model = modelEmitting(
      toolCallTurn("tc-1", "getWeather", { city: "Paris" }),
    );
    const agent = aiSdkAgent({ model, tools: [getWeather] });

    const events = await runAgent(agent);

    const result = eventsOfType(events, EventType.TOOL_CALL_RESULT)[0];
    expect(calls).toEqual([{ city: "Paris" }]);
    expect(eventField(result, "content")).toBe('{"temperature":20}');
  });

  it("builds the tools for each run from a function of the run context", async () => {
    const model = modelEmitting(toolCallTurn("tc-1", "whoami", {}));
    const agent = aiSdkAgent({
      model,
      tools: (ctx) => ({
        whoami: tool({
          description: "The thread id.",
          inputSchema: jsonSchema<Record<string, never>>({ type: "object" }),
          execute: async () => ctx.input.threadId,
        }),
      }),
    });

    const events = await runAgent(agent, { threadId: "thread-7" });

    const result = eventsOfType(events, EventType.TOOL_CALL_RESULT)[0];
    expect(eventField(result, "content")).toBe('"thread-7"');
  });

  it.each([
    {
      name: "its interruptReason and interruptMessage",
      details: {
        interruptReason: "confirm_booking",
        interruptMessage: "Book it?",
      },
      expected: { reason: "confirm_booking", message: "Book it?" },
    },
    {
      name: 'reason "tool_call" when it sets no reason',
      details: {},
      expected: { reason: "tool_call", message: undefined },
    },
  ])(
    "pauses the run on a defineTool interrupt tool with $name",
    async ({ details, expected }) => {
      const bookFlight = defineTool({
        name: "bookFlight",
        description: "Book a flight.",
        parameters: z.object({ destination: z.string() }),
        interrupt: true,
        ...details,
      });
      const model = modelEmitting(
        toolCallTurn("tc-1", "bookFlight", { destination: "Tokyo" }),
      );
      const agent = aiSdkAgent({ model, tools: [bookFlight] });

      const events = await runAgent(agent);

      expect(runOutcome(events)).toEqual({
        type: "interrupt",
        interrupts: [
          {
            id: "tc-1",
            toolCallId: "tc-1",
            metadata: { toolName: "bookFlight" },
            ...expected,
          },
        ],
      });
      expect(eventsOfType(events, EventType.TOOL_CALL_RESULT)).toEqual([]);
    },
  );
});

describe("aiSdkAgent forwardedProps overrides", () => {
  it.each([
    { allowed: ["temperature"], expected: 0.9 },
    { allowed: [], expected: 0.2 },
  ] satisfies Array<{
    allowed: AiSdkAgentConfig["overridableProperties"];
    expected: number;
  }>)(
    "uses temperature $expected when overridableProperties is $allowed",
    async ({ allowed, expected }) => {
      const model = modelEmitting(textTurn("ok"));
      const agent = aiSdkAgent({
        model,
        temperature: 0.2,
        overridableProperties: allowed,
      });

      await runAgent(agent, { forwardedProps: { temperature: 0.9 } });

      expect(model.doStreamCalls[0].temperature).toBe(expected);
    },
  );

  it("switches to a model from the models allowlist", async () => {
    const model = modelEmitting(textTurn("main"));
    const fast = modelEmitting(textTurn("fast"));
    const agent = aiSdkAgent({
      model,
      models: { fast },
      overridableProperties: ["model"],
    });

    await runAgent(agent, { forwardedProps: { model: "fast" } });

    expect(fast.doStreamCalls).toHaveLength(1);
    expect(model.doStreamCalls).toHaveLength(0);
  });

  it("keeps the configured model for a name that is not in the allowlist", async () => {
    const model = modelEmitting(textTurn("main"));
    const fast = modelEmitting(textTurn("fast"));
    const agent = aiSdkAgent({
      model,
      models: { fast },
      overridableProperties: ["model"],
    });

    await runAgent(agent, { forwardedProps: { model: "other" } });

    expect(model.doStreamCalls).toHaveLength(1);
  });
});

describe("aiSdkAgent step limit", () => {
  it.each([
    { name: "one step by default", maxSteps: undefined, steps: 1 },
    { name: "maxSteps steps", maxSteps: 3, steps: 3 },
  ])("runs $name", async ({ maxSteps, steps }) => {
    const model = modelEmitting(toolCallTurn("tc-1", "ping", {}));
    const agent = aiSdkAgent({ model, tools: [pingTool], maxSteps });

    await runAgent(agent);

    expect(model.doStreamCalls).toHaveLength(steps);
  });

  it("runs 10 steps with learned skills and no maxSteps", async () => {
    const model = modelEmitting(toolCallTurn("tc-1", "ping", {}));
    const agent = aiSdkAgent({
      model,
      tools: [pingTool],
      learnedSkills: await startSkillsServer(),
    });

    await runAgent(agent);

    expect(model.doStreamCalls).toHaveLength(10);
    expect(JSON.stringify(model.doStreamCalls[0].prompt)).toContain(
      "refund-policy",
    );
  });
});

describe("aiSdkAgent modelHostClass", () => {
  it.each([
    {
      name: "an OpenAI provider model",
      config: {
        url: ({ path }: { path: string }) => `https://api.openai.com/v1${path}`,
      },
      expected: "openai",
    },
    {
      name: "a provider model with an Azure baseURL",
      config: { baseURL: "https://acme.openai.azure.com/openai/v1" },
      expected: "azure",
    },
    {
      name: "a model that does not show its endpoint",
      config: undefined,
      expected: "unknown",
    },
  ])("is $expected for $name", ({ config, expected }) => {
    const model = Object.assign(modelEmitting(textTurn("ok")), { config });

    expect(aiSdkAgent({ model }).modelHostClass).toBe(expected);
  });
});

describe("aiSdkAgent MCP", () => {
  it("prefixes a colliding MCP tool, runs it, and closes the client when the run ends", async () => {
    const server = await startWeatherMcpServer();
    const getWeather = tool({
      description: "Weather from the app.",
      inputSchema: jsonSchema<{ city: string }>({ type: "object" }),
      execute: async () => "app weather",
    });
    const model = modelEmitting(
      toolCallTurn("tc-1", "weather_getWeather", { city: "Oslo" }),
    );
    const agent = aiSdkAgent({
      model,
      tools: { getWeather },
      mcpServers: [{ type: "sse", url: server.url, name: "weather" }],
    });

    const events = await runAgent(agent);

    const toolNames = model.doStreamCalls[0].tools?.map((t) => t.name);
    expect(toolNames).toContain("getWeather");
    expect(toolNames).toContain("weather_getWeather");
    const result = eventsOfType(events, EventType.TOOL_CALL_RESULT)[0];
    expect(eventField(result, "content")).toContain(
      'MCP:{\\"city\\":\\"Oslo\\"}',
    );
    await expect(server.streamClosed).resolves.toBeUndefined();
  });
});
