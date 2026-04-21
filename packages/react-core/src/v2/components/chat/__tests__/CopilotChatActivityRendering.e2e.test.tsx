import React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { z } from "zod";
import {
  MockReconnectableAgent,
  MockStepwiseAgent,
  activitySnapshotEvent,
  renderWithCopilotKit,
  runFinishedEvent,
  runStartedEvent,
  testId,
} from "../../../__tests__/utils/test-helpers";
import { ReactActivityMessageRenderer } from "../../../types";
import {
  CopilotChatConfigurationProvider,
  CopilotKitProvider,
  useCopilotKit,
} from "../../../providers";
import { AbstractAgent } from "@ag-ui/client";
import { IntelligenceAgent } from "@copilotkit/core";
import { getThreadClone } from "../../../hooks/use-agent";
import { createA2UIMessageRenderer } from "../../../a2ui/A2UIMessageRenderer";
import type { Theme } from "@copilotkit/a2ui-renderer";
import { CopilotChat } from "..";

const { mockWebsandboxCreate, mockWebsandboxDestroy } = vi.hoisted(() => {
  const mockDestroy = vi.fn();
  const mockCreate = vi.fn(() => ({
    iframe: document.createElement("iframe"),
    promise: Promise.resolve(),
    run: vi.fn().mockResolvedValue(undefined),
    destroy: mockDestroy,
  }));

  return {
    mockWebsandboxCreate: mockCreate,
    mockWebsandboxDestroy: mockDestroy,
  };
});

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

  it("passes the per-thread clone (not the registry agent) to activity message renderers", async () => {
    // Regression test for: A2UI button clicks firing runAgent on the registry
    // agent instead of the per-thread clone that CopilotChat renders from.
    // Caused by useRenderActivityMessage calling copilotkit.getAgent() directly
    // instead of getThreadClone(registryAgent, threadId) ?? registryAgent.
    const agent = new MockStepwiseAgent();
    const agentId = "action-agent";
    agent.agentId = agentId;
    const threadId = "thread-for-action-test";

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
      agents: { [agentId]: agent },
      agentId,
      threadId,
      renderActivityMessages: [activityRenderer],
    });

    const input = await screen.findByRole("textbox");
    fireEvent.change(input, { target: { value: "show me buttons" } });
    fireEvent.keyDown(input, { key: "Enter", code: "Enter" });

    await waitFor(() => {
      expect(screen.getByText("show me buttons")).toBeDefined();
    });

    agent.emit(runStartedEvent());
    agent.emit(
      activitySnapshotEvent({
        messageId: testId("activity-action"),
        activityType: "button-action",
        content: { label: "Click Me" },
      }),
    );
    agent.emit(runFinishedEvent());

    await waitFor(() => {
      expect(screen.getByTestId("action-button")).toBeDefined();
    });

    // CopilotChat creates a per-thread clone via useAgent. The activity renderer
    // must receive that clone so that handleAction → runAgent targets the same
    // instance chat is rendering from.
    const clone = getThreadClone(agent, threadId);
    expect(clone).toBeDefined();
    expect(capturedAgent).toBe(clone);
    expect(capturedAgent).not.toBe(agent); // must NOT be the registry agent
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

  it("restores a completed A2UI surface from an IntelligenceAgent /connect bootstrap plan", async () => {
    const threadId = testId("intelligence-connect-thread");
    const surfaceId = testId("intelligence-connect-surface");
    const fetchMock = vi.fn().mockResolvedValueOnce(
      jsonResponse({
        mode: "bootstrap",
        latestEventId: "event-3",
        events: [
          {
            type: "RUN_STARTED",
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
          },
          {
            type: "ACTIVITY_SNAPSHOT",
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
          },
          {
            type: "RUN_FINISHED",
          },
        ],
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

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
