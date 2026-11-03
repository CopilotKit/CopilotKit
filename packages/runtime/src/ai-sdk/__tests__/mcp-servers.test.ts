/**
 * `aiSdkAgent` with `mcpServers` against real MCP servers (aimock's MCPMock
 * over streamable HTTP), and per-run `tools` functions, which replace the
 * removed `mcpClients` option. Name resolution and connection details are
 * unit-tested in `agent/__tests__/mcp.test.ts` and `mcp-tool-names.test.ts`;
 * these tests pin what reaches the model and the run.
 */
import http from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it, vi } from "vitest";
import { EventType } from "@ag-ui/client";
import type { BaseEvent, RunAgentInput } from "@ag-ui/client";
import { jsonSchema, tool } from "ai";
import type { ToolSet } from "ai";
import { MockLanguageModelV3, simulateReadableStream } from "ai/test";
import { LLMock, MCPMock } from "@copilotkit/aimock";
import {
  collectEventsIncludingErrors,
  createDefaultInput,
  eventField,
} from "../../agent/__tests__/agent-test-helpers";
import { aiSdkAgent } from "../agent";
import {
  eventsOfType,
  modelEmitting,
  modelEmittingTurns,
  runAgent,
  textTurn,
  toolCallTurn,
} from "./mock-model";

const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => {
  vi.restoreAllMocks();
  for (const cleanup of cleanups.splice(0)) await cleanup();
});

/**
 * Starts one LLMock with an MCPMock mounted at `/<path>` for each entry.
 * Each tool answers `result from <label>`. Returns the MCP URLs by path.
 */
async function startMcpServers(
  servers: Record<string, { label: string; tools: string[] }>,
) {
  const llm = new LLMock({ port: 0 });
  for (const [path, { label, tools }] of Object.entries(servers)) {
    const mcp = new MCPMock();
    for (const name of tools) {
      mcp.addTool({
        name,
        description: `${name} on ${label}`,
        inputSchema: {
          type: "object",
          properties: { query: { type: "string" } },
        },
      });
      mcp.onToolCall(name, () => `result from ${label}`);
    }
    llm.mount(`/${path}`, mcp);
  }
  await llm.start();
  cleanups.push(() => llm.stop().catch(() => {}));
  const urls: Record<string, string> = {};
  for (const path of Object.keys(servers)) urls[path] = `${llm.url}/${path}`;
  return urls;
}

/** One MCP server at `/mcp` with a `get_weather` tool. */
async function startWeatherServer() {
  const { mcp } = await startMcpServers({
    mcp: { label: "weather", tools: ["get_weather"] },
  });
  return mcp;
}

/** A URL on which nothing listens. */
async function unreachableUrl() {
  const server = http.createServer();
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  await new Promise((resolve) => server.close(resolve));
  return `http://127.0.0.1:${port}/mcp`;
}

/** A server that counts its requests and never answers like MCP. */
async function startCountingServer() {
  let requests = 0;
  const server = http.createServer((_req, res) => {
    requests++;
    res.writeHead(404).end();
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  cleanups.push(
    () => new Promise<void>((resolve) => server.close(() => resolve())),
  );
  const { port } = server.address() as AddressInfo;
  return { url: `http://127.0.0.1:${port}/mcp`, requests: () => requests };
}

function input(overrides: Partial<RunAgentInput> = {}) {
  return createDefaultInput({
    messages: [{ id: "u1", role: "user", content: "hi" }],
    ...overrides,
  });
}

/** The tools the model saw on call `index`, as name to description. */
function toolsSeen(model: MockLanguageModelV3, index = 0) {
  const tools = model.doStreamCalls[index].tools ?? [];
  return Object.fromEntries(
    tools.map((t) => [t.name, t.type === "function" ? t.description : ""]),
  );
}

function eventTypes(events: BaseEvent[]) {
  return events.map((event) => event.type);
}

function toolResults(events: BaseEvent[]) {
  return eventsOfType(events, EventType.TOOL_CALL_RESULT).map((event) =>
    eventField<string>(event, "content"),
  );
}

function lookupTool(description: string) {
  return tool({
    description,
    inputSchema: jsonSchema<{ query: string }>({ type: "object" }),
    execute: async () => description,
  });
}

describe("aiSdkAgent mcpServers", () => {
  it("gives the model each MCP tool with its description", async () => {
    const url = await startWeatherServer();
    const model = modelEmitting(textTurn("ok"));
    const agent = aiSdkAgent({ model, mcpServers: [{ type: "http", url }] });

    await runAgent(agent);

    expect(toolsSeen(model).get_weather).toBe("get_weather on weather");
  });

  it("runs an MCP tool the model calls and streams its result", async () => {
    const url = await startWeatherServer();
    const model = modelEmittingTurns([
      toolCallTurn("tc1", "get_weather", { query: "NYC" }),
      textTurn("The weather is sunny."),
    ]);
    const agent = aiSdkAgent({
      model,
      mcpServers: [{ type: "http", url }],
      maxSteps: 2,
    });

    const events = await runAgent(agent);

    expect(toolResults(events)).toHaveLength(1);
    expect(toolResults(events)[0]).toContain("result from weather");
    expect(eventTypes(events)).toContain(EventType.TEXT_MESSAGE_CHUNK);
  });

  it("skips an unreachable server, keeps the healthy one, and finishes the run", async () => {
    const healthy = await startWeatherServer();
    const model = modelEmitting(textTurn("ok"));
    const agent = aiSdkAgent({
      model,
      mcpServers: [
        { type: "http", url: await unreachableUrl() },
        { type: "http", url: healthy },
      ],
    });

    const events = await runAgent(agent);

    expect(eventTypes(events)).not.toContain(EventType.RUN_ERROR);
    expect(eventTypes(events).at(-1)).toBe(EventType.RUN_FINISHED);
    expect(Object.keys(toolsSeen(model))).toContain("get_weather");
  });

  it("connects again on the next run after the first run closed its clients", async () => {
    const url = await startWeatherServer();
    const model = modelEmitting(textTurn("ok"));
    const agent = aiSdkAgent({ model, mcpServers: [{ type: "http", url }] });

    await runAgent(agent);
    await runAgent(agent, { runId: "run-2" });

    expect(model.doStreamCalls).toHaveLength(2);
    expect(Object.keys(toolsSeen(model, 1))).toContain("get_weather");
  });

  it("still gives the next run its MCP tools after a model error", async () => {
    const url = await startWeatherServer();
    let call = 0;
    const model = new MockLanguageModelV3({
      doStream: async () => {
        if (call++ === 0) throw new Error("LLM connection failed");
        return { stream: simulateReadableStream({ chunks: textTurn("ok") }) };
      },
    });
    const agent = aiSdkAgent({
      model,
      mcpServers: [{ type: "http", url }],
      maxRetries: 0,
    });

    const failed = await collectEventsIncludingErrors(agent.run(input()));
    const recovered = await runAgent(agent, { runId: "run-2" });

    expect(eventTypes(failed.events)).toContain(EventType.RUN_ERROR);
    expect(eventTypes(recovered).at(-1)).toBe(EventType.RUN_FINISHED);
    expect(Object.keys(toolsSeen(model, 1))).toContain("get_weather");
  });

  it("keeps both tools of two named servers that share a name, and each calls its own server", async () => {
    const urls = await startMcpServers({
      staging: { label: "staging", tools: ["search"] },
      production: { label: "production", tools: ["search"] },
    });
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const model = modelEmitting(
      toolCallTurn("tc1", "production_search", { query: "q" }),
    );
    const agent = aiSdkAgent({
      model,
      mcpServers: [
        { type: "http", url: urls.staging, name: "staging" },
        { type: "http", url: urls.production, name: "production" },
      ],
    });

    const events = await runAgent(agent);

    const names = Object.keys(toolsSeen(model));
    expect(names).toEqual(
      expect.arrayContaining(["staging_search", "production_search"]),
    );
    expect(names).not.toContain("search");
    expect(toolResults(events)[0]).toContain("result from production");
  });

  it("prefixes an MCP tool that shares a frontend tool's name, and warns once across runs", async () => {
    const { mcp } = await startMcpServers({
      mcp: { label: "mcp", tools: ["frontend_search"] },
    });
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const model = modelEmitting(textTurn("ok"));
    const agent = aiSdkAgent({
      model,
      mcpServers: [{ type: "http", url: mcp }],
    });
    const frontendSearch = {
      name: "frontend_search",
      description: "from app",
      parameters: { type: "object", properties: {} },
    };

    await runAgent(agent, { tools: [frontendSearch] });
    await runAgent(agent, { runId: "run-2", tools: [frontendSearch] });

    expect(toolsSeen(model)).toMatchObject({
      frontend_search: "from app",
      mcp1_frontend_search: "frontend_search on mcp",
    });
    const collisionWarnings = warn.mock.calls.filter(([message]) =>
      String(message).includes('"frontend_search"'),
    );
    expect(collisionWarnings).toHaveLength(1);
  });
});

describe("aiSdkAgent per-run tools with mcpServers (replaces mcpClients)", () => {
  // Classic prefixed both an `mcpClients` tool and an `mcpServers` tool on a
  // clash. A per-run tool is an app tool now: it keeps its name and only
  // the MCP tool is prefixed, with the server name reduced to safe characters.
  it("keeps the per-run tool's name and prefixes the MCP tool that shares it", async () => {
    const { mcp } = await startMcpServers({
      mcp: { label: "server", tools: ["lookup"] },
    });
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const model = modelEmitting(textTurn("ok"));
    const agent = aiSdkAgent({
      model,
      tools: () => ({ lookup: lookupTool("from client") }),
      mcpServers: [{ type: "http", url: mcp, name: "Prod API (eu)" }],
    });

    await runAgent(agent);

    expect(toolsSeen(model)).toMatchObject({
      lookup: "from client",
      Prod_API__eu__lookup: "lookup on server",
    });
  });

  it("fails the run with RUN_ERROR, without calling the model, when the tools function rejects", async () => {
    const model = modelEmitting(textTurn("ok"));
    const agent = aiSdkAgent({
      model,
      tools: async () => {
        throw new Error("MCP connection lost");
      },
    });

    const { events, errored } = await collectEventsIncludingErrors(
      agent.run(input()),
    );

    expect(errored).toBe(true);
    expect(eventTypes(events)).toEqual([
      EventType.RUN_STARTED,
      EventType.RUN_ERROR,
    ]);
    expect(eventField(events[1], "message")).toBe("MCP connection lost");
    expect(model.doStreamCalls).toHaveLength(0);
  });

  it("contacts no MCP server and calls no model when the run is cancelled while the tools function runs", async () => {
    const server = await startCountingServer();
    let resolveTools!: (tools: ToolSet) => void;
    let toolsCalled = false;
    const model = modelEmitting(textTurn("ok"));
    const agent = aiSdkAgent({
      model,
      tools: () =>
        new Promise<ToolSet>((resolve) => {
          toolsCalled = true;
          resolveTools = resolve;
        }),
      mcpServers: [{ type: "http", url: server.url }],
    });

    const subscription = agent.run(input()).subscribe({ error: () => {} });
    await vi.waitFor(() => expect(toolsCalled).toBe(true));
    subscription.unsubscribe();
    resolveTools({});
    await new Promise((resolve) => setTimeout(resolve, 50));

    expect(server.requests()).toBe(0);
    expect(model.doStreamCalls).toHaveLength(0);
  });
});
