/**
 * Tests for MCP Apps tool and resource proxying through the
 * iframe → agent → MCPMock chain.
 *
 * Covers:
 *   1. tools/call proxy round-trip (iframe sends tools/call, agent proxies, response returns)
 *   2. tools/call error handling (agent throws, iframe receives JSON-RPC error)
 *   3. ui/open-link handler (iframe sends url, window.open is called)
 *   4. Multiple independent MCP activities render without interference
 */
import { fireEvent, screen, waitFor, act } from "@testing-library/react";
import { vi } from "vitest";
import {
  activitySnapshotEvent,
  renderWithCopilotKit,
  runFinishedEvent,
  runStartedEvent,
  testId,
} from "../../../__tests__/utils/test-helpers";
import { MCPAppsActivityType } from "../../../components/MCPAppsActivityRenderer";
import type { RunAgentInput, RunAgentResult, BaseEvent } from "@ag-ui/client";
import { AbstractAgent, EventType } from "@ag-ui/client";
import type { Observable } from "rxjs";
import { Subject } from "rxjs";

// ---------------------------------------------------------------------------
// MockMCPProxyAgent — same shape as the one in MCPAppsUiMessage tests but
// trimmed to only what these proxy tests need.
// ---------------------------------------------------------------------------
class MockMCPProxyAgent extends AbstractAgent {
  private subject = new Subject<BaseEvent>();
  public runAgentCalls: Array<{ input: Partial<RunAgentInput> }> = [];

  private runAgentResponses: Map<string, unknown> = new Map();

  setRunAgentResponse(method: string, response: unknown) {
    this.runAgentResponses.set(method, response);
  }

  emit(event: BaseEvent) {
    if (event.type === EventType.RUN_STARTED) {
      this.isRunning = true;
    } else if (
      event.type === EventType.RUN_FINISHED ||
      event.type === EventType.RUN_ERROR
    ) {
      this.isRunning = false;
    }
    act(() => {
      this.subject.next(event);
    });
  }

  complete() {
    this.isRunning = false;
    act(() => {
      this.subject.complete();
    });
  }

  clone(): MockMCPProxyAgent {
    const cloned = new MockMCPProxyAgent();
    cloned.agentId = this.agentId;
    type Internal = {
      subject: Subject<BaseEvent>;
      runAgentCalls: Array<{ input: Partial<RunAgentInput> }>;
      runAgentResponses: Map<string, unknown>;
    };
    (cloned as unknown as Internal).subject = (
      this as unknown as Internal
    ).subject;
    (cloned as unknown as Internal).runAgentCalls = (
      this as unknown as Internal
    ).runAgentCalls;
    (cloned as unknown as Internal).runAgentResponses = (
      this as unknown as Internal
    ).runAgentResponses;

    const registry = this;
    Object.defineProperty(cloned, "isRunning", {
      get() {
        return registry.isRunning;
      },
      set(v: boolean) {
        registry.isRunning = v;
      },
      configurable: true,
      enumerable: true,
    });

    const proto = MockMCPProxyAgent.prototype;
    cloned.runAgent = async function (
      input?: Partial<RunAgentInput>,
    ): Promise<RunAgentResult> {
      const proxiedRequest = input?.forwardedProps?.__proxiedMCPRequest;
      if (proxiedRequest) {
        return registry.runAgent(input);
      }
      return proto.runAgent.call(cloned, input);
    };

    return cloned;
  }

  async detachActiveRun(): Promise<void> {}

  run(_input: RunAgentInput): Observable<BaseEvent> {
    return this.subject.asObservable();
  }

  async runAgent(input?: Partial<RunAgentInput>): Promise<RunAgentResult> {
    const proxiedRequest = input?.forwardedProps?.__proxiedMCPRequest as
      | {
          serverHash?: string;
          serverId?: string;
          method: string;
          params?: Record<string, unknown>;
        }
      | undefined;

    if (proxiedRequest) {
      if (input) {
        this.runAgentCalls.push({ input });
      }
      const method = proxiedRequest.method;
      const response = this.runAgentResponses.get(method);
      if (response !== undefined) {
        return { result: response, newMessages: [] };
      }
      if (method === "resources/read") {
        return {
          result: {
            contents: [
              {
                uri: proxiedRequest.params?.uri,
                mimeType: "text/html",
                text: "<html><body>Test content</body></html>",
              },
            ],
          },
          newMessages: [],
        };
      }
      if (method === "tools/call") {
        return {
          result: {
            content: [{ type: "text", text: "Tool call result" }],
            isError: false,
          },
          newMessages: [],
        };
      }
      return { result: {}, newMessages: [] };
    }

    return super.runAgent(input);
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function mcpAppsActivityContent(overrides: {
  resourceUri?: string;
  serverHash?: string;
}) {
  return {
    resourceUri: overrides.resourceUri ?? "ui://test-server/test-resource",
    serverHash: overrides.serverHash ?? "abc123hash",
    toolInput: {},
    result: {
      content: [{ type: "text", text: "Tool output" }],
      isError: false,
    },
  };
}

/**
 * Render CopilotKit, send a user message, emit an MCP activity snapshot,
 * wait for the iframe to appear, then simulate sandbox-proxy-ready so
 * the component's message handler is installed and ready to receive
 * JSON-RPC requests from the iframe.
 */
async function setupMCPActivity(
  agent: MockMCPProxyAgent,
  agentId: string,
  userMessage: string,
): Promise<HTMLIFrameElement> {
  agent.setRunAgentResponse("resources/read", {
    contents: [
      {
        uri: "ui://test/app",
        mimeType: "text/html",
        text: "<html><body>App</body></html>",
      },
    ],
  });

  const threadId = testId("thread");

  renderWithCopilotKit({
    agents: { [agentId]: agent },
    agentId,
    threadId,
  });

  const input = await screen.findByRole("textbox");
  fireEvent.change(input, { target: { value: userMessage } });
  fireEvent.keyDown(input, { key: "Enter", code: "Enter" });

  await waitFor(() => {
    expect(screen.getByText(userMessage)).toBeDefined();
  });

  agent.emit(runStartedEvent());
  agent.emit(
    activitySnapshotEvent({
      messageId: testId("mcp-activity"),
      activityType: MCPAppsActivityType,
      content: mcpAppsActivityContent({
        resourceUri: "ui://test/app",
        serverHash: "test-hash",
      }),
    }),
  );
  agent.emit(runFinishedEvent());

  // Wait for iframe to be created
  let iframe: HTMLIFrameElement | null = null;
  await waitFor(
    () => {
      iframe = document.querySelector("iframe[srcdoc]");
      expect(iframe).not.toBeNull();
    },
    { timeout: 3000 },
  );

  // Simulate sandbox-proxy-ready notification from the iframe
  const readyEvent = new MessageEvent("message", {
    data: {
      jsonrpc: "2.0",
      method: "ui/notifications/sandbox-proxy-ready",
    },
    source: iframe!.contentWindow,
    origin: "",
  });

  await act(async () => {
    window.dispatchEvent(readyEvent);
    await new Promise((resolve) => setTimeout(resolve, 100));
  });

  return iframe!;
}

/**
 * Send a JSON-RPC request to the component as if it came from the iframe.
 */
function sendJsonRpc(
  iframe: HTMLIFrameElement,
  id: string | number,
  method: string,
  params?: Record<string, unknown>,
) {
  const msg = new MessageEvent("message", {
    data: {
      jsonrpc: "2.0",
      id,
      method,
      params,
    },
    source: iframe.contentWindow,
    origin: "",
  });
  return act(async () => {
    window.dispatchEvent(msg);
    await new Promise((resolve) => setTimeout(resolve, 200));
  });
}

// ---------------------------------------------------------------------------
// Capture outgoing postMessage calls on the iframe's contentWindow so we can
// inspect JSON-RPC responses sent back to the iframe.
// ---------------------------------------------------------------------------
function captureIframeMessages(iframe: HTMLIFrameElement) {
  const captured: unknown[] = [];
  const cw = iframe.contentWindow;
  if (cw) {
    const origPostMessage = cw.postMessage.bind(cw);
    cw.postMessage = function (message: unknown, ...args: unknown[]) {
      captured.push(message);
      return (origPostMessage as Function)(message, ...args);
    };
  }
  return captured;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("MCP Apps Proxy E2E", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("tools/call proxy round-trip", () => {
    it("proxies a tools/call request through the agent and returns the result to the iframe", async () => {
      const agent = new MockMCPProxyAgent();
      agent.agentId = "proxy-tools-call";

      // Set a specific response for tools/call
      agent.setRunAgentResponse("tools/call", {
        content: [{ type: "text", text: "calculator result: 42" }],
        isError: false,
      });

      const iframe = await setupMCPActivity(
        agent,
        "proxy-tools-call",
        "Tools call test",
      );
      const captured = captureIframeMessages(iframe);

      // Send a tools/call JSON-RPC request from the "iframe"
      const reqId = testId("req");
      await sendJsonRpc(iframe, reqId, "tools/call", {
        name: "calculator",
        arguments: { expression: "6 * 7" },
      });

      // Verify the agent received a proxied MCP request with method tools/call
      const toolsCallEntry = agent.runAgentCalls.find(
        (call) =>
          call.input.forwardedProps?.__proxiedMCPRequest?.method ===
          "tools/call",
      );
      expect(toolsCallEntry).toBeDefined();
      expect(
        toolsCallEntry?.input.forwardedProps?.__proxiedMCPRequest?.params,
      ).toMatchObject({
        name: "calculator",
        arguments: { expression: "6 * 7" },
      });

      // Verify a success response was posted back to the iframe
      const response = captured.find(
        (m: any) => m && m.jsonrpc === "2.0" && m.id === reqId && m.result,
      ) as any;
      expect(response).toBeDefined();
      expect(response.result).toMatchObject({
        content: [{ type: "text", text: "calculator result: 42" }],
        isError: false,
      });
    });
  });

  describe("tools/call error handling", () => {
    it("returns a JSON-RPC error when the agent throws during tools/call", async () => {
      const agent = new MockMCPProxyAgent();
      agent.agentId = "proxy-tools-error";

      const iframe = await setupMCPActivity(
        agent,
        "proxy-tools-error",
        "Tools error test",
      );
      const captured = captureIframeMessages(iframe);

      // Override runAgent to throw for tools/call
      const originalRunAgent = agent.runAgent.bind(agent);
      agent.runAgent = async (
        input?: Partial<RunAgentInput>,
      ): Promise<RunAgentResult> => {
        const proxiedRequest = input?.forwardedProps?.__proxiedMCPRequest as
          | { method: string }
          | undefined;
        if (proxiedRequest?.method === "tools/call") {
          throw new Error("Server unreachable: connection refused");
        }
        return originalRunAgent(input);
      };

      const reqId = testId("req");
      await sendJsonRpc(iframe, reqId, "tools/call", {
        name: "broken-tool",
        arguments: {},
      });

      // Verify an error response was posted back to the iframe
      const errorResponse = captured.find(
        (m: any) => m && m.jsonrpc === "2.0" && m.id === reqId && m.error,
      ) as any;
      expect(errorResponse).toBeDefined();
      expect(errorResponse.error.code).toBe(-32603);
      expect(errorResponse.error.message).toContain(
        "Server unreachable: connection refused",
      );
    });
  });

  describe("ui/open-link handler", () => {
    it("calls window.open with the correct URL when the iframe sends ui/open-link", async () => {
      const agent = new MockMCPProxyAgent();
      agent.agentId = "proxy-open-link";

      const iframe = await setupMCPActivity(
        agent,
        "proxy-open-link",
        "Open link test",
      );
      const captured = captureIframeMessages(iframe);

      // Spy on window.open
      const openSpy = vi.spyOn(window, "open").mockImplementation(() => null);

      const reqId = testId("req");
      await sendJsonRpc(iframe, reqId, "ui/open-link", {
        url: "https://example.com/docs",
      });

      // Verify window.open was called with the correct args
      expect(openSpy).toHaveBeenCalledWith(
        "https://example.com/docs",
        "_blank",
        "noopener,noreferrer",
      );

      // Verify a success response was sent back
      const response = captured.find(
        (m: any) => m && m.jsonrpc === "2.0" && m.id === reqId && m.result,
      ) as any;
      expect(response).toBeDefined();
      expect(response.result).toMatchObject({ isError: false });

      openSpy.mockRestore();
    });

    it("returns an error when url parameter is missing", async () => {
      const agent = new MockMCPProxyAgent();
      agent.agentId = "proxy-open-link-no-url";

      const iframe = await setupMCPActivity(
        agent,
        "proxy-open-link-no-url",
        "No URL test",
      );
      const captured = captureIframeMessages(iframe);

      const reqId = testId("req");
      await sendJsonRpc(iframe, reqId, "ui/open-link", {});

      // A ui/open-link without `url` is an invalid request. Since the migration
      // to the ext-apps AppBridge, the bridge validates the request against its
      // schema and rejects the missing required `url` with a JSON-RPC error
      // (InternalError -32603) before any host handler runs.
      const errorResponse = captured.find(
        (m: any) => m && m.jsonrpc === "2.0" && m.id === reqId && m.error,
      ) as any;
      expect(errorResponse).toBeDefined();
      expect(errorResponse.error.code).toBe(-32603);
      expect(typeof errorResponse.error.message).toBe("string");
      expect(errorResponse.error.message.length).toBeGreaterThan(0);
    });

    it("rejects a disallowed url scheme without calling window.open", async () => {
      const agent = new MockMCPProxyAgent();
      agent.agentId = "proxy-open-link-scheme";

      const iframe = await setupMCPActivity(
        agent,
        "proxy-open-link-scheme",
        "Bad scheme test",
      );
      const captured = captureIframeMessages(iframe);

      const openSpy = vi.spyOn(window, "open").mockImplementation(() => null);

      const reqId = testId("req");
      await sendJsonRpc(iframe, reqId, "ui/open-link", {
        // eslint-disable-next-line no-script-url
        url: "javascript:alert(document.domain)",
      });

      // The host refuses the denylisted script/HTML schemes
      // (javascript:/data:/vbscript:/blob:/file:) so a widget cannot use
      // ui/open-link as an XSS vector.
      expect(openSpy).not.toHaveBeenCalled();

      const response = captured.find(
        (m: any) => m && m.jsonrpc === "2.0" && m.id === reqId && m.result,
      ) as any;
      expect(response).toBeDefined();
      expect(response.result).toMatchObject({ isError: true });

      openSpy.mockRestore();
    });

    it("allows a custom-scheme deep link (only script/HTML schemes are blocked)", async () => {
      const agent = new MockMCPProxyAgent();
      agent.agentId = "proxy-open-link-deeplink";

      const iframe = await setupMCPActivity(
        agent,
        "proxy-open-link-deeplink",
        "Deep link test",
      );
      const captured = captureIframeMessages(iframe);

      const openSpy = vi.spyOn(window, "open").mockImplementation(() => null);

      const reqId = testId("req");
      // Deep links use arbitrary app-defined schemes; they hand off to an OS
      // handler rather than executing in the page, so they are allowed (a
      // denylist blocks only javascript:/data:/vbscript:/blob:/file:).
      await sendJsonRpc(iframe, reqId, "ui/open-link", {
        url: "myapp://widgets/open?id=42",
      });

      expect(openSpy).toHaveBeenCalledWith(
        "myapp://widgets/open?id=42",
        "_blank",
        "noopener,noreferrer",
      );

      const response = captured.find(
        (m: any) => m && m.jsonrpc === "2.0" && m.id === reqId && m.result,
      ) as any;
      expect(response).toBeDefined();
      expect(response.result).toMatchObject({ isError: false });

      openSpy.mockRestore();
    });
  });

  describe("Multiple independent MCP activities", () => {
    it("renders two activities with different resourceUris independently", async () => {
      const agent = new MockMCPProxyAgent();
      agent.agentId = "proxy-multi";

      // Respond with different HTML for each URI.
      // Override runAgent while still tracking calls in runAgentCalls.
      const originalRunAgent = agent.runAgent.bind(agent);
      agent.runAgent = async (
        input?: Partial<RunAgentInput>,
      ): Promise<RunAgentResult> => {
        const proxiedRequest = input?.forwardedProps?.__proxiedMCPRequest as
          | {
              method: string;
              params?: { uri?: string };
            }
          | undefined;
        if (proxiedRequest?.method === "resources/read") {
          if (input) {
            agent.runAgentCalls.push({ input });
          }
          const uri = proxiedRequest.params?.uri;
          if (uri === "ui://first/widget") {
            return {
              result: {
                contents: [
                  {
                    uri,
                    mimeType: "text/html",
                    text: "<div>First Widget</div>",
                  },
                ],
              },
              newMessages: [],
            };
          }
          if (uri === "ui://second/widget") {
            return {
              result: {
                contents: [
                  {
                    uri,
                    mimeType: "text/html",
                    text: "<div>Second Widget</div>",
                  },
                ],
              },
              newMessages: [],
            };
          }
        }
        return originalRunAgent(input);
      };

      const threadId = testId("thread");

      renderWithCopilotKit({
        agents: { "proxy-multi": agent },
        agentId: "proxy-multi",
        threadId,
      });

      const input = await screen.findByRole("textbox");
      fireEvent.change(input, { target: { value: "Two widgets" } });
      fireEvent.keyDown(input, { key: "Enter", code: "Enter" });

      await waitFor(() => {
        expect(screen.getByText("Two widgets")).toBeDefined();
      });

      agent.emit(runStartedEvent());

      // Emit two distinct activity snapshots
      agent.emit(
        activitySnapshotEvent({
          messageId: testId("mcp-first"),
          activityType: MCPAppsActivityType,
          content: mcpAppsActivityContent({
            resourceUri: "ui://first/widget",
            serverHash: "first-hash",
          }),
        }),
      );

      agent.emit(
        activitySnapshotEvent({
          messageId: testId("mcp-second"),
          activityType: MCPAppsActivityType,
          content: mcpAppsActivityContent({
            resourceUri: "ui://second/widget",
            serverHash: "second-hash",
          }),
        }),
      );

      agent.emit(runFinishedEvent());

      // Both activities should produce their own iframes
      await waitFor(
        () => {
          const iframes = document.querySelectorAll("iframe[srcdoc]");
          expect(iframes.length).toBe(2);
        },
        { timeout: 3000 },
      );

      // Verify that two separate resource fetches were made
      const resourceCalls = agent.runAgentCalls.filter(
        (call) =>
          call.input.forwardedProps?.__proxiedMCPRequest?.method ===
          "resources/read",
      );
      expect(resourceCalls.length).toBe(2);

      const uris = resourceCalls.map(
        (c) => c.input.forwardedProps?.__proxiedMCPRequest?.params?.uri,
      );
      expect(uris).toContain("ui://first/widget");
      expect(uris).toContain("ui://second/widget");
    });
  });

  // ui/initialize is handled entirely by the ext-apps AppBridge. These tests pin
  // the negotiation contract (the compile-time tie to the spec this migration
  // argues for), because the strictness changed vs the hand-rolled host:
  // - the bridge validates params against the spec schema, so a widget that omits
  //   the required fields (e.g. appCapabilities) now fails initialize with a
  //   JSON-RPC error instead of getting a lenient response;
  // - the host advertises only the latest MCP Apps protocol version, so a widget
  //   declaring a different version string gets the host version back, not its
  //   own echoed.
  describe("ui/initialize negotiation", () => {
    const LATEST_PROTOCOL_VERSION = "2026-01-26";

    it("negotiates and returns the host context for a well-formed initialize", async () => {
      const agent = new MockMCPProxyAgent();
      agent.agentId = "proxy-init-ok";

      const iframe = await setupMCPActivity(
        agent,
        "proxy-init-ok",
        "Initialize test",
      );
      const captured = captureIframeMessages(iframe);

      const reqId = testId("req");
      await sendJsonRpc(iframe, reqId, "ui/initialize", {
        appInfo: { name: "test-widget", version: "1.0.0" },
        appCapabilities: {},
        protocolVersion: LATEST_PROTOCOL_VERSION,
      });

      const response = captured.find(
        (m: any) => m && m.jsonrpc === "2.0" && m.id === reqId && m.result,
      ) as any;
      expect(response).toBeDefined();
      expect(response).not.toHaveProperty("error");
      // Protocol version is negotiated to the host's latest.
      expect(response.result.protocolVersion).toBe(LATEST_PROTOCOL_VERSION);
      // Host context seeded at construction is advertised at initialize.
      expect(response.result.hostContext).toMatchObject({
        theme: "light",
        platform: "web",
      });
    });

    it("rejects an initialize that omits required fields with -32603", async () => {
      const agent = new MockMCPProxyAgent();
      agent.agentId = "proxy-init-bad";

      const iframe = await setupMCPActivity(
        agent,
        "proxy-init-bad",
        "Initialize invalid test",
      );
      const captured = captureIframeMessages(iframe);

      // Empty params: no appInfo / appCapabilities / protocolVersion. The bridge
      // validates against the spec schema and rejects before any host handler.
      const reqId = testId("req");
      await sendJsonRpc(iframe, reqId, "ui/initialize", {});

      const errorResponse = captured.find(
        (m: any) => m && m.jsonrpc === "2.0" && m.id === reqId && m.error,
      ) as any;
      expect(errorResponse).toBeDefined();
      expect(errorResponse.error.code).toBe(-32603);
      expect(typeof errorResponse.error.message).toBe("string");
      expect(errorResponse.error.message.length).toBeGreaterThan(0);
    });

    it("returns the host protocol version, not the widget's, when they differ", async () => {
      const agent = new MockMCPProxyAgent();
      agent.agentId = "proxy-init-version";

      const iframe = await setupMCPActivity(
        agent,
        "proxy-init-version",
        "Initialize version test",
      );
      const captured = captureIframeMessages(iframe);

      const reqId = testId("req");
      // The widget sends a different protocol-version string ("2025-06-18" is a
      // base-MCP-protocol version, independent from the MCP Apps protocol; it is
      // also what the old hand-rolled host hardcoded). The bridge supports only
      // its own MCP Apps version and returns that, rather than echoing whatever
      // the widget declared.
      await sendJsonRpc(iframe, reqId, "ui/initialize", {
        appInfo: { name: "legacy-widget", version: "1.0.0" },
        appCapabilities: {},
        protocolVersion: "2025-06-18",
      });

      const response = captured.find(
        (m: any) => m && m.jsonrpc === "2.0" && m.id === reqId && m.result,
      ) as any;
      expect(response).toBeDefined();
      expect(response.result.protocolVersion).toBe(LATEST_PROTOCOL_VERSION);
    });
  });
});
