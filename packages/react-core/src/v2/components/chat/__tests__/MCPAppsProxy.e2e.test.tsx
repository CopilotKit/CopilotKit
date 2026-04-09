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
import {
  AbstractAgent,
  RunAgentInput,
  RunAgentResult,
  BaseEvent,
  EventType,
} from "@ag-ui/client";
import { Observable, Subject } from "rxjs";

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

      // Verify an error response for missing url
      const errorResponse = captured.find(
        (m: any) => m && m.jsonrpc === "2.0" && m.id === reqId && m.error,
      ) as any;
      expect(errorResponse).toBeDefined();
      expect(errorResponse.error.code).toBe(-32602);
      expect(errorResponse.error.message).toContain("Missing url");
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
});
