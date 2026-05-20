import React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { z } from "zod";
import type { AbstractAgent } from "@ag-ui/client";
import { EventType } from "@ag-ui/client";
import {
  MockReconnectableAgent,
  MockStepwiseAgent,
  activitySnapshotEvent,
  renderWithCopilotKit,
  runFinishedEvent,
  runStartedEvent,
  testId,
} from "../../../__tests__/utils/test-helpers";
import type { ReactActivityMessageRenderer } from "../../../types";
import {
  CopilotChatConfigurationProvider,
  CopilotKitProvider,
  useCopilotKit,
} from "../../../providers";
import { IntelligenceAgent } from "@copilotkit/core";
import { createA2UIMessageRenderer } from "../../../a2ui/A2UIMessageRenderer";
import type { Theme } from "@copilotkit/a2ui-renderer";
import { CopilotChat } from "..";

const {
  mockWebsandboxCreate,
  mockWebsandboxDestroy,
  mockPhoenixSockets,
  MockPhoenixSocket,
} = vi.hoisted(() => {
  const mockDestroy = vi.fn();
  const mockCreate = vi.fn((..._args: unknown[]) => ({
    iframe: document.createElement("iframe"),
    promise: Promise.resolve(),
    run: vi.fn().mockResolvedValue(undefined),
    destroy: mockDestroy,
  }));
  const mockSockets: MockPhoenixSocket[] = [];

  class MockPhoenixPush {
    private callbacks = new Map<string, (response?: unknown) => void>();

    receive(
      status: string,
      callback: (response?: unknown) => void,
    ): MockPhoenixPush {
      this.callbacks.set(status, callback);
      return this;
    }

    trigger(status: string, response?: unknown): void {
      this.callbacks.get(status)?.(response);
    }
  }

  class MockPhoenixChannel {
    public topic: string;
    public params: Record<string, unknown>;
    public left = false;

    private handlers = new Map<
      string,
      Array<{ ref: number; callback: (payload: unknown) => void }>
    >();
    private joinPush = new MockPhoenixPush();
    private nextRef = 1;

    constructor(topic: string, params: Record<string, unknown>) {
      this.topic = topic;
      this.params = params;
    }

    on(event: string, callback: (payload: unknown) => void): number {
      if (!this.handlers.has(event)) {
        this.handlers.set(event, []);
      }
      const ref = this.nextRef;
      this.nextRef += 1;
      this.handlers.get(event)?.push({ ref, callback });
      return ref;
    }

    off(event: string, ref?: number): void {
      if (ref === undefined) {
        this.handlers.delete(event);
        return;
      }
      this.handlers.set(
        event,
        (this.handlers.get(event) ?? []).filter(
          (handler) => handler.ref !== ref,
        ),
      );
    }

    join(): MockPhoenixPush {
      return this.joinPush;
    }

    leave(): void {
      this.left = true;
    }

    triggerJoin(status: string, response?: unknown): void {
      this.joinPush.trigger(status, response);
    }

    serverPush(event: string, payload: unknown): void {
      for (const { callback } of this.handlers.get(event) ?? []) {
        callback(payload);
      }
    }
  }

  class MockPhoenixSocket {
    public channels: MockPhoenixChannel[] = [];

    constructor(
      public url: string,
      public opts: Record<string, unknown>,
    ) {
      mockSockets.push(this);
    }

    connect(): void {}

    disconnect(): void {}

    onOpen(): void {}

    onError(): void {}

    channel(
      topic: string,
      params: Record<string, unknown>,
    ): MockPhoenixChannel {
      const channel = new MockPhoenixChannel(topic, params);
      this.channels.push(channel);
      return channel;
    }
  }

  return {
    mockWebsandboxCreate: mockCreate,
    mockWebsandboxDestroy: mockDestroy,
    mockPhoenixSockets: mockSockets,
    MockPhoenixSocket,
  };
});

vi.mock("phoenix", () => ({
  Socket: MockPhoenixSocket,
}));

vi.mock("@jetbrains/websandbox", () => ({
  default: {
    create: (...args: unknown[]) => mockWebsandboxCreate(...args),
  },
}));

function jsonResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: status === 200 ? "OK" : "Error",
    json: async () => body,
    text: async () => JSON.stringify(body),
  } as Response;
}

describe("CopilotChat activity message rendering", () => {
  it("renders custom components for activity snapshots", async () => {
    const agent = new MockStepwiseAgent();
    const agentId = "search-agent";
    agent.agentId = agentId;

    const activityRenderer: ReactActivityMessageRenderer<{
      status: string;
      percent: number;
    }> = {
      activityType: "search-progress",
      content: z.object({ status: z.string(), percent: z.number() }),
      render: ({ content, agent: rendererAgent }) => (
        <div data-testid="activity-card">
          {content.status} · {content.percent}% · {rendererAgent?.agentId}
        </div>
      ),
    };

    renderWithCopilotKit({
      agents: { [agentId]: agent },
      agentId,
      renderActivityMessages: [activityRenderer],
    });

    const input = await screen.findByRole("textbox");
    fireEvent.change(input, { target: { value: "Start search" } });
    fireEvent.keyDown(input, { key: "Enter", code: "Enter" });

    await waitFor(() => {
      expect(screen.getByText("Start search")).toBeDefined();
    });

    const activityMessageId = testId("activity");
    agent.emit(runStartedEvent());
    agent.emit(
      activitySnapshotEvent({
        messageId: activityMessageId,
        activityType: "search-progress",
        content: { status: "Fetching", percent: 30 },
      }),
    );
    agent.emit(runFinishedEvent());

    await waitFor(() => {
      const textContent = screen.getByTestId("activity-card").textContent ?? "";
      expect(textContent).toContain("Fetching");
      expect(textContent).toContain(agentId);
    });
  });

  it("skips unmatched activity types when no renderer exists", async () => {
    const agent = new MockStepwiseAgent();

    renderWithCopilotKit({
      agent,
      renderActivityMessages: [],
    });

    const input = await screen.findByRole("textbox");
    fireEvent.change(input, { target: { value: "Start search" } });
    fireEvent.keyDown(input, { key: "Enter", code: "Enter" });

    await waitFor(() => {
      expect(screen.getByText("Start search")).toBeDefined();
    });

    const activityMessageId = testId("activity-unmatched");
    agent.emit(runStartedEvent());
    agent.emit(
      activitySnapshotEvent({
        messageId: activityMessageId,
        activityType: "unknown",
        content: { note: "no-op" },
      }),
    );
    agent.emit(runFinishedEvent());

    await waitFor(() => {
      expect(screen.queryByTestId("activity-card")).toBeNull();
    });
  });

  it("useCopilotKit provides valid copilotkit instance inside activity message renderer", async () => {
    const agent = new MockStepwiseAgent();
    const agentId = "test-agent";
    agent.agentId = agentId;

    let capturedCopilotkit: any = "not-called";

    // Matches real-world pattern: inline arrow function with hooks
    const activityRenderer: ReactActivityMessageRenderer<{ message: string }> =
      {
        activityType: "test-activity",
        content: z.object({ message: z.string() }),
        render: ({ content }) => {
          const { copilotkit } = useCopilotKit();
          capturedCopilotkit = copilotkit;
          return <div data-testid="activity-render">{content.message}</div>;
        },
      };

    renderWithCopilotKit({
      agents: { [agentId]: agent },
      agentId,
      renderActivityMessages: [activityRenderer],
    });

    // Trigger user message and activity event
    const input = await screen.findByRole("textbox");
    fireEvent.change(input, { target: { value: "Test message" } });
    fireEvent.keyDown(input, { key: "Enter", code: "Enter" });

    await waitFor(() => {
      expect(screen.getByText("Test message")).toBeDefined();
    });

    agent.emit(runStartedEvent());
    agent.emit(
      activitySnapshotEvent({
        messageId: testId("activity"),
        activityType: "test-activity",
        content: { message: "Rendered content" },
      }),
    );
    agent.emit(runFinishedEvent());

    await waitFor(() => {
      expect(screen.getByTestId("activity-render")).toBeDefined();
    });

    // Verify context is properly propagated - copilotkit should NOT be null
    expect(capturedCopilotkit).not.toBeNull();
    expect(capturedCopilotkit).toBeDefined();
  });

  it("activity renderers receive the agent under the config agentId, not any other registered agent", async () => {
    // Regression: the renderer's `agent` prop must come from
    // `copilotkit.getAgent(config.agentId)` — the local registry id from
    // CopilotChatConfigurationProvider — not from any other agent in the
    // registry (e.g. a sibling chat's agent).
    //
    // The trap this catches is a refactor where the renderer pipeline keys
    // on something other than `config.agentId` (e.g. for proxied
    // registrations, accidentally keying on `proxy.runtimeAgentId`). The
    // assertion shape — "two agents in the registry, the renderer must
    // receive the one matching config.agentId" — is generic to that bug
    // class. The proxy-routing-specific behavior (registering a
    // ProxiedCopilotRuntimeAgent with `runtimeAgentId !== agentId` and
    // verifying `getAgent(agentId)` returns the proxy, not the agent at
    // runtimeAgentId) is covered by `core-register-proxied-agent.test.ts`
    // at the registry level.
    const localAgent = new MockStepwiseAgent();
    localAgent.agentId = "chat-1";
    const otherAgent = new MockStepwiseAgent();
    otherAgent.agentId = "default";

    let capturedAgent: AbstractAgent | undefined;
    const activityRenderer: ReactActivityMessageRenderer<{ label: string }> = {
      activityType: "button-action",
      content: z.object({ label: z.string() }),
      render: ({ content, agent: renderedAgent }) => {
        capturedAgent = renderedAgent;
        return <button data-testid="action-button">{content.label}</button>;
      },
    };

    renderWithCopilotKit({
      agents: { "chat-1": localAgent, default: otherAgent },
      agentId: "chat-1",
      threadId: "thread-for-action-test",
      renderActivityMessages: [activityRenderer],
    });

    const input = await screen.findByRole("textbox");
    fireEvent.change(input, { target: { value: "show me buttons" } });
    fireEvent.keyDown(input, { key: "Enter", code: "Enter" });

    await waitFor(() => {
      expect(screen.getByText("show me buttons")).toBeDefined();
    });

    localAgent.emit(runStartedEvent());
    localAgent.emit(
      activitySnapshotEvent({
        messageId: testId("activity-action"),
        activityType: "button-action",
        content: { label: "Click Me" },
      }),
    );
    localAgent.emit(runFinishedEvent());

    await waitFor(() => {
      expect(screen.getByTestId("action-button")).toBeDefined();
    });

    expect(capturedAgent).toBe(localAgent);
    expect(capturedAgent).not.toBe(otherAgent);
  });

  it("restores a completed A2UI surface after reconnect from an event-native baseline", async () => {
    const agent = new MockReconnectableAgent();
    const threadId = testId("a2ui-thread");
    const surfaceId = testId("surface");
    const a2uiRenderer = createA2UIMessageRenderer({
      theme: {} as Theme,
    });

    const { unmount } = renderWithCopilotKit({
      agent,
      threadId,
      renderActivityMessages: [a2uiRenderer],
    });

    const input = await screen.findByRole("textbox");
    fireEvent.change(input, { target: { value: "Show me the restored UI" } });
    fireEvent.keyDown(input, { key: "Enter", code: "Enter" });

    await waitFor(() => {
      expect(screen.getByText("Show me the restored UI")).toBeDefined();
    });

    agent.emit(runStartedEvent());
    agent.emit(
      activitySnapshotEvent({
        messageId: testId("a2ui-activity"),
        activityType: "a2ui-surface",
        content: {
          a2ui_operations: [
            {
              version: "v0.9",
              createSurface: {
                surfaceId,
                catalogId:
                  "https://a2ui.org/specification/v0_9/basic_catalog.json",
              },
            },
            {
              version: "v0.9",
              updateComponents: {
                surfaceId,
                components: [
                  {
                    id: "root",
                    component: "Text",
                    text: "Restored dashboard",
                    variant: "body",
                  },
                ],
              },
            },
          ],
        },
      }),
    );
    agent.emit(runFinishedEvent());
    agent.complete();

    await waitFor(() => {
      expect(
        document.querySelector(`[data-surface-id='${surfaceId}']`),
      ).not.toBeNull();
    });

    unmount();
    agent.reset();

    renderWithCopilotKit({
      agent,
      threadId,
      renderActivityMessages: [a2uiRenderer],
    });

    await waitFor(() => {
      expect(
        document.querySelector(`[data-surface-id='${surfaceId}']`),
      ).not.toBeNull();
    });
  });

  it("restores a completed A2UI surface from IntelligenceAgent /connect gateway replay", async () => {
    const threadId = testId("intelligence-connect-thread");
    const surfaceId = testId("intelligence-connect-surface");
    const fetchMock = vi.fn().mockResolvedValueOnce(
      jsonResponse({
        threadId,
        runId: null,
        joinToken: "join-token-1",
        realtime: {
          clientUrl: "ws://localhost:4000/client",
          topic: `thread:${threadId}`,
        },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);
    mockPhoenixSockets.length = 0;

    const agent = new IntelligenceAgent({
      url: "ws://localhost:4000/client",
      runtimeUrl: "http://localhost:4000",
      agentId: "my-agent",
    });
    const a2uiRenderer = createA2UIMessageRenderer({
      theme: {} as Theme,
    });

    try {
      renderWithCopilotKit({
        agent,
        threadId,
        renderActivityMessages: [a2uiRenderer],
      });

      await waitFor(() => {
        expect(fetchMock).toHaveBeenCalledTimes(1);
      });

      await waitFor(() => {
        expect(mockPhoenixSockets).toHaveLength(1);
        expect(mockPhoenixSockets[0]?.channels).toHaveLength(1);
      });

      const channel = mockPhoenixSockets[0]!.channels[0]!;
      expect(channel.topic).toBe(`thread:${threadId}`);
      expect(channel.params).toEqual({
        stream_mode: "connect",
        last_seen_event_id: null,
      });

      channel.triggerJoin("ok");
      channel.serverPush("ag_ui_event", {
        type: EventType.RUN_STARTED,
        threadId,
        run_id: "backend-run-1",
        input: {
          messages: [
            {
              id: testId("connect-user-message"),
              role: "user",
              content: "show me the restored ui",
            },
          ],
        },
      });
      channel.serverPush("ag_ui_event", {
        type: EventType.ACTIVITY_SNAPSHOT,
        messageId: testId("connect-a2ui-activity"),
        activityType: "a2ui-surface",
        content: {
          a2ui_operations: [
            {
              version: "v0.9",
              createSurface: {
                surfaceId,
                catalogId:
                  "https://a2ui.org/specification/v0_9/basic_catalog.json",
              },
            },
            {
              version: "v0.9",
              updateComponents: {
                surfaceId,
                components: [
                  {
                    id: "root",
                    component: "Text",
                    text: "Restored dashboard",
                    variant: "body",
                  },
                ],
              },
            },
          ],
        },
      });
      channel.serverPush("ag_ui_event", {
        type: EventType.RUN_FINISHED,
      });
      channel.serverPush("stream_idle", { latestEventId: "event-3" });

      await waitFor(() => {
        expect(screen.getByText("show me the restored ui")).toBeDefined();
      });
      await waitFor(() => {
        expect(
          document.querySelector(`[data-surface-id='${surfaceId}']`),
        ).not.toBeNull();
      });

      const [url, options] = fetchMock.mock.calls[0] as [string, RequestInit];
      expect(url).toContain("/agent/my-agent/connect");
      expect(options.method).toBe("POST");

      const requestBody = JSON.parse(String(options.body)) as {
        threadId: string;
        lastSeenEventId: string | null;
        messages: unknown[];
      };
      expect(requestBody.threadId).toBe(threadId);
      expect(requestBody.lastSeenEventId).toBeNull();
      expect(requestBody.messages).toEqual([]);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("restores a completed Open Generative UI activity after reconnect from an event-native baseline", async () => {
    mockWebsandboxCreate.mockClear();
    mockWebsandboxDestroy.mockClear();

    const agent = new MockReconnectableAgent();
    const threadId = testId("open-generative-ui-thread");
    const restoredHtml =
      "<head></head><body><div>Restored open generative UI</div></body>";

    const renderOpenGenerativeUIChat = () =>
      render(
        <CopilotKitProvider
          agents__unsafe_dev_only={{ default: agent }}
          openGenerativeUI={{}}
        >
          <CopilotChatConfigurationProvider threadId={threadId}>
            <div style={{ height: 400 }}>
              <CopilotChat welcomeScreen={false} />
            </div>
          </CopilotChatConfigurationProvider>
        </CopilotKitProvider>,
      );

    const { unmount } = renderOpenGenerativeUIChat();

    const input = await screen.findByRole("textbox");
    fireEvent.change(input, { target: { value: "Show me the restored app" } });
    fireEvent.keyDown(input, { key: "Enter", code: "Enter" });

    await waitFor(() => {
      expect(screen.getByText("Show me the restored app")).toBeDefined();
    });

    agent.emit(runStartedEvent());
    agent.emit(
      activitySnapshotEvent({
        messageId: testId("open-generative-ui-activity"),
        activityType: "open-generative-ui",
        content: {
          initialHeight: 180,
          generating: false,
          html: [restoredHtml],
          htmlComplete: true,
        },
      }),
    );
    agent.emit(runFinishedEvent());
    agent.complete();

    await waitFor(() => {
      expect(mockWebsandboxCreate).toHaveBeenCalledTimes(1);
    });
    expect(mockWebsandboxCreate.mock.calls[0]?.[1]).toMatchObject({
      frameContent: restoredHtml,
    });

    unmount();

    agent.reset();

    renderOpenGenerativeUIChat();

    await waitFor(() => {
      expect(mockWebsandboxCreate).toHaveBeenCalledTimes(2);
    });
    expect(mockWebsandboxCreate.mock.calls[1]?.[1]).toMatchObject({
      frameContent: restoredHtml,
    });

    expect(mockWebsandboxDestroy).toHaveBeenCalledTimes(1);
  });
});
