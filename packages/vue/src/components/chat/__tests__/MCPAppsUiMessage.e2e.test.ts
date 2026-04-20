import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/vue";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { defineComponent, nextTick } from "vue";
import {
  activitySnapshotEvent,
  runFinishedEvent,
  runStartedEvent,
  testId,
} from "../../../__tests__/utils/test-helpers";
import { AbstractAgent, EventType } from "@ag-ui/client";
import type { BaseEvent, RunAgentInput, RunAgentResult } from "@ag-ui/client";
import { Observable, Subject } from "rxjs";
import { MCPAppsActivityType } from "../../MCPAppsActivityRenderer";
import CopilotChat from "../CopilotChat.vue";
import CopilotKitProvider from "../../../providers/CopilotKitProvider.vue";
import CopilotChatConfigurationProvider from "../../../providers/CopilotChatConfigurationProvider.vue";

class MockMCPProxyAgent extends AbstractAgent {
  private readonly subject = new Subject<BaseEvent>();
  private bufferedEvents: BaseEvent[] = [];
  public runAgentCalls: Array<{ input: Partial<RunAgentInput> }> = [];
  public addMessageCalls: Array<{
    id: string;
    role: string;
    content: unknown;
  }> = [];
  private readonly runAgentResponses = new Map<string, unknown>();

  setRunAgentResponse(method: string, response: unknown): void {
    this.runAgentResponses.set(method, response);
  }

  async emit(event: BaseEvent): Promise<void> {
    if (event.type === EventType.RUN_STARTED) {
      this.isRunning = true;
    } else if (
      event.type === EventType.RUN_FINISHED ||
      event.type === EventType.RUN_ERROR
    ) {
      this.isRunning = false;
    }
    if (this.subject.observers.length === 0) {
      this.bufferedEvents.push(event);
    } else {
      this.subject.next(event);
    }
    await flushVueUpdates();
  }

  clone(): MockMCPProxyAgent {
    const cloned = new MockMCPProxyAgent();
    cloned.agentId = this.agentId;
    type Internal = {
      subject: Subject<BaseEvent>;
      bufferedEvents: BaseEvent[];
      runAgentCalls: Array<{ input: Partial<RunAgentInput> }>;
      addMessageCalls: Array<{ id: string; role: string; content: unknown }>;
      runAgentResponses: Map<string, unknown>;
    };
    (cloned as unknown as Internal).subject = (
      this as unknown as Internal
    ).subject;
    (cloned as unknown as Internal).bufferedEvents = (
      this as unknown as Internal
    ).bufferedEvents;
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

    cloned.run = function (input: RunAgentInput): Observable<BaseEvent> {
      return registry.run(input);
    };

    const originalAddMessage = cloned.addMessage.bind(cloned);
    cloned.addMessage = function (
      message: Parameters<AbstractAgent["addMessage"]>[0],
    ) {
      registry.addMessageCalls.push({
        id: message.id,
        role: message.role,
        content: message.content,
      });
      return originalAddMessage(message);
    };

    return cloned;
  }

  run(_input: RunAgentInput): Observable<BaseEvent> {
    return new Observable<BaseEvent>((observer) => {
      if (this.bufferedEvents.length > 0) {
        for (const event of this.bufferedEvents) {
          observer.next(event);
        }
        this.bufferedEvents = [];
      }

      const subscription = this.subject.subscribe(observer);
      return () => subscription.unsubscribe();
    });
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

async function flushVueUpdates(): Promise<void> {
  await nextTick();
  await new Promise((resolve) => setTimeout(resolve, 0));
}

async function setupMCPActivity(
  agent: MockMCPProxyAgent,
  userMessage: string,
): Promise<HTMLIFrameElement> {
  const threadId = testId("mcp-ui-message-thread");
  const agentId = agent.agentId ?? "mcp-ui-message-agent";
  agent.agentId = agentId;
  agent.setRunAgentResponse("resources/read", {
    contents: [
      {
        uri: "ui://test/app",
        mimeType: "text/html",
        text: "<html><body>App</body></html>",
      },
    ],
  });

  const Host = defineComponent({
    components: {
      CopilotKitProvider,
      CopilotChatConfigurationProvider,
      CopilotChat,
    },
    setup() {
      return {
        agentId,
        threadId,
        agents: { [agentId]: agent },
      };
    },
    template: `
      <CopilotKitProvider runtimeUrl="/api/copilotkit" :agents__unsafe_dev_only="agents">
        <CopilotChatConfigurationProvider :thread-id="threadId" :agent-id="agentId">
          <div style="height: 400px;">
            <CopilotChat :welcome-screen="false" />
          </div>
        </CopilotChatConfigurationProvider>
      </CopilotKitProvider>
    `,
  });

  render(Host);

  const input = await screen.findByRole("textbox");
  await fireEvent.update(input, userMessage);
  await fireEvent.keyDown(input, { key: "Enter", code: "Enter" });

  await waitFor(() => {
    expect(screen.getByText(userMessage)).toBeDefined();
  });

  await agent.emit(runStartedEvent());
  await agent.emit(
    activitySnapshotEvent({
      messageId: testId("mcp-activity"),
      activityType: MCPAppsActivityType,
      content: {
        resourceUri: "ui://test/app",
        serverHash: "test-hash",
        toolInput: {},
        result: {
          content: [{ type: "text", text: "Tool output" }],
          isError: false,
        },
      },
    }),
  );
  await agent.emit(runFinishedEvent());

  let iframe: HTMLIFrameElement | null = null;
  await waitFor(
    () => {
      iframe = document.querySelector("iframe[srcdoc]");
      expect(iframe).not.toBeNull();
    },
    { timeout: 3000 },
  );

  const readyEvent = new MessageEvent("message", {
    data: {
      jsonrpc: "2.0",
      method: "ui/notifications/sandbox-proxy-ready",
    },
    source: iframe!.contentWindow,
    origin: "",
  });
  window.dispatchEvent(readyEvent);
  await flushVueUpdates();
  await new Promise((resolve) => setTimeout(resolve, 100));

  return iframe!;
}

async function sendUiMessage(
  iframe: HTMLIFrameElement,
  agent: MockMCPProxyAgent,
  params: {
    role?: string;
    content?: Array<{ type: string; text?: string }>;
    followUp?: boolean;
  },
) {
  const messageEvent = new MessageEvent("message", {
    data: {
      jsonrpc: "2.0",
      id: testId("ui-message-request"),
      method: "ui/message",
      params,
    },
    source: iframe.contentWindow,
    origin: "",
  });

  window.dispatchEvent(messageEvent);
  await flushVueUpdates();
  await new Promise((resolve) => setTimeout(resolve, 200));

  // Settle possible follow-up run to avoid leaking queue/running state.
  await agent.emit(runStartedEvent());
  await agent.emit(runFinishedEvent());
}

describe("MCP Apps ui/message followUp behavior", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    cleanup();
    document.body.innerHTML = "";
  });

  it("user-role message: addMessage IS called and runAgent IS invoked", async () => {
    const agent = new MockMCPProxyAgent();
    agent.agentId = "ui-msg-agent-user";
    const iframe = await setupMCPActivity(agent, "User role test");

    const runSpy = vi.spyOn(agent, "run");
    const before = runSpy.mock.calls.length;

    await sendUiMessage(iframe, agent, {
      role: "user",
      content: [{ type: "text", text: "Hello from MCP app" }],
    });

    const added = agent.addMessageCalls.some(
      (message) =>
        message.role === "user" && message.content === "Hello from MCP app",
    );
    expect(added).toBe(true);
    expect(runSpy.mock.calls.length).toBeGreaterThan(before);
  });

  it("assistant-role message: addMessage IS called but runAgent is NOT invoked", async () => {
    const agent = new MockMCPProxyAgent();
    agent.agentId = "ui-msg-agent-assistant";
    const iframe = await setupMCPActivity(agent, "Assistant role test");

    const runSpy = vi.spyOn(agent, "run");
    const before = runSpy.mock.calls.length;

    await sendUiMessage(iframe, agent, {
      role: "assistant",
      content: [{ type: "text", text: "Assistant message from MCP app" }],
    });

    const added = agent.addMessageCalls.some(
      (message) =>
        message.role === "assistant" &&
        message.content === "Assistant message from MCP app",
    );
    expect(added).toBe(true);
    expect(runSpy.mock.calls.length).toBe(before);
  });

  it("followUp: false on user-role message: addMessage IS called but runAgent is NOT invoked", async () => {
    const agent = new MockMCPProxyAgent();
    agent.agentId = "ui-msg-agent-user-no-follow-up";
    const iframe = await setupMCPActivity(agent, "No follow-up user role test");

    const runSpy = vi.spyOn(agent, "run");
    const before = runSpy.mock.calls.length;

    await sendUiMessage(iframe, agent, {
      role: "user",
      followUp: false,
      content: [{ type: "text", text: "Display-only message" }],
    });

    expect(runSpy.mock.calls.length).toBe(before);
  });

  it("followUp: true on assistant-role message: addMessage IS called AND runAgent IS invoked", async () => {
    const agent = new MockMCPProxyAgent();
    agent.agentId = "ui-msg-agent-assistant-follow-up";
    const iframe = await setupMCPActivity(
      agent,
      "Forced follow-up assistant role test",
    );

    const runSpy = vi.spyOn(agent, "run");
    const before = runSpy.mock.calls.length;

    await sendUiMessage(iframe, agent, {
      role: "assistant",
      followUp: true,
      content: [{ type: "text", text: "Assistant with follow-up" }],
    });

    expect(runSpy.mock.calls.length).toBeGreaterThan(before);
  });
});
