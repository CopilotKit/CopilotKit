import { afterEach, describe, expect, it, vi } from "vitest";
import type { AbstractAgent } from "@ag-ui/client";
import { bindMcpApp } from "../session";
import type { McpAppSession } from "../session";
import type { MCPAppsActivityContent } from "../content-schema";

// ---------------------------------------------------------------------------
// Minimal agent mock: only what bindMcpApp + the request queue touch.
// ---------------------------------------------------------------------------
function makeAgent(overrides?: Partial<Record<string, unknown>>) {
  const addMessageCalls: Array<{ id: string; role: string; content: string }> =
    [];
  const runAgentCalls: Array<any> = [];
  const agent = {
    agentId: "test-agent",
    threadId: "thread-1",
    isRunning: false,
    addMessageCalls,
    runAgentCalls,
    addMessage(msg: { id: string; role: string; content: string }) {
      addMessageCalls.push(msg);
    },
    subscribe() {
      return { unsubscribe() {} };
    },
    async runAgent(input?: any) {
      runAgentCalls.push(input);
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
      if (req?.method === "tools/call") {
        return {
          result: {
            content: [{ type: "text", text: "tool ok" }],
            isError: false,
          },
          newMessages: [],
        };
      }
      return { result: {}, newMessages: [] };
    },
    ...overrides,
  };
  return agent as unknown as AbstractAgent & {
    addMessageCalls: typeof addMessageCalls;
    runAgentCalls: typeof runAgentCalls;
  };
}

function makeContent(
  over?: Partial<MCPAppsActivityContent>,
): MCPAppsActivityContent {
  return {
    resourceUri: "ui://test/app",
    serverHash: "hash-123",
    result: { content: [], isError: false },
    toolInput: {},
    ...over,
  } as MCPAppsActivityContent;
}

const tick = (ms = 30) => new Promise((r) => setTimeout(r, ms));

/** Dispatch a JSON-RPC message from the iframe (source = its contentWindow). */
function fromIframe(iframe: HTMLIFrameElement, data: unknown) {
  window.dispatchEvent(
    new MessageEvent("message", {
      data,
      source: iframe.contentWindow,
      origin: "",
    }),
  );
}

/** Capture messages the host posts back to the iframe. */
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

function mount() {
  const iframe = document.createElement("iframe");
  document.body.appendChild(iframe);
  iframes.push(iframe);
  return iframe;
}

/**
 * Bind + wait for setup (resource fetch + connect) + simulate the sandbox proxy
 * ready handshake, mirroring the react-core MCP e2e harness.
 */
async function bindAndConnect(
  iframe: HTMLIFrameElement,
  agent: AbstractAgent,
  content = makeContent(),
  hooks?: Parameters<typeof bindMcpApp>[0]["hooks"],
) {
  const session = bindMcpApp({
    iframe,
    getContent: () => content,
    getAgent: () => agent,
    host: { runAgent: async () => ({ result: undefined, newMessages: [] }) },
    hooks,
  });
  sessions.push(session);
  await tick(60); // let fetchResource + bridge.connect settle
  const captured = captureOutgoing(iframe);
  fromIframe(iframe, {
    jsonrpc: "2.0",
    method: "ui/notifications/sandbox-proxy-ready",
  });
  await tick(30);
  return { session, captured };
}

afterEach(() => {
  sessions.forEach((s) => s.teardown());
  sessions = [];
  iframes.forEach((f) => f.remove());
  iframes = [];
  vi.restoreAllMocks();
});

describe("bindMcpApp", () => {
  it("fetches the resource through the agent and loads the sandbox", async () => {
    const agent = makeAgent();
    const iframe = mount();
    await bindAndConnect(iframe, agent);

    const readCall = agent.runAgentCalls.find(
      (c) =>
        c?.forwardedProps?.__proxiedMCPRequest?.method === "resources/read",
    );
    expect(readCall).toBeDefined();
    expect(iframe.getAttribute("data-testid")).toBe("mcp-app-iframe");
    expect(iframe.srcdoc).toContain("sandbox-proxy-ready");
  });

  it("proxies tools/call through the agent and returns the result to the iframe", async () => {
    const agent = makeAgent();
    const iframe = mount();
    const { captured } = await bindAndConnect(iframe, agent);

    const id = "call-1";
    fromIframe(iframe, {
      jsonrpc: "2.0",
      id,
      method: "tools/call",
      params: { name: "do_thing", arguments: { a: 1 } },
    });
    await tick(40);

    const toolCall = agent.runAgentCalls.find(
      (c) => c?.forwardedProps?.__proxiedMCPRequest?.method === "tools/call",
    );
    expect(toolCall).toBeDefined();
    const response = captured.find((m) => m && m.id === id && "result" in m);
    expect(response?.result?.content?.[0]?.text).toBe("tool ok");
  });

  it("opens https links and blocks javascript: links (ui/open-link)", async () => {
    const agent = makeAgent();
    const iframe = mount();
    const { captured } = await bindAndConnect(iframe, agent);
    const openSpy = vi.spyOn(window, "open").mockImplementation(() => null);

    fromIframe(iframe, {
      jsonrpc: "2.0",
      id: "ok",
      method: "ui/open-link",
      params: { url: "https://example.com" },
    });
    await tick(20);
    expect(openSpy).toHaveBeenCalledWith(
      "https://example.com",
      "_blank",
      "noopener,noreferrer",
    );

    openSpy.mockClear();
    fromIframe(iframe, {
      jsonrpc: "2.0",
      id: "bad",
      // eslint-disable-next-line no-script-url
      method: "ui/open-link",
      params: { url: "javascript:alert(1)" },
    });
    await tick(20);
    expect(openSpy).not.toHaveBeenCalled();
    const badResp = captured.find((m) => m && m.id === "bad" && "result" in m);
    expect(badResp?.result).toMatchObject({ isError: true });
  });

  it("adds a ui/message to the agent (role from _meta.copilotkit)", async () => {
    const agent = makeAgent();
    const iframe = mount();
    await bindAndConnect(iframe, agent);

    fromIframe(iframe, {
      jsonrpc: "2.0",
      id: "msg-1",
      method: "ui/message",
      params: {
        content: [{ type: "text", text: "hello from widget" }],
        _meta: { copilotkit: { role: "assistant", followUp: false } },
      },
    });
    await tick(30);

    const call = agent.addMessageCalls.find(
      (c) => c.content === "hello from widget",
    );
    expect(call).toBeDefined();
    expect(call?.role).toBe("assistant");
  });

  it("fires onInitialized when the widget reports initialized", async () => {
    const agent = makeAgent();
    const iframe = mount();
    const onInitialized = vi.fn();
    const { session } = await bindAndConnect(iframe, agent, makeContent(), {
      onInitialized,
    });

    fromIframe(iframe, {
      jsonrpc: "2.0",
      method: "ui/notifications/initialized",
    });
    await tick(20);
    expect(onInitialized).toHaveBeenCalled();

    // tool input pushed after initialize reaches the iframe
    session.sendToolInput({ a: 1 });
    await tick(10);
  });
});
