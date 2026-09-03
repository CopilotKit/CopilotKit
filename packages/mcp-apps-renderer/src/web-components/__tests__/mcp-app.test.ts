import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type { AbstractAgent } from "@ag-ui/client";
import { defineMcpAppWebComponents } from "../define";
import { COPILOTKIT_MCP_APP_TAG } from "../index";
import type { CopilotKitMcpApp } from "../mcp-app";
import type { MCPAppsActivityContent } from "../../content-schema";

// Minimal agent mock: only what bindMcpApp + the request queue touch.
function makeAgent() {
  const runAgentCalls: Array<any> = [];
  const agent = {
    agentId: "test-agent",
    threadId: "thread-1",
    isRunning: false,
    runAgentCalls,
    addMessage() {},
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
      return { result: {}, newMessages: [] };
    },
  };
  return agent as unknown as AbstractAgent & {
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

let elements: CopilotKitMcpApp[] = [];

async function mountApp(opts?: { content?: MCPAppsActivityContent }) {
  const agent = makeAgent();
  const el = document.createElement(COPILOTKIT_MCP_APP_TAG) as CopilotKitMcpApp;
  el.agent = agent;
  el.host = { runAgent: async () => ({ result: undefined, newMessages: [] }) };
  el.content = opts?.content ?? makeContent();
  document.body.appendChild(el);
  elements.push(el);
  await el.updateComplete;
  await tick(60); // let fetchResource + bridge.connect settle
  const iframe = el.querySelector("iframe") as HTMLIFrameElement;
  return { el, agent, iframe };
}

/** Simulate the sandbox proxy-ready + initialized handshake. */
async function handshake(iframe: HTMLIFrameElement) {
  fromIframe(iframe, {
    jsonrpc: "2.0",
    method: "ui/notifications/sandbox-proxy-ready",
  });
  await tick(20);
  fromIframe(iframe, {
    jsonrpc: "2.0",
    method: "ui/notifications/initialized",
  });
  await tick(20);
}

beforeAll(() => {
  defineMcpAppWebComponents();
});

afterEach(() => {
  elements.forEach((el) => el.remove());
  elements = [];
  vi.restoreAllMocks();
});

describe("<copilotkit-mcp-app>", () => {
  it("registers the custom element", () => {
    expect(customElements.get(COPILOTKIT_MCP_APP_TAG)).toBeDefined();
  });

  it("creates the sandbox iframe once and binds through the agent", async () => {
    const { agent, iframe } = await mountApp();
    expect(iframe).toBeTruthy();
    expect(iframe.getAttribute("data-testid")).toBe("mcp-app-iframe");
    const readCall = agent.runAgentCalls.find(
      (c) =>
        c?.forwardedProps?.__proxiedMCPRequest?.method === "resources/read",
    );
    expect(readCall).toBeDefined();
  });

  it("does NOT remount the iframe when content changes", async () => {
    const { el, iframe } = await mountApp();
    expect(iframe).toBeTruthy();

    el.content = makeContent({ toolInput: { a: 1 } });
    await el.updateComplete;
    await tick(10);

    const iframeAfter = el.querySelector("iframe");
    expect(iframeAfter).toBe(iframe); // same node, never recreated
  });

  it("emits copilotkit-mcp-initialized when the widget initializes", async () => {
    const { el, iframe } = await mountApp();
    const onInit = vi.fn();
    el.addEventListener("copilotkit-mcp-initialized", onInit);
    await handshake(iframe);
    expect(onInit).toHaveBeenCalled();
  });

  it("tears down the session on disconnect without throwing", async () => {
    const { el, iframe } = await mountApp();
    await handshake(iframe);
    expect(() => el.remove()).not.toThrow();
    // Post-teardown messages are ignored (no throw).
    fromIframe(iframe, {
      jsonrpc: "2.0",
      method: "ui/notifications/initialized",
    });
    await tick(10);
  });
});
