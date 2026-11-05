import { describe, it, expect, vi, afterEach } from "vitest";
import { EventType } from "@ag-ui/client";
import { LLMock, MCPMock } from "@copilotkit/aimock";
import { createMCPClient } from "@tanstack/ai-mcp";
import type { AnyTool, TextOptions } from "@tanstack/ai";
import {
  collectEvents,
  collectEventsIncludingErrors,
  createClassicAgent,
  createDefaultInput,
  eventsOfType,
  requestToolNames,
  runClassicAgent,
} from "./agent-test-helpers";

// User-managed MCP clients: the agent reads their tools on each run and never
// closes them.

const cleanups: Array<() => Promise<void>> = [];

afterEach(async () => {
  const pending = cleanups.splice(0);
  await Promise.all(pending.map((cleanup) => cleanup().catch(() => {})));
});

/** A TanStack AI tool that answers with its description. */
function fakeTool(name: string, description: string): AnyTool {
  return { name, description, execute: async () => description };
}

/** The smallest `mcpClients` entry: an object with `tools()`, plus a `close` spy. */
function objectProvider(tools: AnyTool[]) {
  return {
    tools: vi.fn(async (): Promise<readonly AnyTool[]> => tools),
    close: vi.fn(async () => {}),
  };
}

/**
 * An MCPMock served over Streamable HTTP. Each tool answers with
 * `result for <query>`. Returns the MCP endpoint URL.
 */
async function startHttpMCPServer(
  tools: Array<{ name: string; description: string }>,
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
    mock.onToolCall(tool.name, (args) => `result for ${JSON.stringify(args)}`);
  }
  const server = new LLMock({ port: 0 });
  server.mount("/mcp", mock);
  await server.start();
  cleanups.push(() => server.stop());
  return `${server.url}/mcp`;
}

function findTool(request: TextOptions, name: string) {
  return request.tools?.find((tool) => tool.name === name);
}

/** Silences `console.warn` for one test and returns the spy. */
function spyOnWarn() {
  const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
  cleanups.push(async () => warn.mockRestore());
  return warn;
}

describe("mcpClients: user-managed MCP clients", () => {
  it("runs the tools of a real @tanstack/ai-mcp client and leaves the client open", async () => {
    const url = await startHttpMCPServer([
      { name: "get_weather", description: "Get the weather" },
    ]);
    const client = await createMCPClient({ transport: { type: "http", url } });
    cleanups.push(() => client.close());

    const { events, requests } = await runClassicAgent(
      { mcpClients: [client], maxSteps: 2 },
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
    // The agent did not close the client, so it still reaches the server.
    const after = await client.callTool("get_weather", { query: "Paris" });
    expect(JSON.stringify(after.content)).toContain("Paris");
  });

  it("lists the tools of an object provider and does not close it", async () => {
    const provider = objectProvider([
      fakeTool("listEnvelopes", "List envelopes"),
    ]);

    const { requests } = await runClassicAgent({ mcpClients: [provider] });

    expect(findTool(requests[0], "listEnvelopes")?.description).toBe(
      "List envelopes",
    );
    expect(provider.tools).toHaveBeenCalledOnce();
    expect(provider.close).not.toHaveBeenCalled();
  });

  it("runs the model with no MCP tools when mcpClients is empty", async () => {
    const { events } = await runClassicAgent({ mcpClients: [] }, [
      { text: "Hi" },
    ]);

    const text = eventsOfType(events, EventType.TEXT_MESSAGE_CHUNK)
      .map((event) => event.delta)
      .join("");
    expect(text).toBe("Hi");
  });

  it("a clone reads the tools of the same mcpClients", async () => {
    const provider = objectProvider([fakeTool("cloned", "from provider")]);
    const { agent, requests } = createClassicAgent({ mcpClients: [provider] });

    await collectEvents(agent.clone().run(createDefaultInput()));

    expect(requestToolNames(requests[0])).toContain("cloned");
    expect(provider.tools).toHaveBeenCalledOnce();
  });
});

describe("mcpClients: tool names", () => {
  it("a name shared by an mcpClient and an mcpServer keeps both tools, prefixed", async () => {
    const warn = spyOnWarn();
    const url = await startHttpMCPServer([
      { name: "sharedTool", description: "from server" },
    ]);

    const { requests } = await runClassicAgent({
      mcpClients: [objectProvider([fakeTool("sharedTool", "from client")])],
      mcpServers: [{ type: "http", url, name: "docs" }],
    });

    // A user-managed client has no name, so it falls back to its position.
    expect(findTool(requests[0], "mcp1_sharedTool")?.description).toBe(
      "from client",
    );
    expect(findTool(requests[0], "docs_sharedTool")?.description).toBe(
      "from server",
    );
    expect(requestToolNames(requests[0])).not.toContain("sharedTool");
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('"sharedTool"'));
  });

  it("multiple mcpClients keep unique names and prefix only the shared one", async () => {
    spyOnWarn();

    const { requests } = await runClassicAgent({
      mcpClients: [
        objectProvider([
          fakeTool("toolA", "from provider 1"),
          fakeTool("shared", "from provider 1"),
        ]),
        objectProvider([
          fakeTool("toolB", "from provider 2"),
          fakeTool("shared", "from provider 2"),
        ]),
      ],
    });

    const names = requestToolNames(requests[0]);
    expect(names).toEqual(
      expect.arrayContaining(["toolA", "toolB", "mcp1_shared", "mcp2_shared"]),
    );
    expect(names).not.toContain("shared");
    expect(findTool(requests[0], "mcp1_shared")?.description).toBe(
      "from provider 1",
    );
    expect(findTool(requests[0], "mcp2_shared")?.description).toBe(
      "from provider 2",
    );
  });

  it("an MCP tool never replaces an app tool of the same name", async () => {
    const warn = spyOnWarn();

    const { requests } = await runClassicAgent(
      { mcpClients: [objectProvider([fakeTool("search", "from mcp")])] },
      [{}],
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

    expect(findTool(requests[0], "search")?.description).toBe("from app");
    expect(findTool(requests[0], "mcp1_search")?.description).toBe("from mcp");
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('"search"'));
  });

  it("a server name is reduced to characters that model providers accept", async () => {
    spyOnWarn();
    const url = await startHttpMCPServer([
      { name: "lookup", description: "from server" },
    ]);

    const { requests } = await runClassicAgent({
      mcpClients: [objectProvider([fakeTool("lookup", "from client")])],
      mcpServers: [{ type: "http", url, name: "Prod API (eu)" }],
    });

    expect(requestToolNames(requests[0])).toContain("Prod_API__eu__lookup");
  });

  it("warns about a collision once, not on every run", async () => {
    const warn = spyOnWarn();
    const { agent } = createClassicAgent(
      {
        mcpClients: [
          objectProvider([fakeTool("repeated", "a")]),
          objectProvider([fakeTool("repeated", "b")]),
        ],
      },
      [{}, {}],
    );

    await collectEvents(agent.run(createDefaultInput()));
    await collectEvents(agent.run(createDefaultInput({ runId: "run2" })));

    const collisionWarnings = warn.mock.calls.filter(([message]) =>
      String(message).includes('"repeated"'),
    );
    expect(collisionWarnings).toHaveLength(1);
  });

  it("tools with unique names keep their names and log no warning", async () => {
    const warn = spyOnWarn();

    const { requests } = await runClassicAgent({
      mcpClients: [
        objectProvider([fakeTool("uniqueA", "a")]),
        objectProvider([fakeTool("uniqueB", "b")]),
      ],
    });

    expect(requestToolNames(requests[0])).toEqual(
      expect.arrayContaining(["uniqueA", "uniqueB"]),
    );
    expect(warn).not.toHaveBeenCalledWith(
      expect.stringContaining("MCP tool name"),
    );
  });
});

describe("mcpClients: failures and cancellation", () => {
  it("a tools() rejection fails the run with RUN_ERROR before the model runs", async () => {
    const failing = {
      tools: vi.fn(async (): Promise<readonly AnyTool[]> => {
        throw new Error("MCP connection lost");
      }),
    };
    const { agent, requests } = createClassicAgent({ mcpClients: [failing] });

    const { events } = await collectEventsIncludingErrors(
      agent.run(createDefaultInput()),
    );

    const [runError] = eventsOfType(events, EventType.RUN_ERROR);
    expect(runError.message).toBe("MCP connection lost");
    expect(requests).toHaveLength(0);
  });

  it("stops after a tool lookup that the run cancelled, and does not close the client", async () => {
    let resolveTools!: (tools: readonly AnyTool[]) => void;
    const first = objectProvider([]);
    first.tools.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveTools = resolve;
        }),
    );
    const second = objectProvider([]);
    const { agent, requests } = createClassicAgent({
      mcpClients: [first, second],
    });

    const run = collectEvents(agent.run(createDefaultInput()));
    await vi.waitFor(() => expect(first.tools).toHaveBeenCalledOnce());
    agent.abortRun();
    resolveTools([]);
    await run;

    expect(second.tools).not.toHaveBeenCalled();
    expect(first.close).not.toHaveBeenCalled();
    expect(requests).toHaveLength(0);
  });
});
