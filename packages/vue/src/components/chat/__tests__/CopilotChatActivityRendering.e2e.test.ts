import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/vue";
import { defineComponent, ref, toRaw } from "vue";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { AbstractAgent } from "@ag-ui/client";
import type { Theme } from "@copilotkit/a2ui-renderer";
import CopilotChat from "../CopilotChat.vue";
import CopilotKitProvider from "../../../providers/CopilotKitProvider.vue";
import CopilotChatConfigurationProvider from "../../../providers/CopilotChatConfigurationProvider.vue";
import { getThreadClone } from "../../../hooks/use-agent";
import { useCopilotKit } from "../../../providers/useCopilotKit";
import { createA2UIMessageRenderer } from "../../../components/A2UIMessageRenderer";
import {
  activitySnapshotEvent,
  MockReconnectableAgent,
  MockStepwiseAgent,
  renderWithCopilotKit,
  runFinishedEvent,
  runStartedEvent,
  testId,
} from "../../../__tests__/utils/test-helpers";

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

async function submitMessageAndWaitForUserMessage(value: string) {
  await waitFor(() => {
    expect(screen.queryByTestId("copilot-chat-cursor")).toBeNull();
  });

  const input = await screen.findByRole("textbox");
  await fireEvent.update(input, value);
  await fireEvent.keyDown(input, { key: "Enter", code: "Enter" });

  await waitFor(() => {
    expect(screen.getByText(value)).toBeDefined();
  });
}

const CopilotkitProbe = defineComponent({
  setup() {
    const { copilotkit } = useCopilotKit();
    return { copilotkit };
  },
  template: `
    <div data-testid="copilotkit-probe">
      {{ String(!!copilotkit) }}
    </div>
  `,
});

afterEach(() => {
  cleanup();
});

describe("CopilotChat activity message rendering", () => {
  it("renders custom components for activity snapshots", async () => {
    const agent = new MockStepwiseAgent();
    const agentId = "search-agent";
    agent.agentId = agentId;

    const Host = defineComponent({
      components: { CopilotChat },
      template: `
        <CopilotChat :welcome-screen="false">
          <template #activity-search-progress="{ content, agent }">
            <div data-testid="activity-card">
              {{ String(content?.status ?? "") }} · {{ String(content?.percent ?? "") }}% · {{ String(agent?.agentId ?? "") }}
            </div>
          </template>
        </CopilotChat>
      `,
    });

    renderWithCopilotKit({
      agent,
      agentId,
      children: Host,
    });

    await submitMessageAndWaitForUserMessage("Start search");

    await agent.emit(runStartedEvent());
    await agent.emit(
      activitySnapshotEvent({
        messageId: testId("activity"),
        activityType: "search-progress",
        content: { status: "Fetching", percent: 30 },
      }),
    );
    await agent.emit(runFinishedEvent());
    await waitFor(() => {
      const textContent = screen.getByTestId("activity-card").textContent ?? "";
      expect(textContent).toContain("Fetching");
      expect(textContent).toContain(agentId);
    });
  });

  it("skips unmatched activity types when no renderer exists", async () => {
    const agent = new MockStepwiseAgent();
    renderWithCopilotKit({ agent });

    await submitMessageAndWaitForUserMessage("Start search");

    await agent.emit(runStartedEvent());
    await agent.emit(
      activitySnapshotEvent({
        messageId: testId("activity-unmatched"),
        activityType: "unknown",
        content: { note: "no-op" },
      }),
    );
    await agent.emit(runFinishedEvent());

    await waitFor(() => {
      expect(screen.queryByTestId("activity-card")).toBeNull();
    });
  });

  it("useCopilotKit provides valid copilotkit instance inside activity message renderer", async () => {
    const agent = new MockStepwiseAgent();
    const agentId = "test-agent";
    agent.agentId = agentId;

    const Host = defineComponent({
      components: { CopilotChat, CopilotkitProbe },
      template: `
        <CopilotChat :welcome-screen="false">
          <template #activity-test-activity="{ content }">
            <div data-testid="activity-render">
              {{ String(content?.message ?? "") }}
              <CopilotkitProbe />
            </div>
          </template>
        </CopilotChat>
      `,
    });

    renderWithCopilotKit({
      agent,
      agentId,
      children: Host,
    });

    await submitMessageAndWaitForUserMessage("Test message");

    await agent.emit(runStartedEvent());
    await agent.emit(
      activitySnapshotEvent({
        messageId: testId("activity"),
        activityType: "test-activity",
        content: { message: "Rendered content" },
      }),
    );
    await agent.emit(runFinishedEvent());

    await waitFor(() => {
      expect(screen.getByTestId("activity-render")).toBeDefined();
    });

    expect(screen.getByTestId("copilotkit-probe").textContent).toBe("true");
  });

  it("passes the per-thread clone (not the registry agent) to activity message renderers", async () => {
    const agent = new MockStepwiseAgent();
    const agentId = "action-agent";
    agent.agentId = agentId;
    const threadId = "thread-for-action-test";
    const capturedAgent = ref<AbstractAgent | undefined>();

    const Host = defineComponent({
      components: { CopilotChat },
      setup() {
        const captureAgent = (nextAgent: AbstractAgent | undefined) => {
          capturedAgent.value = nextAgent;
          return "";
        };
        return {
          captureAgent,
        };
      },
      template: `
        <CopilotChat :welcome-screen="false">
          <template #activity-button-action="{ content, agent }">
            <button data-testid="action-button">
              {{ String(content?.label ?? "") }}{{ captureAgent(agent) }}
            </button>
          </template>
        </CopilotChat>
      `,
    });

    renderWithCopilotKit({
      agent,
      agentId,
      threadId,
      children: Host,
    });

    await submitMessageAndWaitForUserMessage("show me buttons");

    await agent.emit(runStartedEvent());
    await agent.emit(
      activitySnapshotEvent({
        messageId: testId("activity-action"),
        activityType: "button-action",
        content: { label: "Click Me" },
      }),
    );
    await agent.emit(runFinishedEvent());

    await waitFor(() => {
      expect(screen.getByTestId("action-button")).toBeDefined();
    });

    const clone = getThreadClone(agent, threadId);
    expect(clone).toBeDefined();
    expect(toRaw(capturedAgent.value!)).toBe(clone);
    expect(toRaw(capturedAgent.value!)).not.toBe(agent);
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

    await submitMessageAndWaitForUserMessage("Show me the restored UI");

    await agent.emit(runStartedEvent());
    await agent.emit(
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
    await agent.emit(runFinishedEvent());
    await agent.complete();

    await waitFor(
      () => {
        expect(
          document.querySelector(`[data-surface-id='${surfaceId}']`),
        ).not.toBeNull();
      },
      { timeout: 5000 },
    );

    unmount();
    agent.reset();

    renderWithCopilotKit({
      agent,
      threadId,
      renderActivityMessages: [a2uiRenderer],
    });

    await waitFor(
      () => {
        expect(
          document.querySelector(`[data-surface-id='${surfaceId}']`),
        ).not.toBeNull();
      },
      { timeout: 5000 },
    );
  });

  // The IntelligenceAgent /connect gateway-replay variant is pending N3
  // (requires porting React's mockPhoenixSockets infrastructure).

  it("restores a completed Open Generative UI activity after reconnect from an event-native baseline", async () => {
    mockWebsandboxCreate.mockClear();
    mockWebsandboxDestroy.mockClear();

    const agent = new MockReconnectableAgent();
    const threadId = testId("open-generative-ui-thread");
    const restoredHtml =
      "<head></head><body><div>Restored open generative UI</div></body>";

    const renderOpenGenerativeUIChat = () => {
      const Host = defineComponent({
        components: {
          CopilotKitProvider,
          CopilotChatConfigurationProvider,
          CopilotChat,
        },
        setup() {
          return {
            agents: { default: agent },
            openGenerativeUI: {},
            threadId,
          };
        },
        template: `
          <CopilotKitProvider
            :agents__unsafe_dev_only="agents"
            :open-generative-u-i="openGenerativeUI"
          >
            <CopilotChatConfigurationProvider :thread-id="threadId">
              <div style="height: 400px;">
                <CopilotChat :welcome-screen="false" />
              </div>
            </CopilotChatConfigurationProvider>
          </CopilotKitProvider>
        `,
      });
      return render(Host);
    };

    const { unmount } = renderOpenGenerativeUIChat();

    await submitMessageAndWaitForUserMessage("Show me the restored app");

    await agent.emit(runStartedEvent());
    await agent.emit(
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
    await agent.emit(runFinishedEvent());
    await agent.complete();

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
