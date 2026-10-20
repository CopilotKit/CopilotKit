import { MCPAppsMiddleware, getServerHash } from "@ag-ui/mcp-apps-middleware";
import { expect, test, vi } from "vitest";
import { createServer } from "node:http";
import { once } from "node:events";
import { AbstractAgent, EventType } from "@ag-ui/client";
import type { BaseEvent, RunAgentInput } from "@ag-ui/client";
import { Observable, firstValueFrom, toArray } from "rxjs";
import { MCPMock } from "@copilotkit/aimock";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js";

/** Build one protocol input without a platform dependency. */
function input(forwardedProps: Record<string, unknown> = {}): RunAgentInput {
  return {
    threadId: "thread",
    runId: "run",
    messages: [],
    state: {},
    tools: [],
    context: [],
    forwardedProps,
  };
}

/** Emit a UI tool call only when discovery made the tool available. */
class TestAgent extends AbstractAgent {
  readonly called = vi.fn();
  run(value: RunAgentInput): Observable<BaseEvent> {
    this.called(value);
    return new Observable((subscriber) => {
      subscriber.next({
        type: EventType.RUN_STARTED,
        threadId: value.threadId,
        runId: value.runId,
      });
      if (value.tools.some((tool) => tool.name === "card")) {
        subscriber.next({
          type: EventType.TOOL_CALL_START,
          toolCallId: "call",
          toolCallName: "card",
        });
        subscriber.next({
          type: EventType.TOOL_CALL_ARGS,
          toolCallId: "call",
          delta: '{"title":"Hello"}',
        });
        subscriber.next({ type: EventType.TOOL_CALL_END, toolCallId: "call" });
      }
      subscriber.next({
        type: EventType.RUN_FINISHED,
        threadId: value.threadId,
        runId: value.runId,
      });
      subscriber.complete();
    });
  }
}

/** Expose an authenticated real Streamable HTTP fixture and record session cleanup. */
async function server() {
  const mock = new MCPMock({ port: 0 });
  const tool = {
    name: "card",
    description: "Card",
    inputSchema: {
      type: "object" as const,
      properties: { title: { type: "string" } },
    },
    _meta: { "ui/resourceUri": "ui://card" },
  };
  mock.addTool(tool);
  mock.onToolCall("card", () => "rendered card");
  mock.addResource(
    { uri: "ui://card", name: "Card", mimeType: "text/html+mcp" },
    { text: "<h1>Card</h1>", mimeType: "text/html+mcp" },
  );
  const upstream = await mock.start();
  const requests: Array<{
    method: string;
    authorization?: string;
    session?: string;
  }> = [];
  const proxy = createServer(async (request, response) => {
    requests.push({
      method: request.method!,
      authorization: request.headers.authorization,
      session: request.headers["mcp-session-id"] as string | undefined,
    });
    if (request.headers.authorization !== "Bearer fixture-secret") {
      response.writeHead(401).end();
      return;
    }
    const chunks: Buffer[] = [];
    for await (const chunk of request) chunks.push(Buffer.from(chunk));
    const headers = new Headers({
      accept: "application/json, text/event-stream",
      "content-type": "application/json",
    });
    for (const key of ["mcp-session-id", "mcp-protocol-version"])
      if (request.headers[key]) headers.set(key, String(request.headers[key]));
    const result = await fetch(upstream, {
      method: request.method,
      headers,
      ...(chunks.length ? { body: Buffer.concat(chunks) } : {}),
    });
    response.writeHead(
      result.status,
      Object.fromEntries(
        [...result.headers].filter(([key]) =>
          ["content-type", "mcp-session-id"].includes(key),
        ),
      ),
    );
    response.end(Buffer.from(await result.arrayBuffer()));
  });
  proxy.listen(0, "127.0.0.1");
  await once(proxy, "listening");
  const address = proxy.address();
  if (!address || typeof address === "string")
    throw new Error("No fixture address");
  return {
    url: `http://127.0.0.1:${address.port}`,
    requests,
    async teardown(): Promise<void> {
      await new Promise<void>((resolve) => {
        proxy.closeAllConnections();
        proxy.close(() => resolve());
      });
      await mock.stop();
    },
  };
}

test("authenticated HTTP discovery executes UI tools and deletes successful sessions", async () => {
  const fixture = await server();
  try {
    const middleware = new MCPAppsMiddleware({
      discoveryFailureMode: "throw",
      mcpServers: [
        {
          type: "http",
          url: fixture.url,
          serverId: "cards",
          headers: { Authorization: "Bearer fixture-secret" },
        },
      ],
    });
    const agent = new TestAgent();
    const events = await firstValueFrom(
      middleware.run(input(), agent).pipe(toArray()),
    );
    expect(agent.called).toHaveBeenCalledOnce();
    expect(
      events.some(
        (event) =>
          event.type === EventType.ACTIVITY_SNAPSHOT &&
          event.activityType === "mcp-apps",
      ),
    ).toBe(true);
    expect(events.at(-1)?.type).toBe(EventType.RUN_FINISHED);
    expect(
      fixture.requests.filter((request) => request.method === "DELETE").length,
    ).toBeGreaterThanOrEqual(2);
    expect(
      fixture.requests.every(
        (request) => request.authorization === "Bearer fixture-secret",
      ),
    ).toBe(true);
  } finally {
    await fixture.teardown();
  }
});

test("unknown and disallowed proxy requests never reach the network or agent", async () => {
  const fixture = await server();
  try {
    const agent = new TestAgent();
    const middleware = new MCPAppsMiddleware({
      discoveryFailureMode: "throw",
      mcpServers: [{ type: "http", url: fixture.url, serverId: "cards" }],
    });
    for (const request of [
      { serverId: "unknown", method: "resources/read" },
      { serverId: "cards", method: "tools/list" },
    ]) {
      const events = await firstValueFrom(
        middleware
          .run(input({ __proxiedMCPRequest: request }), agent)
          .pipe(toArray()),
      );
      expect(events.at(-1)).toMatchObject({
        type: EventType.RUN_FINISHED,
        result: { error: expect.any(String) },
      });
    }
    expect(agent.called).not.toHaveBeenCalled();
    expect(fixture.requests).toHaveLength(0);
  } finally {
    await fixture.teardown();
  }
});

test("browser proxy fields cannot replace configured headers or URL", async () => {
  const fixture = await server();
  try {
    const agent = new TestAgent();
    const middleware = new MCPAppsMiddleware({
      discoveryFailureMode: "throw",
      mcpServers: [
        {
          type: "http",
          url: fixture.url,
          serverId: "cards",
          headers: { Authorization: "Bearer fixture-secret" },
        },
      ],
    });
    const events = await firstValueFrom(
      middleware
        .run(
          input({
            __proxiedMCPRequest: {
              serverId: "cards",
              method: "resources/read",
              params: { uri: "ui://card" },
              url: "http://127.0.0.1:1",
              headers: { Authorization: "Bearer attacker" },
            },
          }),
          agent,
        )
        .pipe(toArray()),
    );
    expect(events.at(-1)).toMatchObject({
      type: EventType.RUN_FINISHED,
      result: { contents: [{ text: "<h1>Card</h1>" }] },
    });
    expect(agent.called).not.toHaveBeenCalled();
  } finally {
    await fixture.teardown();
  }
});

test("failed MCP authentication is isolated from the agent and exposes no raw error", async () => {
  const fixture = await server();
  try {
    const agent = new TestAgent();
    const middleware = new MCPAppsMiddleware({
      discoveryFailureMode: "throw",
      mcpServers: [
        {
          type: "http",
          url: fixture.url,
          headers: { Authorization: "Bearer private-wrong-secret" },
        },
      ],
    });

    await expect(
      firstValueFrom(middleware.run(input(), agent).pipe(toArray())),
    ).rejects.toThrow("MCP tool discovery failed");

    expect(agent.called).not.toHaveBeenCalled();
    expect(fixture.requests.length).toBeGreaterThan(0);
  } finally {
    await fixture.teardown();
  }
});

test("legacy SSE reentry keeps trusted authentication on GET and POST", async () => {
  const requests: Array<{ method?: string; authorization?: string }> = [];
  const sdkServer = new Server(
    { name: "legacy-fixture", version: "1.0.0" },
    { capabilities: {} },
  );
  let transport: SSEServerTransport | undefined;
  const httpServer = createServer(async (request, response) => {
    requests.push({
      method: request.method,
      authorization: request.headers.authorization,
    });
    if (request.headers.authorization !== "Bearer legacy-secret") {
      response.writeHead(401).end();
      return;
    }
    if (request.method === "GET") {
      transport = new SSEServerTransport("/messages", response);
      await sdkServer.connect(transport);
    } else if (transport) {
      await transport.handlePostMessage(request, response);
    } else {
      response.writeHead(404).end();
    }
  });
  httpServer.listen(0, "127.0.0.1");
  await once(httpServer, "listening");
  try {
    const address = httpServer.address();
    if (!address || typeof address === "string")
      throw new Error("No fixture address");
    const agent = new TestAgent();
    const middleware = new MCPAppsMiddleware({
      discoveryFailureMode: "throw",
      mcpServers: [
        {
          type: "sse",
          url: `http://127.0.0.1:${address.port}/sse`,
          serverId: "legacy",
          headers: { Authorization: "Bearer legacy-secret" },
        },
      ],
    });

    const events = await firstValueFrom(
      middleware
        .run(
          input({
            __proxiedMCPRequest: { serverId: "legacy", method: "ping" },
          }),
          agent,
        )
        .pipe(toArray()),
    );

    expect(events.at(-1)).toMatchObject({
      type: EventType.RUN_FINISHED,
      result: {},
    });
    expect(agent.called).not.toHaveBeenCalled();
    expect(requests.some((request) => request.method === "GET")).toBe(true);
    expect(requests.some((request) => request.method === "POST")).toBe(true);
    expect(
      requests.every(
        (request) => request.authorization === "Bearer legacy-secret",
      ),
    ).toBe(true);
  } finally {
    await sdkServer.close();
    await new Promise<void>((resolve) => {
      httpServer.closeAllConnections();
      httpServer.close(() => resolve());
    });
  }
});

test("activity hashes exclude credentials and remain valid for proxy selection", async () => {
  const fixture = await server();
  try {
    const config = {
      type: "http" as const,
      url: fixture.url,
      headers: { Authorization: "Bearer fixture-secret" },
    };
    const middleware = new MCPAppsMiddleware({
      discoveryFailureMode: "throw",
      mcpServers: [config],
    });
    const events = await firstValueFrom(
      middleware.run(input(), new TestAgent()).pipe(toArray()),
    );
    const activity = events.find(
      (event) =>
        event.type === EventType.ACTIVITY_SNAPSHOT &&
        event.activityType === "mcp-apps",
    );
    expect(activity).toMatchObject({
      content: {
        serverHash: getServerHash({ type: "http", url: fixture.url }),
      },
    });
    const proxied = await firstValueFrom(
      middleware
        .run(
          input({
            __proxiedMCPRequest: {
              serverHash: getServerHash({ type: "http", url: fixture.url }),
              method: "resources/read",
              params: { uri: "ui://card" },
            },
          }),
          new TestAgent(),
        )
        .pipe(toArray()),
    );
    expect(proxied.at(-1)).toMatchObject({
      result: { contents: [expect.objectContaining({ uri: "ui://card" })] },
    });
  } finally {
    await fixture.teardown();
  }
});
