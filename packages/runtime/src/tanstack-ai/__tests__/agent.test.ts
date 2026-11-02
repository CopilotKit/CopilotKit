import http from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EventType } from "@ag-ui/client";
import type { BaseEvent, RunAgentInput } from "@ag-ui/client";
import type { AnyTool } from "@tanstack/ai";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import * as v from "valibot";
import { toStandardJsonSchema } from "@valibot/to-json-schema";
import { z } from "zod";
import { defineTool } from "../../agent/index";
import type { ToolDefinition } from "../../agent/index";
import {
  collectEvents,
  createDefaultInput,
  eventField,
} from "../../agent/__tests__/agent-test-helpers";
import fixtures from "../../../../intelligence-delivery-core/conformance/snapshots.v1.json";
import { tanstackAIAgent } from "../agent";
import { callTool, scriptedTextAdapter } from "./fake-adapter";

const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0)) await cleanup();
});

function userInput(overrides?: Partial<RunAgentInput>) {
  return createDefaultInput({
    messages: [{ id: "u1", role: "user", content: "Hi" }],
    ...overrides,
  });
}

function eventsOfType(events: BaseEvent[], type: EventType) {
  return events.filter((event) => event.type === type);
}

function textOf(events: BaseEvent[]) {
  return eventsOfType(events, EventType.TEXT_MESSAGE_CHUNK)
    .map((event) => eventField<string>(event, "delta"))
    .join("");
}

function runFinished(events: BaseEvent[]) {
  const finished = events.at(-1);
  expect(finished?.type).toBe(EventType.RUN_FINISHED);
  return finished;
}

/** Counts tool calls and records their input. */
function recordingTool(name: string) {
  const calls: unknown[] = [];
  const tool: AnyTool = {
    name,
    description: `${name} tool`,
    inputSchema: { type: "object", properties: {} },
    execute: async (input: unknown) => {
      calls.push(input);
      return "ok";
    },
  };
  return { tool, calls };
}

/** Starts an HTTP server on a random local port and returns its base URL. */
async function listen(handler: http.RequestListener) {
  const httpServer = http.createServer(handler);
  await new Promise<void>((resolve) =>
    httpServer.listen(0, "127.0.0.1", resolve),
  );
  cleanups.push(
    () =>
      new Promise<void>((resolve) => {
        httpServer.closeAllConnections();
        httpServer.close(() => resolve());
      }),
  );
  const { port } = httpServer.address() as AddressInfo;
  return `http://127.0.0.1:${port}`;
}

/**
 * A real MCP server over SSE. Each tool answers with its name and input.
 * `streamClosed` resolves when the client closes its event stream.
 */
async function startMcpServer(toolNames: string[]) {
  const transports = new Map<string, SSEServerTransport>();
  let resolveStreamClosed = () => {};
  const streamClosed = new Promise<void>((resolve) => {
    resolveStreamClosed = resolve;
  });
  const createMcpServer = () => {
    const mcp = new Server(
      { name: "test-server", version: "1.0.0" },
      { capabilities: { tools: {} } },
    );
    mcp.setRequestHandler(ListToolsRequestSchema, () => ({
      tools: toolNames.map((name) => ({
        name,
        description: `${name} tool`,
        inputSchema: { type: "object", properties: { q: { type: "string" } } },
      })),
    }));
    mcp.setRequestHandler(CallToolRequestSchema, (request) => ({
      content: [
        {
          type: "text",
          text: `${request.params.name} ${JSON.stringify(request.params.arguments)}`,
        },
      ],
    }));
    return mcp;
  };
  const baseUrl = await listen(async (req, res) => {
    const url = new URL(req.url ?? "/", "http://127.0.0.1");
    if (req.method === "GET") {
      const transport = new SSEServerTransport("/messages", res);
      transports.set(transport.sessionId, transport);
      res.on("close", () => resolveStreamClosed());
      await createMcpServer().connect(transport);
      return;
    }
    const transport = transports.get(url.searchParams.get("sessionId") ?? "");
    if (!transport) {
      res.writeHead(404).end();
      return;
    }
    await transport.handlePostMessage(req, res);
  });
  return { url: `${baseUrl}/sse`, streamClosed };
}

/** A learned-skills delivery server that serves one skill. */
async function startDeliveryServer() {
  const fixture = fixtures.cases.find((item) => item.name === "text-skill")!;
  const baseUrl = await listen((_req, res) => {
    res.writeHead(200, {
      "content-type": "application/zip",
      "x-copilotkit-skills-revision": fixture.revision,
      etag: fixture.etag,
    });
    res.end(Buffer.from(fixture.archiveBase64, "base64"));
  });
  return {
    apiKey: "test-delivery-key",
    apiUrl: baseUrl,
    containerId: "learning",
    freshnessWindowMs: 0,
  };
}

/** Turns that each call `name` again, more than any loop limit allows. */
function endlessToolCalls(name: string) {
  return Array.from({ length: 12 }, (_, i) => callTool(`call-${i}`, name, {}));
}

describe("tanstackAIAgent", () => {
  it("streams text and sends the prompt to the model", async () => {
    const { adapter, requests } = scriptedTextAdapter([{ text: "Hello Ada" }]);
    const agent = tanstackAIAgent({ adapter, prompt: "You are helpful." });

    const events = await collectEvents(agent.run(userInput()));

    expect(events[0].type).toBe(EventType.RUN_STARTED);
    expect(textOf(events)).toBe("Hello Ada");
    expect(eventField(runFinished(events), "outcome")).toBeUndefined();
    expect(requests[0].systemPrompts).toEqual(["You are helpful."]);
  });

  it("stops after a frontend tool call so the client can run it", async () => {
    const { adapter, requests } = scriptedTextAdapter([
      callTool("call-card", "showCard", { title: "Hi" }),
    ]);
    const agent = tanstackAIAgent({ adapter });
    const showCard = {
      name: "showCard",
      description: "Show a card",
      parameters: { type: "object", properties: { title: { type: "string" } } },
    };

    const events = await collectEvents(
      agent.run(userInput({ tools: [showCard] })),
    );

    expect(events.map((event) => event.type)).toEqual([
      EventType.RUN_STARTED,
      EventType.TOOL_CALL_START,
      EventType.TOOL_CALL_ARGS,
      EventType.TOOL_CALL_END,
      EventType.RUN_FINISHED,
    ]);
    expect(eventField(runFinished(events), "outcome")).toBeUndefined();
    expect(requests).toHaveLength(1);
  });

  it("turns a state snapshot tool call into a STATE_SNAPSHOT", async () => {
    const { adapter } = scriptedTextAdapter([
      callTool("call-state", "AGUISendStateSnapshot", {
        snapshot: { count: 2 },
      }),
      { text: "Saved" },
    ]);
    const agent = tanstackAIAgent({ adapter });

    const events = await collectEvents(
      agent.run(userInput({ state: { count: 1 } })),
    );

    const snapshots = eventsOfType(events, EventType.STATE_SNAPSHOT);
    expect(snapshots.map((event) => eventField(event, "snapshot"))).toEqual([
      { count: 2 },
    ]);
    expect(textOf(events)).toBe("Saved");
  });

  it("runs a defineTool server tool with input parsed by its schema", async () => {
    const calls: unknown[] = [];
    const getWeather = defineTool({
      name: "getWeather",
      description: "Get the weather",
      parameters: toStandardJsonSchema(
        v.object({ city: v.string(), units: v.optional(v.string(), "C") }),
      ),
      execute: async (input) => {
        calls.push(input);
        return { forecast: "Sunny" };
      },
    });
    const { adapter, requests } = scriptedTextAdapter([
      callTool("call-weather", "getWeather", { city: "Paris" }),
      { text: "It is sunny" },
    ]);
    const agent = tanstackAIAgent({ adapter, tools: [getWeather] });

    const events = await collectEvents(agent.run(userInput()));

    expect(calls).toEqual([{ city: "Paris", units: "C" }]);
    const results = eventsOfType(events, EventType.TOOL_CALL_RESULT);
    expect(results.map((event) => eventField(event, "content"))).toEqual([
      '{"forecast":"Sunny"}',
    ]);
    expect(textOf(events)).toBe("It is sunny");
    expect(requests[0].tools?.map((tool) => tool.name)).toContain("getWeather");
  });

  it("resolves the tools function on each run", async () => {
    const { tool, calls } = recordingTool("lookup");
    const { adapter } = scriptedTextAdapter([
      callTool("call-1", "lookup", { q: "a" }),
      { text: "Done" },
    ]);
    const agent = tanstackAIAgent({ adapter, tools: async () => [tool] });

    await collectEvents(agent.run(userInput()));

    expect(calls).toEqual([{ q: "a" }]);
  });

  it("runs a Zod v3 defineTool server tool", async () => {
    const calls: unknown[] = [];
    const getWeather = defineTool({
      name: "getWeather",
      description: "Get the weather",
      parameters: z.object({
        city: z.string(),
        units: z.string().default("C"),
      }),
      execute: async (input) => {
        calls.push(input);
        return "Sunny";
      },
    });
    const { adapter, requests } = scriptedTextAdapter([
      callTool("call-weather", "getWeather", { city: "Paris" }),
      { text: "It is sunny" },
    ]);
    const agent = tanstackAIAgent({ adapter, tools: [getWeather] });

    const events = await collectEvents(agent.run(userInput()));

    const sentTool = requests[0].tools?.find(
      (tool) => tool.name === "getWeather",
    );
    expect(sentTool?.inputSchema).toMatchObject({
      type: "object",
      properties: { city: { type: "string" } },
      required: ["city"],
    });
    expect(calls).toEqual([{ city: "Paris", units: "C" }]);
    expect(textOf(events)).toBe("It is sunny");
  });

  /** Runs one call to `tool` and returns the interrupts the run ended with. */
  async function interruptsFrom(tool: ToolDefinition) {
    const { adapter, requests } = scriptedTextAdapter([
      callTool("call-buy", tool.name, { item: "book" }),
    ]);
    const agent = tanstackAIAgent({ adapter, tools: [tool] });

    const events = await collectEvents(agent.run(userInput()));

    expect(eventsOfType(events, EventType.TOOL_CALL_RESULT)).toEqual([]);
    expect(requests).toHaveLength(1);
    const outcome = eventField<{ type: string; interrupts: unknown[] }>(
      runFinished(events),
      "outcome",
    );
    expect(outcome.type).toBe("interrupt");
    return outcome.interrupts;
  }

  it("pauses on a defineTool interrupt tool with its reason and message", async () => {
    const confirmPurchase = defineTool({
      name: "confirmPurchase",
      description: "Ask the user to confirm a purchase",
      parameters: toStandardJsonSchema(v.object({ item: v.string() })),
      interrupt: true,
      interruptReason: "purchase_confirmation",
      interruptMessage: "Confirm the purchase?",
    });

    expect(await interruptsFrom(confirmPurchase)).toEqual([
      {
        id: "call-buy",
        toolCallId: "call-buy",
        reason: "purchase_confirmation",
        message: "Confirm the purchase?",
        metadata: { toolName: "confirmPurchase" },
      },
    ]);
  });

  it("uses the tool_call reason for an interrupt tool without a reason", async () => {
    const confirmPurchase = defineTool({
      name: "confirmPurchase",
      description: "Ask the user to confirm a purchase",
      parameters: toStandardJsonSchema(v.object({ item: v.string() })),
      interrupt: true,
    });

    expect(await interruptsFrom(confirmPurchase)).toEqual([
      {
        id: "call-buy",
        toolCallId: "call-buy",
        reason: "tool_call",
        metadata: { toolName: "confirmPurchase" },
      },
    ]);
  });

  it("continues after the interrupt with the resume payload as the tool result", async () => {
    const confirmPurchase = defineTool({
      name: "confirmPurchase",
      description: "Ask the user to confirm a purchase",
      parameters: toStandardJsonSchema(v.object({ item: v.string() })),
      interrupt: true,
    });
    const { adapter, requests } = scriptedTextAdapter([{ text: "Bought" }]);
    const agent = tanstackAIAgent({ adapter, tools: [confirmPurchase] });

    const events = await collectEvents(
      agent.run(
        userInput({
          messages: [
            { id: "u1", role: "user", content: "Buy a book" },
            {
              id: "a1",
              role: "assistant",
              content: "",
              toolCalls: [
                {
                  id: "call-buy",
                  type: "function",
                  function: {
                    name: "confirmPurchase",
                    arguments: '{"item":"book"}',
                  },
                },
              ],
            },
          ],
          resume: [
            {
              interruptId: "call-buy",
              status: "resolved",
              payload: { approved: true },
            },
          ],
        }),
      ),
    );

    expect(textOf(events)).toBe("Bought");
    expect(eventField(runFinished(events), "outcome")).toBeUndefined();
    expect(requests[0].messages).toContainEqual(
      expect.objectContaining({
        role: "tool",
        toolCallId: "call-buy",
        content: '{"approved":true}',
      }),
    );
  });

  describe("forwardedProps overrides", () => {
    const configured = { temperature: 0.2, topP: 0.9 };

    async function modelOptionsFor(
      overridableProperties: ("model" | "modelOptions")[],
    ) {
      const { adapter, requests } = scriptedTextAdapter([{ text: "Hi" }]);
      const agent = tanstackAIAgent({
        adapter,
        modelOptions: configured,
        overridableProperties,
      });
      await collectEvents(
        agent.run(
          userInput({ forwardedProps: { modelOptions: { temperature: 1 } } }),
        ),
      );
      return requests[0].modelOptions;
    }

    it("merges allowed modelOptions over the configured ones", async () => {
      expect(await modelOptionsFor(["modelOptions"])).toEqual({
        temperature: 1,
        topP: 0.9,
      });
    });

    it("ignores modelOptions that are not allowed", async () => {
      expect(await modelOptionsFor([])).toEqual(configured);
    });

    async function adapterUsedFor(
      overridableProperties: ("model" | "modelOptions")[],
    ) {
      const main = scriptedTextAdapter([{ text: "main" }]);
      const fast = scriptedTextAdapter([{ text: "fast" }]);
      const agent = tanstackAIAgent({
        adapter: main.adapter,
        adapters: { fast: fast.adapter },
        overridableProperties,
      });
      const events = await collectEvents(
        agent.run(userInput({ forwardedProps: { model: "fast" } })),
      );
      return textOf(events);
    }

    it("uses an allowlisted adapter picked with forwardedProps.model", async () => {
      expect(await adapterUsedFor(["model"])).toBe("fast");
    });

    it("keeps the configured adapter when model is not overridable", async () => {
      expect(await adapterUsedFor([])).toBe("main");
    });
  });

  describe("learned skills", () => {
    it("puts the catalog first and allows 10 model turns by default", async () => {
      const { tool, calls } = recordingTool("ping");
      const { adapter, requests } = scriptedTextAdapter(
        endlessToolCalls("ping"),
      );
      const agent = tanstackAIAgent({
        adapter,
        prompt: "Host instructions",
        tools: [tool],
        learnedSkills: await startDeliveryServer(),
      });

      await collectEvents(agent.run(userInput()));

      expect(requests).toHaveLength(10);
      expect(calls).toHaveLength(10);
      expect(requests[0].systemPrompts?.[0]).toContain("refund-policy");
      expect(requests[0].systemPrompts?.[1]).toBe("Host instructions");
      expect(requests[0].tools?.map((t) => t.name)).toContain(
        "copilotkit_load_skill",
      );
    });

    it("keeps an explicit maxIterations", async () => {
      const { tool } = recordingTool("ping");
      const { adapter, requests } = scriptedTextAdapter(
        endlessToolCalls("ping"),
      );
      const agent = tanstackAIAgent({
        adapter,
        tools: [tool],
        maxIterations: 3,
        learnedSkills: await startDeliveryServer(),
      });

      await collectEvents(agent.run(userInput()));

      expect(requests).toHaveLength(3);
    });
  });

  describe("MCP servers", () => {
    beforeEach(() => {
      vi.spyOn(console, "warn").mockImplementation(() => {});
    });
    afterEach(() => {
      vi.restoreAllMocks();
    });

    it("runs MCP tools, prefixes a name the app already uses, and closes on run end", async () => {
      const server = await startMcpServer(["search", "lookup"]);
      const { tool: appLookup } = recordingTool("lookup");
      const { adapter, requests } = scriptedTextAdapter([
        callTool("call-search", "search", { q: "tea" }),
        { text: "Found tea" },
      ]);
      const agent = tanstackAIAgent({
        adapter,
        tools: [appLookup],
        mcpServers: [{ type: "sse", url: server.url, name: "docs" }],
      });

      const events = await collectEvents(agent.run(userInput()));

      const toolNames = requests[0].tools?.map((tool) => tool.name);
      expect(toolNames).toEqual(
        expect.arrayContaining(["lookup", "search", "docs_lookup"]),
      );
      const results = eventsOfType(events, EventType.TOOL_CALL_RESULT);
      expect(String(eventField(results[0], "content"))).toContain(
        'search {\\"q\\":\\"tea\\"}',
      );
      expect(textOf(events)).toBe("Found tea");
      await server.streamClosed;
    });
  });
});
