/**
 * ui/update-model-context through the real ext-apps bridge: the request
 * arrives from the iframe as JSON-RPC, the session answers it, and the
 * host's context store holds the latest state of each widget instance.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import type { AbstractAgent } from "@ag-ui/client";
import { bindMcpApp } from "../session";
import type { McpAppSession } from "../session";
import type { MCPAppsActivityContent } from "../content-schema";
import { MCP_APPS_MODEL_CONTEXT_CAPABILITY } from "../model-context";

const tick = (ms = 30) => new Promise((resolve) => setTimeout(resolve, ms));

function makeAgent(threadId = "thread-a") {
  const agent = {
    agentId: "agent",
    threadId,
    isRunning: false,
    messages: [],
    addMessage: vi.fn(),
    subscribe: () => ({ unsubscribe() {} }),
    runAgent: vi.fn(async (input?: any) => {
      const req = input?.forwardedProps?.__proxiedMCPRequest;
      if (req?.method === "resources/read") {
        return {
          result: {
            contents: [
              {
                uri: req.params?.uri,
                mimeType: "text/html",
                text: "<html><body>Widget</body></html>",
              },
            ],
          },
          newMessages: [],
        };
      }
      return { result: {}, newMessages: [] };
    }),
  };
  return agent as unknown as AbstractAgent & {
    runAgent: ReturnType<typeof vi.fn>;
    addMessage: ReturnType<typeof vi.fn>;
  };
}

/** A host shaped like CopilotKitCore: runs, plus a context store. */
function makeHost() {
  const entries = new Map<string, Record<string, unknown>>();
  return {
    entries,
    runAgent: vi.fn(async () => ({ result: undefined, newMessages: [] })),
    upsertContext: vi.fn((id: string, context: Record<string, unknown>) => {
      entries.set(id, context);
    }),
    removeContext: vi.fn((id: string) => {
      entries.delete(id);
    }),
  };
}

function makeContent(
  over?: Partial<MCPAppsActivityContent>,
): MCPAppsActivityContent {
  return {
    resourceUri: "ui://trains/stations",
    serverHash: "hash-1",
    serverId: "trains",
    result: { content: [], isError: false },
    toolInput: {},
    ...over,
  } as MCPAppsActivityContent;
}

function fromIframe(iframe: HTMLIFrameElement, data: unknown) {
  window.dispatchEvent(
    new MessageEvent("message", {
      data,
      source: iframe.contentWindow,
      origin: "",
    }),
  );
}

function captureOutgoing(iframe: HTMLIFrameElement) {
  const captured: any[] = [];
  const cw = iframe.contentWindow as Window;
  const orig = cw.postMessage.bind(cw);
  cw.postMessage = ((message: unknown, ...args: unknown[]) => {
    captured.push(message);
    return (orig as any)(message, ...args);
  }) as typeof cw.postMessage;
  return captured;
}

let sessions: McpAppSession[] = [];
let iframes: HTMLIFrameElement[] = [];

afterEach(() => {
  sessions.forEach((session) => session.teardown());
  sessions = [];
  iframes.forEach((iframe) => iframe.remove());
  iframes = [];
});

async function bindAndConnect({
  agent = makeAgent(),
  host = makeHost() as Parameters<typeof bindMcpApp>[0]["host"],
  content = makeContent(),
  messageId = "activity-1",
}: {
  agent?: AbstractAgent;
  host?: Parameters<typeof bindMcpApp>[0]["host"];
  content?: MCPAppsActivityContent;
  messageId?: string | undefined;
} = {}) {
  const iframe = document.createElement("iframe");
  document.body.appendChild(iframe);
  iframes.push(iframe);
  const session = bindMcpApp({
    iframe,
    getContent: () => content,
    getAgent: () => agent,
    host,
    messageId,
  });
  sessions.push(session);
  await tick(60);
  const captured = captureOutgoing(iframe);
  fromIframe(iframe, {
    jsonrpc: "2.0",
    method: "ui/notifications/sandbox-proxy-ready",
  });
  await tick(30);
  return { iframe, session, captured };
}

let requestCounter = 0;
async function request(
  iframe: HTMLIFrameElement,
  captured: any[],
  method: string,
  params: Record<string, unknown>,
) {
  const id = `req-${++requestCounter}`;
  fromIframe(iframe, { jsonrpc: "2.0", id, method, params });
  await tick(30);
  return captured.find((message) => message?.id === id);
}

const updateContext = (
  iframe: HTMLIFrameElement,
  captured: any[],
  params: Record<string, unknown>,
) => request(iframe, captured, "ui/update-model-context", params);

describe("ui/update-model-context through the session", () => {
  it("announces the capability when the host stores model context", async () => {
    const { iframe, captured } = await bindAndConnect();

    const response = await request(iframe, captured, "ui/initialize", {
      appInfo: { name: "widget", version: "1.0.0" },
      appCapabilities: {},
      protocolVersion: "2026-01-26",
    });

    expect(response.result.hostCapabilities.updateModelContext).toEqual(
      MCP_APPS_MODEL_CONTEXT_CAPABILITY,
    );
  });

  it("stores the update and answers {} without a chat message or a run", async () => {
    const agent = makeAgent();
    const host = makeHost();
    const { iframe, captured } = await bindAndConnect({ agent, host });
    const runsBefore = agent.runAgent.mock.calls.length;

    const response = await updateContext(iframe, captured, {
      content: [{ type: "text", text: "The user looks at Lyon." }],
      structuredContent: { stationId: "lyon" },
    });

    expect(response.result).toEqual({});
    expect(host.entries.size).toBe(1);
    const [entry] = [...host.entries.values()];
    expect(entry).toMatchObject({ agentIds: ["agent"], threadId: "thread-a" });
    expect(JSON.parse(entry.value as string)).toEqual({
      text: ["The user looks at Lyon."],
      structuredContent: { stationId: "lyon" },
    });
    expect(agent.addMessage).not.toHaveBeenCalled();
    expect(agent.runAgent.mock.calls.length).toBe(runsBefore);
    expect(host.runAgent).not.toHaveBeenCalled();
  });

  it("keeps a single entry per widget instance: the latest update wins", async () => {
    const host = makeHost();
    const { iframe, captured } = await bindAndConnect({ host });

    await updateContext(iframe, captured, {
      structuredContent: { stationId: "lyon" },
    });
    await updateContext(iframe, captured, {
      structuredContent: { stationId: "paris" },
    });

    expect(host.entries.size).toBe(1);
    expect([...host.entries.values()][0].value).toBe(
      JSON.stringify({ structuredContent: { stationId: "paris" } }),
    );
  });

  it("keeps two widgets' entries apart, and a clear only removes its own", async () => {
    const host = makeHost();
    const agent = makeAgent();
    const first = await bindAndConnect({ host, agent, messageId: "a-1" });
    const second = await bindAndConnect({ host, agent, messageId: "a-2" });

    await updateContext(first.iframe, first.captured, {
      structuredContent: { widget: 1 },
    });
    await updateContext(second.iframe, second.captured, {
      structuredContent: { widget: 2 },
    });
    expect(host.entries.size).toBe(2);

    const cleared = await updateContext(first.iframe, first.captured, {});

    expect(cleared.result).toEqual({});
    expect([...host.entries.values()].map((entry) => entry.value)).toEqual([
      JSON.stringify({ structuredContent: { widget: 2 } }),
    ]);
  });

  it("refuses unsupported content with a JSON-RPC error and keeps the previous state", async () => {
    const host = makeHost();
    const { iframe, captured } = await bindAndConnect({ host });
    await updateContext(iframe, captured, {
      structuredContent: { stationId: "lyon" },
    });

    const response = await updateContext(iframe, captured, {
      content: [{ type: "image", data: "aGVsbG8=", mimeType: "image/png" }],
    });

    expect(response.error).toBeDefined();
    expect(response.error.message).toContain("image");
    expect(response.result).toBeUndefined();
    expect([...host.entries.values()][0].value).toBe(
      JSON.stringify({ structuredContent: { stationId: "lyon" } }),
    );
  });

  it("refuses an update once the shared agent moved to another conversation", async () => {
    const agent = makeAgent("thread-a");
    const host = makeHost();
    const { iframe, captured } = await bindAndConnect({ agent, host });

    (agent as { threadId: string }).threadId = "thread-b";
    const response = await updateContext(iframe, captured, {
      structuredContent: { stationId: "lyon" },
    });

    expect(response.error.message).toContain("no longer the current one");
    expect(host.entries.size).toBe(0);
  });

  it("keeps the snapshot when the widget is torn down", async () => {
    const host = makeHost();
    const { iframe, captured, session } = await bindAndConnect({ host });
    await updateContext(iframe, captured, {
      structuredContent: { stationId: "lyon" },
    });

    session.teardown();

    expect(host.entries.size).toBe(1);
    expect(host.removeContext).not.toHaveBeenCalled();
  });

  it("writes a remounted widget's update over its previous snapshot", async () => {
    const host = makeHost();
    const agent = makeAgent();
    const first = await bindAndConnect({ host, agent });
    await updateContext(first.iframe, first.captured, {
      structuredContent: { step: 1 },
    });
    first.session.teardown();

    const second = await bindAndConnect({ host, agent });
    await updateContext(second.iframe, second.captured, {
      structuredContent: { step: 2 },
    });

    expect(host.entries.size).toBe(1);
  });

  describe("a host without a context store", () => {
    const runOnlyHost = () => ({
      runAgent: vi.fn(async () => ({ result: undefined, newMessages: [] })),
    });

    it("does not announce the capability, even when the options list it", async () => {
      const iframe = document.createElement("iframe");
      document.body.appendChild(iframe);
      iframes.push(iframe);
      const session = bindMcpApp({
        iframe,
        getContent: () => makeContent(),
        getAgent: () => makeAgent(),
        host: runOnlyHost(),
        options: {
          hostCapabilities: { updateModelContext: { text: {} } },
        },
      });
      sessions.push(session);
      await tick(60);
      const captured = captureOutgoing(iframe);
      fromIframe(iframe, {
        jsonrpc: "2.0",
        method: "ui/notifications/sandbox-proxy-ready",
      });
      await tick(30);

      const response = await request(iframe, captured, "ui/initialize", {
        appInfo: { name: "widget", version: "1.0.0" },
        appCapabilities: {},
        protocolVersion: "2026-01-26",
      });

      expect(
        response.result.hostCapabilities.updateModelContext,
      ).toBeUndefined();
    });

    it("does not acknowledge an update it cannot keep", async () => {
      const { iframe, captured } = await bindAndConnect({
        host: runOnlyHost(),
      });

      const response = await updateContext(iframe, captured, {
        structuredContent: { stationId: "lyon" },
      });

      expect(response.result).toBeUndefined();
      expect(response.error.code).toBe(-32601);
    });
  });
});
