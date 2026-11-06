import { describe, it, expect, vi, afterEach } from "vitest";
import { EventType } from "@ag-ui/client";
import { LLMock, MCPMock } from "@copilotkit/aimock";
import { createMCPClient } from "@tanstack/ai-mcp";
import type { AnyServerTool, TextOptions } from "@tanstack/ai";
import {
  collectEvents,
  collectEventsIncludingErrors,
  createClassicAgent,
  createDefaultInput,
  eventsOfType,
  requestToolNames,
  runClassicAgent,
} from "./agent-test-helpers";
import type { ClassicTestConfig } from "./agent-test-helpers";

// The agent passes its config `mcp` to TanStack AI chat(), which reads the
// tools of each client. The MCP sources below are the boundary: a real
// `@tanstack/ai-mcp` client on an in-process MCP server, or a fake source
// object. The model is a fake; chat() is real.

const cleanups: Array<() => Promise<void>> = [];

afterEach(async () => {
  const pending = cleanups.splice(0);
  await Promise.all(pending.map((cleanup) => cleanup().catch(() => {})));
});

/** A TanStack AI server tool that answers with its description. */
function fakeTool(name: string, description: string): AnyServerTool {
  return {
    __toolSide: "server",
    name,
    description,
    execute: async () => description,
  };
}

/**
 * A fake MCP source, the shape chat() reads: `tools()` and `close()`. Like a
 * real MCP client, it marks its tools lazy when chat() asks for lazy tools.
 */
function fakeSource(tools: AnyServerTool[]) {
  return {
    tools: vi.fn(
      async (options?: { lazy?: boolean }): Promise<AnyServerTool[]> =>
        tools.map((tool) => ({ ...tool, lazy: options?.lazy ?? false })),
    ),
    close: vi.fn(async () => {}),
  };
}

/** A fake MCP source whose tool listing fails with `message`. */
function failingSource(message: string) {
  const source = fakeSource([]);
  source.tools.mockRejectedValue(new Error(message));
  return source;
}

/**
 * An MCPMock served over Streamable HTTP. Each tool answers with
 * `<label> result for <args>`. Returns the MCP endpoint URL.
 */
async function startHttpMCPServer(
  tools: Array<{ name: string; description: string }>,
  label = "server",
) {
  const mock = new MCPMock();
  for (const tool of tools) {
    mock.addTool({
      ...tool,
      inputSchema: {
        type: "object",
        properties: { query: { type: "string" } },
      },
    });
    mock.onToolCall(
      tool.name,
      (args) => `${label} result for ${JSON.stringify(args)}`,
    );
  }
  const server = new LLMock({ port: 0 });
  server.mount("/mcp", mock);
  await server.start();
  cleanups.push(() => server.stop());
  return `${server.url}/mcp`;
}

/** A real `@tanstack/ai-mcp` client for an HTTP MCPMock with `tools`. */
async function connectMCPClient(
  tools: Array<{ name: string; description: string }>,
) {
  const url = await startHttpMCPServer(tools);
  const client = await createMCPClient({ transport: { type: "http", url } });
  cleanups.push(() => client.close());
  return client;
}

function findTool(request: TextOptions, name: string) {
  return request.tools?.find((tool) => tool.name === name);
}

/** Runs a classic agent once and returns its events, RUN_ERROR included. */
async function runExpectingError(
  config: ClassicTestConfig,
  input?: Parameters<typeof createDefaultInput>[0],
) {
  const { agent, requests } = createClassicAgent(config);
  const { events } = await collectEventsIncludingErrors(
    agent.run(createDefaultInput(input)),
  );
  const [runError] = eventsOfType(events, EventType.RUN_ERROR);
  return { runError, requests };
}

describe("mcp: MCP tools", () => {
  it("runs the tools of a real @tanstack/ai-mcp client and leaves the client open", async () => {
    const client = await connectMCPClient([
      { name: "get_weather", description: "Get the weather" },
    ]);

    const { events, requests } = await runClassicAgent(
      { mcp: { clients: [client] }, maxSteps: 2 },
      [
        {
          toolCalls: [
            { id: "tc1", name: "get_weather", input: { query: "NYC" } },
          ],
        },
        { text: "Sunny." },
      ],
    );

    expect(findTool(requests[0], "get_weather")?.description).toBe(
      "Get the weather",
    );
    const [result] = eventsOfType(events, EventType.TOOL_CALL_RESULT);
    expect(result.toolCallId).toBe("tc1");
    expect(result.content).toContain("NYC");
    // The run kept the connection open, so the client still reaches the server.
    const after = await client.callTool("get_weather", { query: "Paris" });
    expect(JSON.stringify(after.content)).toContain("Paris");
  });

  it("offers MCP tools after the frontend tools", async () => {
    const source = fakeSource([fakeTool("listEnvelopes", "List envelopes")]);

    const { requests } = await runClassicAgent(
      { mcp: { clients: [source] } },
      [{}],
      {
        tools: [
          {
            name: "showCard",
            description: "Show a card",
            parameters: { type: "object", properties: {} },
          },
        ],
      },
    );

    const names = requestToolNames(requests[0]);
    expect(names.indexOf("showCard")).toBeLessThan(
      names.indexOf("listEnvelopes"),
    );
    expect(findTool(requests[0], "listEnvelopes")?.description).toBe(
      "List envelopes",
    );
  });

  it("reads the tools again on each run, also from a clone", async () => {
    const source = fakeSource([fakeTool("cloned", "from source")]);
    const { agent, requests } = createClassicAgent(
      { mcp: { clients: [source] } },
      [{}, {}],
    );

    await collectEvents(agent.run(createDefaultInput()));
    await collectEvents(agent.clone().run(createDefaultInput({ runId: "r2" })));

    expect(requestToolNames(requests[1])).toContain("cloned");
    expect(source.tools).toHaveBeenCalledTimes(2);
  });
});

describe("mcp: connection", () => {
  it("keeps the clients open by default", async () => {
    const source = fakeSource([fakeTool("search", "Search")]);

    await runClassicAgent({ mcp: { clients: [source] } });

    expect(source.close).not.toHaveBeenCalled();
  });

  it('closes the clients when the run ends with connection: "close"', async () => {
    const source = fakeSource([fakeTool("search", "Search")]);

    await runClassicAgent({
      mcp: { clients: [source], connection: "close" },
    });

    expect(source.close).toHaveBeenCalledOnce();
  });

  it("stops after a tool listing that the run cancelled, and keeps the client open", async () => {
    let resolveTools!: (tools: AnyServerTool[]) => void;
    const source = fakeSource([]);
    source.tools.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveTools = resolve;
        }),
    );
    const { agent, requests } = createClassicAgent({
      mcp: { clients: [source] },
    });

    const run = collectEvents(agent.run(createDefaultInput()));
    await vi.waitFor(() => expect(source.tools).toHaveBeenCalledOnce());
    agent.abortRun();
    resolveTools([]);
    await run;

    expect(requests).toHaveLength(0);
    expect(source.close).not.toHaveBeenCalled();
  });
});

describe("mcp: discovery options", () => {
  it("offers lazy MCP tools through the discovery tool with lazyTools", async () => {
    const source = fakeSource([fakeTool("get_weather", "Get the weather")]);

    const { requests } = await runClassicAgent({
      mcp: { clients: [source], lazyTools: true },
    });

    const names = requestToolNames(requests[0]);
    expect(names).toContain("__lazy__tool__discovery__");
    expect(names).not.toContain("get_weather");
  });

  it("fails the run with RUN_ERROR when a client cannot list its tools", async () => {
    const { runError, requests } = await runExpectingError({
      mcp: { clients: [failingSource("MCP connection lost")] },
    });

    expect(runError.message).toBe("MCP connection lost");
    expect(requests).toHaveLength(0);
  });

  it("skips a failing client when onDiscoveryError returns", async () => {
    const failing = failingSource("MCP connection lost");
    const working = fakeSource([fakeTool("search", "Search")]);
    const onDiscoveryError = vi.fn();

    const { requests } = await runClassicAgent({
      mcp: { clients: [failing, working], onDiscoveryError },
    });

    expect(requestToolNames(requests[0])).toContain("search");
    expect(onDiscoveryError).toHaveBeenCalledOnce();
    expect(onDiscoveryError.mock.calls[0][0]).toEqual(
      new Error("MCP connection lost"),
    );
    expect(onDiscoveryError.mock.calls[0][1]).toBe(failing);
  });
});

describe("mcp: tool names", () => {
  it("fails the run when an MCP tool has the name of a frontend tool", async () => {
    const { runError, requests } = await runExpectingError(
      { mcp: { clients: [fakeSource([fakeTool("search", "from mcp")])] } },
      {
        tools: [
          {
            name: "search",
            description: "from app",
            parameters: { type: "object", properties: {} },
          },
        ],
      },
    );

    expect(runError.message).toContain('Cannot pass two tools named "search"');
    expect(requests).toHaveLength(0);
  });

  it("fails the run when two MCP clients have a tool of the same name", async () => {
    const { runError, requests } = await runExpectingError({
      mcp: {
        clients: [
          fakeSource([fakeTool("shared", "from client 1")]),
          fakeSource([fakeTool("shared", "from client 2")]),
        ],
      },
    });

    expect(runError.message).toContain('Duplicate MCP tool name "shared"');
    expect(requests).toHaveLength(0);
  });
});
