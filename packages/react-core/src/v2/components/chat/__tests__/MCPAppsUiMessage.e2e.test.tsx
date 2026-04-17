/**
 * Tests for MCP Apps ui/message handler behavior.
 *
 * Verifies the followUp logic that controls whether the agent is invoked
 * after an MCP app sends a ui/message request via JSON-RPC:
 *
 *   shouldFollowUp = params.followUp ?? role === "user"
 *
 * - User-role messages invoke runAgent (default followUp = true)
 * - Assistant-role messages do NOT invoke runAgent (default followUp = false)
 * - followUp: false skips runAgent regardless of role
 * - followUp: true forces runAgent regardless of role
 * - addMessage is always called when textContent is present
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

/**
 * MockMCPProxyAgent with spying support for ui/message tests.
 */
class MockMCPProxyAgent extends AbstractAgent {
  private subject = new Subject<BaseEvent>();
  public runAgentCalls: Array<{ input: Partial<RunAgentInput> }> = [];
  public addMessageCalls: Array<{
    id: string;
    role: string;
    content: string;
  }> = [];

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
      addMessageCalls: Array<{ id: string; role: string; content: string }>;
      runAgentResponses: Map<string, unknown>;
    };
    (cloned as unknown as Internal).subject = (
      this as unknown as Internal
    ).subject;
    (cloned as unknown as Internal).runAgentCalls = (
      this as unknown as Internal
    ).runAgentCalls;
    (cloned as unknown as Internal).addMessageCalls = (
      this as unknown as Internal
    ).addMessageCalls;
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

    // Track addMessage calls on the clone (the component uses the clone)
    const origAddMessage = cloned.addMessage.bind(cloned);
    cloned.addMessage = function (msg: Parameters<typeof origAddMessage>[0]) {
      registry.addMessageCalls.push(msg as any);
      return origAddMessage(msg);
    };

    // Proxy run() calls so spies on the registry's run() see clone invocations
    cloned.run = function (input: RunAgentInput): Observable<BaseEvent> {
      return registry.run(input);
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
      return { result: {}, newMessages: [] };
    }

    return super.runAgent(input);
  }
}

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
 * Set up the agent, render, emit MCP activity, wait for iframe creation,
 * then simulate sandbox-proxy-ready so the message handler gets installed.
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

  // Use a unique threadId per test to avoid module-level mcpAppsRequestQueue
  // state leaking between tests (the queue keys by threadId).
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

  // Simulate sandbox-proxy-ready notification from the iframe.
  // The message handler checks event.source === iframe.contentWindow.
  // In jsdom, iframe.contentWindow exists for srcdoc iframes.
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
    // Give async setup() time to install the messageHandler
    await new Promise((resolve) => setTimeout(resolve, 100));
  });

  return iframe!;
}

/**
 * Send a ui/message JSON-RPC request as if coming from the iframe.
 */
async function sendUiMessage(
  iframe: HTMLIFrameElement,
  params: {
    role?: string;
    content?: Array<{ type: string; text?: string }>;
    followUp?: boolean;
  },
) {
  const msg = new MessageEvent("message", {
    data: {
      jsonrpc: "2.0",
      id: testId("req"),
      method: "ui/message",
      params,
    },
    source: iframe.contentWindow,
    origin: "",
  });

  await act(async () => {
    window.dispatchEvent(msg);
    await new Promise((resolve) => setTimeout(resolve, 200));
  });
}

describe("MCP Apps ui/message followUp behavior", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("user-role message: addMessage IS called and runAgent IS invoked", async () => {
    const agent = new MockMCPProxyAgent();
    agent.agentId = "ui-msg-agent-user";

    const iframe = await setupMCPActivity(
      agent,
      "ui-msg-agent-user",
      "User role test",
    );

    const runSpy = vi.spyOn(agent, "run");

    await sendUiMessage(iframe, {
      role: "user",
      content: [{ type: "text", text: "Hello from MCP app" }],
    });

    // addMessage should have been called
    const userMsgCalls = agent.addMessageCalls.filter(
      (c) => c.content === "Hello from MCP app" && c.role === "user",
    );
    expect(userMsgCalls.length).toBeGreaterThanOrEqual(1);

    // runAgent should have been invoked (user role defaults to followUp: true)
    expect(runSpy.mock.calls.length).toBeGreaterThan(0);
  });

  it("assistant-role message: addMessage IS called but runAgent is NOT invoked", async () => {
    const agent = new MockMCPProxyAgent();
    agent.agentId = "ui-msg-agent-assist";

    const iframe = await setupMCPActivity(
      agent,
      "ui-msg-agent-assist",
      "Assist role test",
    );

    const runSpy = vi.spyOn(agent, "run");

    await sendUiMessage(iframe, {
      role: "assistant",
      content: [{ type: "text", text: "Response from MCP" }],
    });

    // addMessage should have been called
    const assistCalls = agent.addMessageCalls.filter(
      (c) => c.content === "Response from MCP" && c.role === "assistant",
    );
    expect(assistCalls.length).toBeGreaterThanOrEqual(1);

    // run() should NOT have been called
    expect(runSpy.mock.calls.length).toBe(0);
  });

  it("followUp: false on user-role message: addMessage IS called but runAgent is NOT invoked", async () => {
    const agent = new MockMCPProxyAgent();
    agent.agentId = "ui-msg-agent-nofollowup";

    const iframe = await setupMCPActivity(
      agent,
      "ui-msg-agent-nofollowup",
      "No followUp test",
    );

    const runSpy = vi.spyOn(agent, "run");

    await sendUiMessage(iframe, {
      role: "user",
      content: [{ type: "text", text: "Display only message" }],
      followUp: false,
    });

    // addMessage should have been called
    const calls = agent.addMessageCalls.filter(
      (c) => c.content === "Display only message",
    );
    expect(calls.length).toBeGreaterThanOrEqual(1);

    // run() should NOT have been called
    expect(runSpy.mock.calls.length).toBe(0);
  });

  it("followUp: true on assistant-role message: addMessage IS called AND runAgent IS invoked", async () => {
    const agent = new MockMCPProxyAgent();
    agent.agentId = "ui-msg-agent-force";

    const iframe = await setupMCPActivity(
      agent,
      "ui-msg-agent-force",
      "Force followUp test",
    );

    const runSpy = vi.spyOn(agent, "run");

    await sendUiMessage(iframe, {
      role: "assistant",
      content: [{ type: "text", text: "Assistant with followUp" }],
      followUp: true,
    });

    // addMessage should have been called
    const calls = agent.addMessageCalls.filter(
      (c) => c.content === "Assistant with followUp",
    );
    expect(calls.length).toBeGreaterThanOrEqual(1);

    // run() should have been called
    expect(runSpy.mock.calls.length).toBeGreaterThan(0);
  });

  it("message with text content always adds to agent messages regardless of followUp", async () => {
    const agent = new MockMCPProxyAgent();
    agent.agentId = "ui-msg-agent-all";

    const iframe = await setupMCPActivity(
      agent,
      "ui-msg-agent-all",
      "All messages test",
    );

    await sendUiMessage(iframe, {
      role: "user",
      content: [{ type: "text", text: "User msg" }],
    });

    await sendUiMessage(iframe, {
      role: "assistant",
      content: [{ type: "text", text: "Assistant msg" }],
    });

    await sendUiMessage(iframe, {
      role: "user",
      content: [{ type: "text", text: "No followUp msg" }],
      followUp: false,
    });

    const userCalls = agent.addMessageCalls.filter(
      (c) => c.content === "User msg",
    );
    const assistCalls = agent.addMessageCalls.filter(
      (c) => c.content === "Assistant msg",
    );
    const noFollowCalls = agent.addMessageCalls.filter(
      (c) => c.content === "No followUp msg",
    );

    expect(userCalls.length).toBeGreaterThanOrEqual(1);
    expect(assistCalls.length).toBeGreaterThanOrEqual(1);
    expect(noFollowCalls.length).toBeGreaterThanOrEqual(1);
  });
});
