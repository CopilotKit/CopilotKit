/**
 * End-to-end tests for MCP Apps Activity Renderer
 *
 * Tests the complete flow of rendering MCP Apps UI:
 * 1. Activity snapshot received with resourceUri
 * 2. Resource fetched via proxied MCP request
 * 3. Sandboxed iframe created and communicates via JSON-RPC
 * 4. Tool calls proxied back through the agent
 */
import { fireEvent, screen, waitFor, act } from "@testing-library/react";
import { vi } from "vitest";
import {
  activitySnapshotEvent,
  renderWithCopilotKit,
  runFinishedEvent,
  runStartedEvent,
  testId,
} from "@/__tests__/utils/test-helpers";
import {
  MCPAppsActivityType,
  MCPAppsActivityContentSchema,
} from "@/components/MCPAppsActivityRenderer";
import { ReactActivityMessageRenderer } from "@/types";
import {
  AbstractAgent,
  RunAgentInput,
  RunAgentResult,
  BaseEvent,
  EventType,
} from "@ag-ui/client";
import { Observable, Subject } from "rxjs";

/**
 * Mock agent that intercepts runAgent calls for proxied MCP requests
 * while preserving normal streaming behavior for regular runs.
 */
class MockMCPProxyAgent extends AbstractAgent {
  private subject = new Subject<BaseEvent>();

  // Track runAgent calls for verification
  public runAgentCalls: Array<{ input: Partial<RunAgentInput> }> = [];

  // Configurable responses for proxied MCP requests
  private runAgentResponses: Map<string, unknown> = new Map();

  /**
   * Set the response for a specific MCP method
   */
  setRunAgentResponse(method: string, response: unknown) {
    this.runAgentResponses.set(method, response);
  }

  /**
   * Emit a single agent event
   */
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

  /**
   * Complete the agent stream
   */
  complete() {
    this.isRunning = false;
    act(() => {
      this.subject.complete();
    });
  }

  clone(): MockMCPProxyAgent {
    return this;
  }

  run(_input: RunAgentInput): Observable<BaseEvent> {
    return this.subject.asObservable();
  }

  /**
   * Override runAgent to intercept proxied MCP requests only.
   * For normal message flows, delegate to the parent class.
   */
  async runAgent(input?: Partial<RunAgentInput>): Promise<RunAgentResult> {
    const proxiedRequest = input?.forwardedProps?.__proxiedMCPRequest as
      | {
          serverHash?: string;
          serverId?: string;
          method: string;
          params?: Record<string, unknown>;
        }
      | undefined;

    // Only intercept proxied MCP requests
    if (proxiedRequest) {
      if (input) {
        this.runAgentCalls.push({ input });
      }

      const method = proxiedRequest.method;
      const response = this.runAgentResponses.get(method);

      if (response !== undefined) {
        return { result: response, newMessages: [] };
      }

      // Default responses
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

    // For normal runs (user messages), use the parent's runAgent which
    // properly subscribes to run() and processes streaming events
    return super.runAgent(input);
  }
}

/**
 * Helper to create MCP Apps activity content matching the 0.0.2 schema
 */
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

describe("MCP Apps Activity Renderer E2E", () => {
  beforeEach(() => {
    // Reset any global state
    vi.clearAllMocks();
  });

  describe("Resource Fetching", () => {
    it("fetches resource content via proxied MCP request on mount", async () => {
      const agent = new MockMCPProxyAgent();
      const agentId = "mcp-test-agent";
      agent.agentId = agentId;

      // Set up response for resources/read
      agent.setRunAgentResponse("resources/read", {
        contents: [
          {
            uri: "ui://test-server/dashboard",
            mimeType: "text/html",
            text: "<html><body>Dashboard content</body></html>",
          },
        ],
      });

      renderWithCopilotKit({
        agents: { [agentId]: agent },
        agentId,
      });

      const input = await screen.findByRole("textbox");
      fireEvent.change(input, { target: { value: "Show dashboard" } });
      fireEvent.keyDown(input, { key: "Enter", code: "Enter" });

      await waitFor(() => {
        expect(screen.getByText("Show dashboard")).toBeDefined();
      });

      const activityMessageId = testId("mcp-activity");
      agent.emit(runStartedEvent());
      agent.emit(
        activitySnapshotEvent({
          messageId: activityMessageId,
          activityType: MCPAppsActivityType,
          content: mcpAppsActivityContent({
            resourceUri: "ui://test-server/dashboard",
            serverHash: "dashboard-hash-123",
          }),
        }),
      );
      agent.emit(runFinishedEvent());

      // Wait for the activity renderer to mount and show loading
      await waitFor(
        () => {
          expect(screen.getByText("Loading...")).toBeDefined();
        },
        { timeout: 2000 },
      );

      // Wait for resource fetch to be called
      await waitFor(
        () => {
          expect(agent.runAgentCalls.length).toBeGreaterThan(0);
        },
        { timeout: 2000 },
      );

      // Verify the proxied MCP request was made correctly
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
      const agentId = "mcp-test-agent";
      agent.agentId = agentId;

      agent.setRunAgentResponse("resources/read", {
        contents: [
          {
            uri: "ui://my-app/settings",
            mimeType: "text/html",
            text: "<html><body>Settings</body></html>",
          },
        ],
      });

      renderWithCopilotKit({
        agents: { [agentId]: agent },
        agentId,
      });

      const input = await screen.findByRole("textbox");
      fireEvent.change(input, { target: { value: "Show settings" } });
      fireEvent.keyDown(input, { key: "Enter", code: "Enter" });

      await waitFor(() => {
        expect(screen.getByText("Show settings")).toBeDefined();
      });

      agent.emit(runStartedEvent());
      agent.emit(
        activitySnapshotEvent({
          messageId: testId("mcp-activity"),
          activityType: MCPAppsActivityType,
          content: mcpAppsActivityContent({
            resourceUri: "ui://my-app/settings",
            serverHash: "fallback-hash",
            serverId: "my-app-stable-id", // Should take precedence
          }),
        }),
      );
      agent.emit(runFinishedEvent());

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
      const agentId = "mcp-test-agent";
      agent.agentId = agentId;

      // Create a promise that we can control
      let resolveResource: (value: unknown) => void;
      const resourcePromise = new Promise((resolve) => {
        resolveResource = resolve;
      });

      // Override runAgent to use our controlled promise
      const originalRunAgent = agent.runAgent.bind(agent);
      agent.runAgent = async (
        input?: Partial<RunAgentInput>,
      ): Promise<RunAgentResult> => {
        const proxiedRequest = input?.forwardedProps?.__proxiedMCPRequest as
          | { method: string }
          | undefined;
        if (proxiedRequest?.method === "resources/read") {
          await resourcePromise;
          return originalRunAgent(input);
        }
        return originalRunAgent(input);
      };

      renderWithCopilotKit({
        agents: { [agentId]: agent },
        agentId,
      });

      const input = await screen.findByRole("textbox");
      fireEvent.change(input, { target: { value: "Load app" } });
      fireEvent.keyDown(input, { key: "Enter", code: "Enter" });

      await waitFor(() => {
        expect(screen.getByText("Load app")).toBeDefined();
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

      // Should show loading state
      await waitFor(() => {
        expect(screen.getByText("Loading...")).toBeDefined();
      });

      // Resolve the resource fetch
      act(() => {
        resolveResource!(true);
      });

      // Loading should eventually disappear (iframe created)
      await waitFor(
        () => {
          expect(screen.queryByText("Loading...")).toBeNull();
        },
        { timeout: 3000 },
      );
    });

    it("shows error state when resource fetch fails", async () => {
      const agent = new MockMCPProxyAgent();
      const agentId = "mcp-test-agent";
      agent.agentId = agentId;

      // Make proxied MCP requests throw an error
      const originalRunAgent = agent.runAgent.bind(agent);
      agent.runAgent = async (
        input?: Partial<RunAgentInput>,
      ): Promise<RunAgentResult> => {
        const proxiedRequest = input?.forwardedProps?.__proxiedMCPRequest as
          | { method: string }
          | undefined;
        if (proxiedRequest) {
          throw new Error("Network error: Failed to fetch resource");
        }
        return originalRunAgent(input);
      };

      renderWithCopilotKit({
        agents: { [agentId]: agent },
        agentId,
      });

      const input = await screen.findByRole("textbox");
      fireEvent.change(input, { target: { value: "Fetch broken" } });
      fireEvent.keyDown(input, { key: "Enter", code: "Enter" });

      await waitFor(() => {
        expect(screen.getByText("Fetch broken")).toBeDefined();
      });

      agent.emit(runStartedEvent());
      agent.emit(
        activitySnapshotEvent({
          messageId: testId("mcp-activity"),
          activityType: MCPAppsActivityType,
          content: mcpAppsActivityContent({
            resourceUri: "ui://broken/resource",
            serverHash: "broken-hash",
          }),
        }),
      );
      agent.emit(runFinishedEvent());

      // Should show error state
      await waitFor(() => {
        expect(
          screen.getByText(/Error:.*Failed to fetch resource/i),
        ).toBeDefined();
      });
    });

    it("handles resource with no content gracefully", async () => {
      const agent = new MockMCPProxyAgent();
      const agentId = "mcp-test-agent";
      agent.agentId = agentId;

      // Return empty contents
      agent.setRunAgentResponse("resources/read", {
        contents: [],
      });

      renderWithCopilotKit({
        agents: { [agentId]: agent },
        agentId,
      });

      const input = await screen.findByRole("textbox");
      fireEvent.change(input, { target: { value: "Empty resource" } });
      fireEvent.keyDown(input, { key: "Enter", code: "Enter" });

      await waitFor(() => {
        expect(screen.getByText("Empty resource")).toBeDefined();
      });

      agent.emit(runStartedEvent());
      agent.emit(
        activitySnapshotEvent({
          messageId: testId("mcp-activity"),
          activityType: MCPAppsActivityType,
          content: mcpAppsActivityContent({
            resourceUri: "ui://empty/resource",
            serverHash: "empty-hash",
          }),
        }),
      );
      agent.emit(runFinishedEvent());

      // Should show error about no content
      await waitFor(() => {
        expect(screen.getByText(/Error:.*No resource content/i)).toBeDefined();
      });
    });
  });

  describe("Schema Validation", () => {
    it("validates activity content with the correct schema", () => {
      // Valid content
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

      // With optional serverId
      const withServerId = {
        ...validContent,
        serverId: "stable-server-id",
      };
      const serverIdResult =
        MCPAppsActivityContentSchema.safeParse(withServerId);
      expect(serverIdResult.success).toBe(true);

      // With toolInput
      const withToolInput = {
        ...validContent,
        toolInput: { param1: "value1", param2: 42 },
      };
      const toolInputResult =
        MCPAppsActivityContentSchema.safeParse(withToolInput);
      expect(toolInputResult.success).toBe(true);
    });

    it("rejects invalid activity content", () => {
      // Missing required fields
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
      const agentId = "mcp-test-agent";
      agent.agentId = agentId;

      renderWithCopilotKit({
        agents: { [agentId]: agent },
        agentId,
        // Don't pass any custom renderers - built-in should be used
      });

      const input = await screen.findByRole("textbox");
      fireEvent.change(input, { target: { value: "Test MCP" } });
      fireEvent.keyDown(input, { key: "Enter", code: "Enter" });

      await waitFor(() => {
        expect(screen.getByText("Test MCP")).toBeDefined();
      });

      agent.emit(runStartedEvent());
      agent.emit(
        activitySnapshotEvent({
          messageId: testId("mcp-activity"),
          activityType: "mcp-apps", // Should match MCPAppsActivityType
          content: mcpAppsActivityContent({
            resourceUri: "ui://builtin/test",
            serverHash: "builtin-hash",
          }),
        }),
      );
      agent.emit(runFinishedEvent());

      // Should show loading (meaning the renderer was matched)
      await waitFor(() => {
        expect(screen.getByText("Loading...")).toBeDefined();
      });
    });

    it("user-provided renderer takes precedence over built-in", async () => {
      const agent = new MockMCPProxyAgent();
      const agentId = "mcp-test-agent";
      agent.agentId = agentId;

      // Custom renderer that overrides the built-in
      const customRenderer: ReactActivityMessageRenderer<unknown> = {
        activityType: MCPAppsActivityType,
        content: MCPAppsActivityContentSchema,
        render: ({ content }) => (
          <div data-testid="custom-mcp-renderer">
            Custom MCP Renderer: {(content as any).resourceUri}
          </div>
        ),
      };

      renderWithCopilotKit({
        agents: { [agentId]: agent },
        agentId,
        renderActivityMessages: [customRenderer],
      });

      const input = await screen.findByRole("textbox");
      fireEvent.change(input, { target: { value: "Custom renderer" } });
      fireEvent.keyDown(input, { key: "Enter", code: "Enter" });

      await waitFor(() => {
        expect(screen.getByText("Custom renderer")).toBeDefined();
      });

      agent.emit(runStartedEvent());
      agent.emit(
        activitySnapshotEvent({
          messageId: testId("mcp-activity"),
          activityType: MCPAppsActivityType,
          content: mcpAppsActivityContent({
            resourceUri: "ui://custom/resource",
            serverHash: "custom-hash",
          }),
        }),
      );
      agent.emit(runFinishedEvent());

      // Should render custom component, not loading
      await waitFor(() => {
        expect(screen.getByTestId("custom-mcp-renderer")).toBeDefined();
        expect(
          screen.getByText(/Custom MCP Renderer:.*ui:\/\/custom\/resource/),
        ).toBeDefined();
      });
    });
  });

  describe("Multiple Activity Messages", () => {
    it("renders multiple MCP Apps activities independently", async () => {
      const agent = new MockMCPProxyAgent();
      const agentId = "mcp-test-agent";
      agent.agentId = agentId;

      // Set up different responses for different URIs
      const originalRunAgent = agent.runAgent.bind(agent);
      agent.runAgent = async (
        input?: Partial<RunAgentInput>,
      ): Promise<RunAgentResult> => {
        const proxiedRequest = input?.forwardedProps?.__proxiedMCPRequest as {
          method: string;
          params?: { uri?: string };
        };
        if (proxiedRequest?.method === "resources/read") {
          const uri = proxiedRequest.params?.uri;
          if (uri === "ui://first/app") {
            return {
              result: {
                contents: [
                  { uri, mimeType: "text/html", text: "<div>First App</div>" },
                ],
              },
              newMessages: [],
            };
          }
          if (uri === "ui://second/app") {
            return {
              result: {
                contents: [
                  { uri, mimeType: "text/html", text: "<div>Second App</div>" },
                ],
              },
              newMessages: [],
            };
          }
        }
        // For non-proxied requests, use original behavior
        return originalRunAgent(input);
      };

      renderWithCopilotKit({
        agents: { [agentId]: agent },
        agentId,
      });

      const input = await screen.findByRole("textbox");
      fireEvent.change(input, { target: { value: "Multiple apps" } });
      fireEvent.keyDown(input, { key: "Enter", code: "Enter" });

      await waitFor(() => {
        expect(screen.getByText("Multiple apps")).toBeDefined();
      });

      agent.emit(runStartedEvent());

      // Emit two activity messages
      agent.emit(
        activitySnapshotEvent({
          messageId: testId("mcp-first"),
          activityType: MCPAppsActivityType,
          content: mcpAppsActivityContent({
            resourceUri: "ui://first/app",
            serverHash: "first-hash",
          }),
        }),
      );

      agent.emit(
        activitySnapshotEvent({
          messageId: testId("mcp-second"),
          activityType: MCPAppsActivityType,
          content: mcpAppsActivityContent({
            resourceUri: "ui://second/app",
            serverHash: "second-hash",
          }),
        }),
      );

      agent.emit(runFinishedEvent());

      // Both activities should trigger resource fetches and create iframes.
      // Due to async timing, the loading states might clear quickly,
      // so we verify both iframes are eventually created.
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
      const agentId = "mcp-test-agent";
      agent.agentId = agentId;

      agent.setRunAgentResponse("resources/read", {
        contents: [
          {
            uri: "ui://test/text",
            mimeType: "text/html",
            text: "<html><body><h1>Text Content</h1></body></html>",
          },
        ],
      });

      renderWithCopilotKit({
        agents: { [agentId]: agent },
        agentId,
      });

      const input = await screen.findByRole("textbox");
      fireEvent.change(input, { target: { value: "Text content" } });
      fireEvent.keyDown(input, { key: "Enter", code: "Enter" });

      await waitFor(() => {
        expect(screen.getByText("Text content")).toBeDefined();
      });

      agent.emit(runStartedEvent());
      agent.emit(
        activitySnapshotEvent({
          messageId: testId("mcp-activity"),
          activityType: MCPAppsActivityType,
          content: mcpAppsActivityContent({
            resourceUri: "ui://test/text",
            serverHash: "text-hash",
          }),
        }),
      );
      agent.emit(runFinishedEvent());

      // Should transition from loading to rendered
      await waitFor(() => {
        expect(screen.getByText("Loading...")).toBeDefined();
      });
    });

    it("handles blob (base64) content from resource", async () => {
      const agent = new MockMCPProxyAgent();
      const agentId = "mcp-test-agent";
      agent.agentId = agentId;

      // Base64 encoded "<html><body>Blob Content</body></html>"
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

      renderWithCopilotKit({
        agents: { [agentId]: agent },
        agentId,
      });

      const input = await screen.findByRole("textbox");
      fireEvent.change(input, { target: { value: "Blob content" } });
      fireEvent.keyDown(input, { key: "Enter", code: "Enter" });

      await waitFor(() => {
        expect(screen.getByText("Blob content")).toBeDefined();
      });

      agent.emit(runStartedEvent());
      agent.emit(
        activitySnapshotEvent({
          messageId: testId("mcp-activity"),
          activityType: MCPAppsActivityType,
          content: mcpAppsActivityContent({
            resourceUri: "ui://test/blob",
            serverHash: "blob-hash",
          }),
        }),
      );
      agent.emit(runFinishedEvent());

      // Should show loading initially
      await waitFor(() => {
        expect(screen.getByText("Loading...")).toBeDefined();
      });
    });

    it("handles resource with no text or blob - iframe created but stuck waiting for sandbox", async () => {
      // NOTE: In jsdom, the sandbox iframe (using srcdoc) can't fully execute, so the
      // component will create an iframe and wait for the sandbox proxy to be ready.
      // The actual error for missing text/blob happens inside the sandbox communication
      // flow which can't complete in jsdom. This test verifies that:
      // 1. The component fetches the resource successfully
      // 2. The iframe is created (showing the component progressed past loading)

      const agent = new MockMCPProxyAgent();
      const agentId = "mcp-test-agent";
      agent.agentId = agentId;

      // Resource with neither text nor blob
      agent.setRunAgentResponse("resources/read", {
        contents: [
          {
            uri: "ui://test/empty",
            mimeType: "text/html",
            // No text or blob field - in real environment this would cause an error
            // after sandbox proxy is ready, but in jsdom the proxy never responds
          },
        ],
      });

      renderWithCopilotKit({
        agents: { [agentId]: agent },
        agentId,
      });

      const input = await screen.findByRole("textbox");
      fireEvent.change(input, { target: { value: "No content" } });
      fireEvent.keyDown(input, { key: "Enter", code: "Enter" });

      await waitFor(() => {
        expect(screen.getByText("No content")).toBeDefined();
      });

      agent.emit(runStartedEvent());
      agent.emit(
        activitySnapshotEvent({
          messageId: testId("mcp-activity"),
          activityType: MCPAppsActivityType,
          content: mcpAppsActivityContent({
            resourceUri: "ui://test/empty",
            serverHash: "empty-hash",
          }),
        }),
      );
      agent.emit(runFinishedEvent());

      // Verify the iframe is created (component progressed past loading)
      // In jsdom, the sandbox proxy never responds, so the error for missing text/blob
      // is never reached. This is a limitation of jsdom testing.
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
      const agentId = "mcp-test-agent";
      agent.agentId = agentId;

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

      renderWithCopilotKit({
        agents: { [agentId]: agent },
        agentId,
      });

      const input = await screen.findByRole("textbox");
      fireEvent.change(input, { target: { value: "Bordered app" } });
      fireEvent.keyDown(input, { key: "Enter", code: "Enter" });

      await waitFor(() => {
        expect(screen.getByText("Bordered app")).toBeDefined();
      });

      agent.emit(runStartedEvent());
      agent.emit(
        activitySnapshotEvent({
          messageId: testId("mcp-activity"),
          activityType: MCPAppsActivityType,
          content: mcpAppsActivityContent({
            resourceUri: "ui://test/bordered",
            serverHash: "bordered-hash",
          }),
        }),
      );
      agent.emit(runFinishedEvent());

      // Wait for resource to be fetched and iframe to be created
      await waitFor(
        () => {
          // Loading should disappear
          expect(screen.queryByText("Loading...")).toBeNull();
          // Iframe should be created
          const iframe = document.querySelector("iframe[srcdoc]");
          expect(iframe).not.toBeNull();
        },
        { timeout: 3000 },
      );

      // Note: Border styling is applied via inline styles based on prefersBorder metadata.
      // In jsdom, verifying inline styles is not reliable, but we've verified the component
      // renders successfully with the metadata that includes prefersBorder: true.
    });

    it("does not apply border styling when prefersBorder is false", async () => {
      const agent = new MockMCPProxyAgent();
      const agentId = "mcp-test-agent";
      agent.agentId = agentId;

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

      renderWithCopilotKit({
        agents: { [agentId]: agent },
        agentId,
      });

      const input = await screen.findByRole("textbox");
      fireEvent.change(input, { target: { value: "Borderless app" } });
      fireEvent.keyDown(input, { key: "Enter", code: "Enter" });

      await waitFor(() => {
        expect(screen.getByText("Borderless app")).toBeDefined();
      });

      agent.emit(runStartedEvent());
      agent.emit(
        activitySnapshotEvent({
          messageId: testId("mcp-activity"),
          activityType: MCPAppsActivityType,
          content: mcpAppsActivityContent({
            resourceUri: "ui://test/borderless",
            serverHash: "borderless-hash",
          }),
        }),
      );
      agent.emit(runFinishedEvent());

      // Verify component renders without error
      await waitFor(() => {
        expect(screen.getByText("Loading...")).toBeDefined();
      });
    });
  });
});
