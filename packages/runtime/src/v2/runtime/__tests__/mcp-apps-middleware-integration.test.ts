import { describe, it, expect, afterEach, vi } from "vitest";
import {
  AbstractAgent,
  RunAgentInput,
  BaseEvent,
  EventType,
} from "@ag-ui/client";
import { Observable } from "rxjs";
import { LLMock, MCPMock } from "@copilotkit/aimock";
import { MCPAppsMiddleware, getServerHash } from "@ag-ui/mcp-apps-middleware";

/**
 * A minimal next-agent that emits RUN_STARTED and RUN_FINISHED.
 * Used as the downstream agent when the middleware should NOT delegate.
 */
class MockNextAgent extends AbstractAgent {
  run(input: RunAgentInput): Observable<BaseEvent> {
    return new Observable((subscriber) => {
      subscriber.next({
        type: EventType.RUN_STARTED,
        threadId: input.threadId,
        runId: input.runId,
      } as BaseEvent);
      subscriber.next({
        type: EventType.RUN_FINISHED,
        threadId: input.threadId,
        runId: input.runId,
      } as BaseEvent);
      subscriber.complete();
    });
  }

  clone(): AbstractAgent {
    return new MockNextAgent();
  }

  protected connect(): ReturnType<AbstractAgent["connect"]> {
    throw new Error("not used");
  }
}

function createRunInput(overrides: Partial<RunAgentInput> = {}): RunAgentInput {
  return {
    threadId: "thread-1",
    runId: "run-1",
    state: {},
    messages: [],
    tools: [],
    context: [],
    forwardedProps: undefined,
    ...overrides,
  };
}

async function collectEvents(
  observable: Observable<BaseEvent>,
): Promise<BaseEvent[]> {
  const events: BaseEvent[] = [];
  await new Promise<void>((resolve, reject) => {
    observable.subscribe({
      next: (event) => events.push(event),
      error: reject,
      complete: resolve,
    });
  });
  return events;
}

describe("MCPAppsMiddleware integration", () => {
  let llm: LLMock;
  let mcpMock: MCPMock;

  afterEach(async () => {
    if (llm) {
      await llm.stop().catch(() => {});
    }
  });

  async function startMcpServer(): Promise<string> {
    mcpMock = new MCPMock();
    mcpMock.addTool({
      name: "get_weather",
      description: "Get the weather",
      inputSchema: {
        type: "object",
        properties: { city: { type: "string" } },
      },
    });
    mcpMock.onToolCall("get_weather", (args: unknown) => {
      const parsed = args as { city?: string };
      return `Weather in ${parsed.city || "unknown"}: sunny`;
    });
    mcpMock.addResource(
      {
        uri: "app://dashboard",
        name: "Dashboard",
        mimeType: "text/plain",
      },
      { text: "Dashboard content here" },
    );

    llm = new LLMock({ port: 0 });
    llm.mount("/mcp", mcpMock);
    await llm.start();
    return `${llm.url}/mcp`;
  }

  it("can be created with mcpServers config pointing at MCPMock URL", async () => {
    const mcpUrl = await startMcpServer();

    const middleware = new MCPAppsMiddleware({
      mcpServers: [{ type: "http", url: mcpUrl }],
    });

    expect(middleware).toBeInstanceOf(MCPAppsMiddleware);
  });

  it("proxies tools/call through to MCPMock and returns results", async () => {
    const mcpUrl = await startMcpServer();

    const serverConfig = { type: "http" as const, url: mcpUrl };
    const serverHash = getServerHash(serverConfig);

    const middleware = new MCPAppsMiddleware({
      mcpServers: [serverConfig],
    });

    const input = createRunInput({
      forwardedProps: {
        __proxiedMCPRequest: {
          serverHash,
          method: "tools/call",
          params: {
            name: "get_weather",
            arguments: { city: "NYC" },
          },
        },
      },
    });

    const mockAgent = new MockNextAgent();
    const events = await collectEvents(middleware.run(input, mockAgent));

    // Should have RUN_STARTED and RUN_FINISHED
    const types = events.map((e) => e.type);
    expect(types).toContain(EventType.RUN_STARTED);
    expect(types).toContain(EventType.RUN_FINISHED);

    // RUN_FINISHED should contain the MCP tool result
    const runFinished = events.find(
      (e) => e.type === EventType.RUN_FINISHED,
    ) as BaseEvent & { result?: unknown };
    expect(runFinished).toBeDefined();
    expect(runFinished.result).toBeDefined();

    // The result should contain the tool's text content
    const result = runFinished.result as { content?: unknown[] };
    expect(result.content).toBeDefined();
    expect(Array.isArray(result.content)).toBe(true);

    const textContent = (
      result.content as Array<{ type: string; text?: string }>
    ).find((c) => c.type === "text");
    expect(textContent).toBeDefined();
    expect(textContent!.text).toContain("sunny");
  });

  it("non-proxied request delegates to next agent", async () => {
    const mcpUrl = await startMcpServer();

    const middleware = new MCPAppsMiddleware({
      mcpServers: [{ type: "http", url: mcpUrl }],
    });

    // Input WITHOUT __proxiedMCPRequest — should delegate to MockNextAgent
    const input = createRunInput();

    const mockAgent = new MockNextAgent();

    const events = await collectEvents(middleware.run(input, mockAgent));

    // MockNextAgent's run should have been called (delegation happened)
    // The middleware calls runNextWithState which internally calls next.run,
    // but since processStream wraps it, we check the output events instead
    const types = events.map((e) => e.type);
    expect(types).toContain(EventType.RUN_STARTED);
    expect(types).toContain(EventType.RUN_FINISHED);
  });

  it("wrong serverHash returns error in RUN_FINISHED result", async () => {
    const mcpUrl = await startMcpServer();

    const middleware = new MCPAppsMiddleware({
      mcpServers: [{ type: "http", url: mcpUrl }],
    });

    const input = createRunInput({
      forwardedProps: {
        __proxiedMCPRequest: {
          serverHash: "nonexistent-hash-value",
          method: "tools/call",
          params: {
            name: "get_weather",
            arguments: { city: "NYC" },
          },
        },
      },
    });

    const mockAgent = new MockNextAgent();
    const events = await collectEvents(middleware.run(input, mockAgent));

    // Should still get RUN_STARTED and RUN_FINISHED
    const types = events.map((e) => e.type);
    expect(types).toContain(EventType.RUN_STARTED);
    expect(types).toContain(EventType.RUN_FINISHED);

    // RUN_FINISHED should contain an error about unknown server
    const runFinished = events.find(
      (e) => e.type === EventType.RUN_FINISHED,
    ) as BaseEvent & { result?: unknown };
    expect(runFinished).toBeDefined();
    const result = runFinished.result as { error?: string };
    expect(result.error).toBeDefined();
    expect(result.error).toContain("nonexistent-hash-value");
  });

  it("proxies resources/read through to MCPMock and returns results", async () => {
    const mcpUrl = await startMcpServer();

    const serverConfig = { type: "http" as const, url: mcpUrl };
    const serverHash = getServerHash(serverConfig);

    const middleware = new MCPAppsMiddleware({
      mcpServers: [serverConfig],
    });

    const input = createRunInput({
      forwardedProps: {
        __proxiedMCPRequest: {
          serverHash,
          method: "resources/read",
          params: { uri: "app://dashboard" },
        },
      },
    });

    const mockAgent = new MockNextAgent();
    const events = await collectEvents(middleware.run(input, mockAgent));

    // Should have RUN_STARTED and RUN_FINISHED
    const types = events.map((e) => e.type);
    expect(types).toContain(EventType.RUN_STARTED);
    expect(types).toContain(EventType.RUN_FINISHED);

    // RUN_FINISHED should contain the resource content
    const runFinished = events.find(
      (e) => e.type === EventType.RUN_FINISHED,
    ) as BaseEvent & { result?: unknown };
    expect(runFinished).toBeDefined();
    expect(runFinished.result).toBeDefined();

    // The result should contain resource contents
    const result = runFinished.result as { contents?: unknown[] };
    expect(result.contents).toBeDefined();
    expect(Array.isArray(result.contents)).toBe(true);

    const resource = (
      result.contents as Array<{ uri: string; text?: string }>
    )[0];
    expect(resource).toBeDefined();
    expect(resource.uri).toBe("app://dashboard");
    expect(resource.text).toContain("Dashboard content here");
  });
});
