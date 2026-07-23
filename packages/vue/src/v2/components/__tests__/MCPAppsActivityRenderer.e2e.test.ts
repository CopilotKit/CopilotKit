import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/vue";
import { defineComponent, nextTick } from "vue";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AbstractAgent, EventType } from "@ag-ui/client";
import type { BaseEvent, RunAgentInput, RunAgentResult } from "@ag-ui/client";
import { Observable, Subject } from "rxjs";
import CopilotChat from "../chat/CopilotChat.vue";
import CopilotKitProvider from "../../providers/CopilotKitProvider.vue";
import CopilotChatConfigurationProvider from "../../providers/CopilotChatConfigurationProvider.vue";
import {
  MCPAppsActivityContentSchema,
  MCPAppsActivityType,
} from "../MCPAppsActivityRenderer";
import {
  activitySnapshotEvent,
  runFinishedEvent,
  runStartedEvent,
} from "../../__tests__/utils/test-helpers";

class MockMCPProxyAgent extends AbstractAgent {
  private readonly subject = new Subject<BaseEvent>();
  private bufferedEvents: BaseEvent[] = [];
  public runAgentCalls: Array<{ input: Partial<RunAgentInput> }> = [];
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

async function flushVueUpdates(): Promise<void> {
  await nextTick();
  await new Promise((resolve) => setTimeout(resolve, 0));
}

function mcpAppsActivityContent(overrides: {
  resourceUri?: string;
  serverHash?: string;
  serverId?: string;
  toolInput?: Record<string, unknown>;
  result?: {
    content?: unknown[];
    structuredContent?: unknown;
    isError?: boolean;
  };
}) {
  return {
    resourceUri: overrides.resourceUri ?? "ui://test-server/test-resource",
    serverHash: overrides.serverHash ?? "abc123hash",
    serverId: overrides.serverId,
    toolInput: overrides.toolInput ?? {},
    result: overrides.result ?? {
      content: [{ type: "text", text: "Tool output" }],
      isError: false,
    },
  };
}

function renderChatWithAgent(
  agent: MockMCPProxyAgent,
  { withCustomRenderer = false }: { withCustomRenderer?: boolean } = {},
) {
  const agentId = "mcp-test-agent";
  const threadId = `test-thread-${Math.random().toString(36).slice(2)}`;
  agent.agentId = agentId;

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
        withCustomRenderer,
      };
    },
    template: `
      <CopilotKitProvider runtimeUrl="/api/copilotkit" :agents__unsafe_dev_only="agents">
        <CopilotChatConfigurationProvider :thread-id="threadId" :agent-id="agentId">
          <div style="height: 400px;">
            <CopilotChat :welcome-screen="false">
              <template v-if="withCustomRenderer" #activity-mcp-apps="{ content }">
                <div data-testid="custom-mcp-renderer">
                  Custom MCP Renderer: {{ String(content?.resourceUri ?? "") }}
                </div>
              </template>
            </CopilotChat>
          </div>
        </CopilotChatConfigurationProvider>
      </CopilotKitProvider>
    `,
  });

  return render(Host);
}

async function submitMessage(value: string) {
  const input = await screen.findByRole("textbox");
  await fireEvent.update(input, value);
  await fireEvent.keyDown(input, { key: "Enter", code: "Enter" });
}

async function submitMessageAndWaitForRun(value: string) {
  await submitMessage(value);
}

describe("MCP Apps Activity Renderer E2E", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    cleanup();
    document.body.innerHTML = "";
  });

  describe("Resource Fetching", () => {
    it("fetches resource content via proxied MCP request on mount", async () => {
      const agent = new MockMCPProxyAgent();
      agent.setRunAgentResponse("resources/read", {
        contents: [
          {
            uri: "ui://test-server/dashboard",
            mimeType: "text/html",
            text: "<html><body>Dashboard content</body></html>",
          },
        ],
      });

      renderChatWithAgent(agent);

      await submitMessageAndWaitForRun("Show dashboard");

      await agent.emit(runStartedEvent());
      await agent.emit(
        activitySnapshotEvent({
          messageId: "mcp-activity",
          activityType: MCPAppsActivityType,
          content: mcpAppsActivityContent({
            resourceUri: "ui://test-server/dashboard",
            serverHash: "dashboard-hash-123",
          }),
        }),
      );
      await agent.emit(runFinishedEvent());

      await waitFor(
        () => {
          expect(document.body.textContent ?? "").toContain("Loading...");
        },
        { timeout: 2000 },
      );

      await waitFor(
        () => {
          expect(agent.runAgentCalls.length).toBeGreaterThan(0);
        },
        { timeout: 2000 },
      );

      const resourceCall = agent.runAgentCalls.find(
        (call) =>
          call.input.forwardedProps?.__proxiedMCPRequest?.method ===
          "resources/read",
      );
      expect(resourceCall).toBeDefined();
      expect(
        resourceCall?.input.forwardedProps?.__proxiedMCPRequest,
      ).toMatchObject({
        serverHash: "dashboard-hash-123",
        method: "resources/read",
        params: { uri: "ui://test-server/dashboard" },
      });
    });

    it("uses serverId when provided (takes precedence over serverHash)", async () => {
      const agent = new MockMCPProxyAgent();
      agent.setRunAgentResponse("resources/read", {
        contents: [
          {
            uri: "ui://my-app/settings",
            mimeType: "text/html",
            text: "<html><body>Settings</body></html>",
          },
        ],
      });

      renderChatWithAgent(agent);

      await submitMessageAndWaitForRun("Show settings");

      await agent.emit(runStartedEvent());
      await agent.emit(
        activitySnapshotEvent({
          messageId: "mcp-activity",
          activityType: MCPAppsActivityType,
          content: mcpAppsActivityContent({
            resourceUri: "ui://my-app/settings",
            serverHash: "fallback-hash",
            serverId: "my-app-stable-id",
          }),
        }),
      );
      await agent.emit(runFinishedEvent());

      await waitFor(() => {
        const resourceCall = agent.runAgentCalls.find(
          (call) =>
            call.input.forwardedProps?.__proxiedMCPRequest?.method ===
            "resources/read",
        );
        expect(resourceCall).toBeDefined();
        expect(
          resourceCall?.input.forwardedProps?.__proxiedMCPRequest?.serverId,
        ).toBe("my-app-stable-id");
        expect(
          resourceCall?.input.forwardedProps?.__proxiedMCPRequest?.serverHash,
        ).toBe("fallback-hash");
      });
    });

    it("shows loading state while fetching resource", async () => {
      const agent = new MockMCPProxyAgent();

      let resolveResource: ((value: unknown) => void) | undefined;
      const resourcePromise = new Promise((resolve) => {
        resolveResource = resolve;
      });

      const originalRunAgent = agent.runAgent.bind(agent);
      agent.runAgent = vi.fn(
        async (input?: Partial<RunAgentInput>): Promise<RunAgentResult> => {
          const proxiedRequest = input?.forwardedProps?.__proxiedMCPRequest as
            | { method: string }
            | undefined;
          if (proxiedRequest?.method === "resources/read") {
            await resourcePromise;
            return originalRunAgent(input);
          }
          return originalRunAgent(input);
        },
      );

      renderChatWithAgent(agent);

      await submitMessageAndWaitForRun("Load app");

      await agent.emit(runStartedEvent());
      await agent.emit(
        activitySnapshotEvent({
          messageId: "mcp-activity",
          activityType: MCPAppsActivityType,
          content: mcpAppsActivityContent({
            resourceUri: "ui://test/app",
            serverHash: "test-hash",
          }),
        }),
      );
      await agent.emit(runFinishedEvent());

      resolveResource?.(true);

      await waitFor(
        () => {
          expect(document.body.textContent ?? "").not.toContain("Loading...");
        },
        { timeout: 3000 },
      );
    });

    it("shows error state when resource fetch fails", async () => {
      const agent = new MockMCPProxyAgent();

      const originalRunAgent = agent.runAgent.bind(agent);
      agent.runAgent = vi.fn(
        async (input?: Partial<RunAgentInput>): Promise<RunAgentResult> => {
          const proxiedRequest = input?.forwardedProps?.__proxiedMCPRequest as
            | { method: string }
            | undefined;
          if (proxiedRequest) {
            throw new Error("Network error: Failed to fetch resource");
          }
          return originalRunAgent(input);
        },
      );

      renderChatWithAgent(agent);

      await submitMessageAndWaitForRun("Fetch broken");

      await agent.emit(runStartedEvent());
      await agent.emit(
        activitySnapshotEvent({
          messageId: "mcp-activity",
          activityType: MCPAppsActivityType,
          content: mcpAppsActivityContent({
            resourceUri: "ui://broken/resource",
            serverHash: "broken-hash",
          }),
        }),
      );
      await agent.emit(runFinishedEvent());

      await waitFor(() => {
        expect(document.body.textContent ?? "").toMatch(
          /Error:.*Failed to fetch resource/i,
        );
      });
    });

    it("handles resource with no content gracefully", async () => {
      const agent = new MockMCPProxyAgent();
      agent.setRunAgentResponse("resources/read", { contents: [] });

      renderChatWithAgent(agent);

      await submitMessageAndWaitForRun("Empty resource");

      await agent.emit(runStartedEvent());
      await agent.emit(
        activitySnapshotEvent({
          messageId: "mcp-activity",
          activityType: MCPAppsActivityType,
          content: mcpAppsActivityContent({
            resourceUri: "ui://empty/resource",
            serverHash: "empty-hash",
          }),
        }),
      );
      await agent.emit(runFinishedEvent());

      await waitFor(() => {
        expect(document.body.textContent ?? "").toMatch(
          /Error:.*No resource content/i,
        );
      });
    });
  });

  describe("Schema Validation", () => {
    it("validates activity content with the correct schema", () => {
      const validContent = {
        resourceUri: "ui://server/resource",
        serverHash: "hash123",
        result: {
          content: [{ type: "text", text: "output" }],
          isError: false,
        },
      };

      const validResult = MCPAppsActivityContentSchema.safeParse(validContent);
      expect(validResult.success).toBe(true);

      const withServerId = {
        ...validContent,
        serverId: "stable-server-id",
      };
      const serverIdResult =
        MCPAppsActivityContentSchema.safeParse(withServerId);
      expect(serverIdResult.success).toBe(true);

      const withToolInput = {
        ...validContent,
        toolInput: { param1: "value1", param2: 42 },
      };
      const toolInputResult =
        MCPAppsActivityContentSchema.safeParse(withToolInput);
      expect(toolInputResult.success).toBe(true);
    });

    it("rejects invalid activity content", () => {
      const missingResourceUri = {
        serverHash: "hash123",
        result: { isError: false },
      };
      expect(
        MCPAppsActivityContentSchema.safeParse(missingResourceUri).success,
      ).toBe(false);

      const missingServerHash = {
        resourceUri: "ui://server/resource",
        result: { isError: false },
      };
      expect(
        MCPAppsActivityContentSchema.safeParse(missingServerHash).success,
      ).toBe(false);

      const missingResult = {
        resourceUri: "ui://server/resource",
        serverHash: "hash123",
      };
      expect(
        MCPAppsActivityContentSchema.safeParse(missingResult).success,
      ).toBe(false);
    });
  });

  describe("Activity Type Integration", () => {
    it("built-in MCP Apps renderer is registered with correct activity type", async () => {
      const agent = new MockMCPProxyAgent();
      renderChatWithAgent(agent);

      await submitMessageAndWaitForRun("Test MCP");

      await agent.emit(runStartedEvent());
      await agent.emit(
        activitySnapshotEvent({
          messageId: "mcp-activity",
          activityType: "mcp-apps",
          content: mcpAppsActivityContent({
            resourceUri: "ui://builtin/test",
            serverHash: "builtin-hash",
          }),
        }),
      );
      await agent.emit(runFinishedEvent());
    });

    it("user-provided renderer takes precedence over built-in", async () => {
      const agent = new MockMCPProxyAgent();
      renderChatWithAgent(agent, { withCustomRenderer: true });

      await submitMessageAndWaitForRun("Custom renderer");

      await agent.emit(runStartedEvent());
      await agent.emit(
        activitySnapshotEvent({
          messageId: "mcp-activity",
          activityType: MCPAppsActivityType,
          content: mcpAppsActivityContent({
            resourceUri: "ui://custom/resource",
            serverHash: "custom-hash",
          }),
        }),
      );
      await agent.emit(runFinishedEvent());

      await waitFor(() => {
        expect(screen.getByTestId("custom-mcp-renderer")).toBeDefined();
        expect(document.body.textContent ?? "").toContain(
          "Custom MCP Renderer: ui://custom/resource",
        );
      });
    });
  });

  describe("Multiple Activity Messages", () => {
    it("renders multiple MCP Apps activities independently", async () => {
      const agent = new MockMCPProxyAgent();

      const originalRunAgent = agent.runAgent.bind(agent);
      agent.runAgent = vi.fn(
        async (input?: Partial<RunAgentInput>): Promise<RunAgentResult> => {
          const proxiedRequest = input?.forwardedProps?.__proxiedMCPRequest as
            | { method: string; params?: { uri?: string } }
            | undefined;
          if (proxiedRequest?.method === "resources/read") {
            const uri = proxiedRequest.params?.uri;
            if (uri === "ui://first/app") {
              return {
                result: {
                  contents: [
                    {
                      uri,
                      mimeType: "text/html",
                      text: "<div>First App</div>",
                    },
                  ],
                },
                newMessages: [],
              };
            }
            if (uri === "ui://second/app") {
              return {
                result: {
                  contents: [
                    {
                      uri,
                      mimeType: "text/html",
                      text: "<div>Second App</div>",
                    },
                  ],
                },
                newMessages: [],
              };
            }
          }
          return originalRunAgent(input);
        },
      );

      renderChatWithAgent(agent);

      await submitMessageAndWaitForRun("Multiple apps");

      await agent.emit(runStartedEvent());
      await agent.emit(
        activitySnapshotEvent({
          messageId: "mcp-first",
          activityType: MCPAppsActivityType,
          content: mcpAppsActivityContent({
            resourceUri: "ui://first/app",
            serverHash: "first-hash",
          }),
        }),
      );
      await agent.emit(
        activitySnapshotEvent({
          messageId: "mcp-second",
          activityType: MCPAppsActivityType,
          content: mcpAppsActivityContent({
            resourceUri: "ui://second/app",
            serverHash: "second-hash",
          }),
        }),
      );
      await agent.emit(runFinishedEvent());

      await waitFor(
        () => {
          const iframes = document.querySelectorAll("iframe[srcdoc]");
          expect(iframes.length).toBe(2);
        },
        { timeout: 2000 },
      );
    });
  });

  describe("Content Types", () => {
    it("handles text content from resource", async () => {
      const agent = new MockMCPProxyAgent();
      agent.setRunAgentResponse("resources/read", {
        contents: [
          {
            uri: "ui://test/text",
            mimeType: "text/html",
            text: "<html><body><h1>Text Content</h1></body></html>",
          },
        ],
      });

      renderChatWithAgent(agent);

      await submitMessageAndWaitForRun("Text content");

      await agent.emit(runStartedEvent());
      await agent.emit(
        activitySnapshotEvent({
          messageId: "mcp-activity",
          activityType: MCPAppsActivityType,
          content: mcpAppsActivityContent({
            resourceUri: "ui://test/text",
            serverHash: "text-hash",
          }),
        }),
      );
      await agent.emit(runFinishedEvent());
    });

    it("handles blob (base64) content from resource", async () => {
      const agent = new MockMCPProxyAgent();
      const base64Html = btoa("<html><body>Blob Content</body></html>");

      agent.setRunAgentResponse("resources/read", {
        contents: [
          {
            uri: "ui://test/blob",
            mimeType: "text/html",
            blob: base64Html,
          },
        ],
      });

      renderChatWithAgent(agent);

      await submitMessageAndWaitForRun("Blob content");

      await agent.emit(runStartedEvent());
      await agent.emit(
        activitySnapshotEvent({
          messageId: "mcp-activity",
          activityType: MCPAppsActivityType,
          content: mcpAppsActivityContent({
            resourceUri: "ui://test/blob",
            serverHash: "blob-hash",
          }),
        }),
      );
      await agent.emit(runFinishedEvent());
    });

    it("handles resource with no text or blob - iframe created but stuck waiting for sandbox", async () => {
      const agent = new MockMCPProxyAgent();
      agent.setRunAgentResponse("resources/read", {
        contents: [
          {
            uri: "ui://test/empty",
            mimeType: "text/html",
          },
        ],
      });

      renderChatWithAgent(agent);

      await submitMessageAndWaitForRun("No content");

      await agent.emit(runStartedEvent());
      await agent.emit(
        activitySnapshotEvent({
          messageId: "mcp-activity",
          activityType: MCPAppsActivityType,
          content: mcpAppsActivityContent({
            resourceUri: "ui://test/empty",
            serverHash: "empty-hash",
          }),
        }),
      );
      await agent.emit(runFinishedEvent());

      await waitFor(
        () => {
          const iframe = document.querySelector("iframe[srcdoc]");
          expect(iframe).not.toBeNull();
        },
        { timeout: 2000 },
      );
    });
  });

  describe("Metadata Handling", () => {
    it("applies border styling when prefersBorder is true", async () => {
      const agent = new MockMCPProxyAgent();
      agent.setRunAgentResponse("resources/read", {
        contents: [
          {
            uri: "ui://test/bordered",
            mimeType: "text/html",
            text: "<html><body>Bordered Content</body></html>",
            _meta: {
              ui: {
                prefersBorder: true,
              },
            },
          },
        ],
      });

      renderChatWithAgent(agent);

      await submitMessageAndWaitForRun("Bordered app");

      await agent.emit(runStartedEvent());
      await agent.emit(
        activitySnapshotEvent({
          messageId: "mcp-activity",
          activityType: MCPAppsActivityType,
          content: mcpAppsActivityContent({
            resourceUri: "ui://test/bordered",
            serverHash: "bordered-hash",
          }),
        }),
      );
      await agent.emit(runFinishedEvent());

      await waitFor(
        () => {
          expect(document.body.textContent ?? "").not.toContain("Loading...");
          const iframe = document.querySelector("iframe[srcdoc]");
          expect(iframe).not.toBeNull();
        },
        { timeout: 3000 },
      );
    });

    it("does not apply border styling when prefersBorder is false", async () => {
      const agent = new MockMCPProxyAgent();
      agent.setRunAgentResponse("resources/read", {
        contents: [
          {
            uri: "ui://test/borderless",
            mimeType: "text/html",
            text: "<html><body>Borderless Content</body></html>",
            _meta: {
              ui: {
                prefersBorder: false,
              },
            },
          },
        ],
      });

      renderChatWithAgent(agent);

      await submitMessageAndWaitForRun("Borderless app");

      await agent.emit(runStartedEvent());
      await agent.emit(
        activitySnapshotEvent({
          messageId: "mcp-activity",
          activityType: MCPAppsActivityType,
          content: mcpAppsActivityContent({
            resourceUri: "ui://test/borderless",
            serverHash: "borderless-hash",
          }),
        }),
      );
      await agent.emit(runFinishedEvent());
    });
  });
});
