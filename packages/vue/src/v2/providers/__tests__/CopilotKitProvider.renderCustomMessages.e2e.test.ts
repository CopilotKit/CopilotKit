import { computed, defineComponent } from "vue";
import type { PropType } from "vue";
import { screen, fireEvent, waitFor, cleanup } from "@testing-library/vue";
import { afterEach, describe, expect, it } from "vitest";
import type { Message } from "@ag-ui/core";
import CopilotChat from "../../components/chat/CopilotChat.vue";
import {
  MockStepwiseAgent,
  renderWithCopilotKit,
  runStartedEvent,
  runFinishedEvent,
  stateSnapshotEvent,
  testId,
  textMessageContentEvent,
  textMessageEndEvent,
  textMessageStartEvent,
} from "../../__tests__/utils/test-helpers";
import { useCopilotKit } from "../useCopilotKit";
import { useCopilotChatConfiguration } from "../useCopilotChatConfiguration";
import { useAgent } from "../../hooks/use-agent";
import type { VueCustomMessageRendererProps } from "../../types";

afterEach(() => {
  cleanup();
});

const rendererProps = {
  message: { type: Object as PropType<Message>, required: true },
  position: {
    type: String as PropType<VueCustomMessageRendererProps["position"]>,
    required: true,
  },
  runId: { type: String, required: true },
  messageIndex: { type: Number, required: true },
  messageIndexInRun: { type: Number, required: true },
  numberOfMessagesInRun: { type: Number, required: true },
  agentId: { type: String, required: true },
  stateSnapshot: {
    type: null as unknown as PropType<unknown>,
    required: false,
  },
} as const;

const SnapshotRenderer = defineComponent({
  name: "SnapshotRenderer",
  props: rendererProps,
  setup(props) {
    const { copilotkit } = useCopilotKit();
    const config = useCopilotChatConfiguration();

    const count = computed(() => {
      const typedSnapshot = props.stateSnapshot as
        | { history?: number[] }
        | undefined;
      const runHistory = typedSnapshot?.history ?? [];

      if (!config.value) {
        return runHistory[runHistory.length - 1];
      }

      const runIds = copilotkit.value.getRunIdsForThread(
        config.value.agentId,
        config.value.threadId,
      );
      const runIndex = runIds.indexOf(props.runId);
      if (runIndex >= 0 && runIndex < runHistory.length) {
        return runHistory[runIndex];
      }
      return runHistory[runHistory.length - 1];
    });

    return { count };
  },
  template: `
    <div
      v-if="position === 'after' && message.role === 'assistant'"
      :data-testid="'state-' + message.id"
      :data-run-id="runId"
    >
      State: {{ count ?? "null" }}
    </div>
  `,
});

const LiveStateRenderer = defineComponent({
  name: "LiveStateRenderer",
  props: rendererProps,
  setup(props) {
    const { agent } = useAgent();
    const currentStep = () => {
      const typedState = agent.value?.state as
        | { current_step?: string }
        | undefined;
      return typedState?.current_step;
    };

    return { currentStep };
  },
  template: `
    <div
      v-if="position === 'after' && messageIndexInRun === 0 && currentStep()"
      data-testid="live-step"
    >
      {{ currentStep() }}
    </div>
  `,
});

async function submitMessage(text: string) {
  const input = await screen.findByRole("textbox");
  await fireEvent.update(input, text);
  await fireEvent.keyDown(input, { key: "Enter", code: "Enter" });
  await waitFor(() => {
    expect(screen.getByText(text)).toBeDefined();
  });
}

describe("CopilotKitProvider custom message renderers E2E", () => {
  it("renders state snapshots before assistant text starts", async () => {
    const agent = new MockStepwiseAgent();

    renderWithCopilotKit({
      agent,
      renderCustomMessages: [{ render: LiveStateRenderer }],
    });

    await submitMessage("Who am I?");

    await agent.emit(runStartedEvent());
    await agent.emit(stateSnapshotEvent({ current_step: "Processing..." }));

    await waitFor(() => {
      expect(screen.getByTestId("live-step").textContent).toContain(
        "Processing...",
      );
    });
  });

  it("renders stored state snapshots for sequential runs", async () => {
    const agent = new MockStepwiseAgent();
    const history: number[] = [];

    const emitSnapshot = async (count: number) => {
      history.push(count);
      await agent.emit(stateSnapshotEvent({ history: [...history] }));
    };

    renderWithCopilotKit({
      agent,
      renderCustomMessages: [{ render: SnapshotRenderer }],
    });

    const firstAssistantId = testId("assistant-message");
    await submitMessage("First question");

    await agent.emit(runStartedEvent());
    await emitSnapshot(1);
    await agent.emit(textMessageStartEvent(firstAssistantId));
    await agent.emit(textMessageContentEvent(firstAssistantId, "First answer"));
    await agent.emit(textMessageEndEvent(firstAssistantId));
    await agent.emit(runFinishedEvent());

    await waitFor(() => {
      expect(
        screen.getByTestId(`state-${firstAssistantId}`).textContent,
      ).toContain("State: 1");
    });
    const firstRunId = screen
      .getByTestId(`state-${firstAssistantId}`)
      .getAttribute("data-run-id");
    expect(firstRunId).toBeTruthy();

    const secondAssistantId = testId("assistant-message");
    await submitMessage("Second question");

    await agent.emit(runStartedEvent());
    await emitSnapshot(2);
    await agent.emit(textMessageStartEvent(secondAssistantId));
    await agent.emit(
      textMessageContentEvent(secondAssistantId, "Second answer"),
    );
    await agent.emit(textMessageEndEvent(secondAssistantId));
    await agent.emit(runFinishedEvent());
    agent.complete();

    await waitFor(() => {
      expect(
        screen.getByTestId(`state-${secondAssistantId}`).textContent,
      ).toContain("State: 2");
    });
    const secondRunId = screen
      .getByTestId(`state-${secondAssistantId}`)
      .getAttribute("data-run-id");

    expect(secondRunId).not.toBe(firstRunId);

    const firstRunIdAfterSecond = screen
      .getByTestId(`state-${firstAssistantId}`)
      .getAttribute("data-run-id");
    expect(firstRunIdAfterSecond).toBe(firstRunId);

    expect(
      screen.getByTestId(`state-${firstAssistantId}`).textContent,
    ).toContain("State: 1");
  });

  it("renders only at specified position (before vs after)", async () => {
    const agent = new MockStepwiseAgent();
    const positions: string[] = [];

    const PositionRenderer = defineComponent({
      name: "PositionRenderer",
      props: rendererProps,
      setup(props) {
        positions.push(props.position);
        return {};
      },
      template: `
        <div :data-testid="position + '-' + message.id">
          {{ position }}: {{ message.role }}
        </div>
      `,
    });

    renderWithCopilotKit({
      agent,
      renderCustomMessages: [{ render: PositionRenderer }],
    });

    const messageId = testId("message");
    await submitMessage("Test");

    await agent.emit(runStartedEvent());
    await agent.emit(textMessageStartEvent(messageId));
    await agent.emit(textMessageContentEvent(messageId, "Response"));
    await agent.emit(textMessageEndEvent(messageId));
    await agent.emit(runFinishedEvent());

    await waitFor(() => {
      expect(screen.getByTestId(`before-${messageId}`)).toBeDefined();
      expect(screen.getByTestId(`after-${messageId}`)).toBeDefined();
    });

    expect(screen.getByTestId(`before-${messageId}`).textContent).toBe(
      "before: assistant",
    );
    expect(screen.getByTestId(`after-${messageId}`).textContent).toBe(
      "after: assistant",
    );

    expect(positions).toContain("before");
    expect(positions).toContain("after");
  });

  it("filters by message role correctly", async () => {
    const agent = new MockStepwiseAgent();
    const assistantId = testId("assistant");

    const AssistantOnlyRenderer = defineComponent({
      name: "AssistantOnlyRenderer",
      props: rendererProps,
      template: `
        <div
          v-if="message.role === 'assistant' && position === 'after'"
          :data-testid="'assistant-badge-' + message.id"
        >
          AI Response
        </div>
      `,
    });

    renderWithCopilotKit({
      agent,
      renderCustomMessages: [{ render: AssistantOnlyRenderer }],
    });

    await submitMessage("User message");

    const userMessages = screen.queryAllByTestId(/^assistant-badge-/);
    expect(userMessages.length).toBe(0);

    await agent.emit(runStartedEvent());
    await agent.emit(textMessageStartEvent(assistantId));
    await agent.emit(textMessageContentEvent(assistantId, "AI response"));
    await agent.emit(textMessageEndEvent(assistantId));
    await agent.emit(runFinishedEvent());

    await waitFor(() => {
      expect(
        screen.getByTestId(`assistant-badge-${assistantId}`),
      ).toBeDefined();
    });
  });

  it("executes multiple renderers in order", async () => {
    const agent = new MockStepwiseAgent();
    const executionOrder: string[] = [];

    const FirstRenderer = defineComponent({
      name: "FirstRenderer",
      props: rendererProps,
      setup(props) {
        if (props.position === "after" && props.message.role === "assistant") {
          executionOrder.push("first");
        }
        return {};
      },
      template: `
        <div
          v-if="position === 'after' && message.role === 'assistant'"
          :data-testid="'first-' + message.id"
        >
          First
        </div>
      `,
    });

    const SecondRenderer = defineComponent({
      name: "SecondRenderer",
      props: rendererProps,
      setup(props) {
        if (props.position === "after" && props.message.role === "assistant") {
          executionOrder.push("second");
        }
        return {};
      },
      template: `
        <div
          v-if="position === 'after' && message.role === 'assistant'"
          :data-testid="'second-' + message.id"
        >
          Second
        </div>
      `,
    });

    renderWithCopilotKit({
      agent,
      renderCustomMessages: [
        { render: FirstRenderer },
        { render: SecondRenderer },
      ],
    });

    const messageId = testId("message");
    await submitMessage("Test");

    await agent.emit(runStartedEvent());
    await agent.emit(textMessageStartEvent(messageId));
    await agent.emit(textMessageContentEvent(messageId, "Response"));
    await agent.emit(textMessageEndEvent(messageId));
    await agent.emit(runFinishedEvent());

    await waitFor(() => {
      expect(screen.getByTestId(`first-${messageId}`)).toBeDefined();
    });

    expect(executionOrder).toEqual(["first"]);
    expect(screen.queryByTestId(`second-${messageId}`)).toBeNull();
  });

  it("respects agent-scoped renderers", async () => {
    const agent1 = new MockStepwiseAgent();
    const agent2 = new MockStepwiseAgent();

    const Agent1Renderer = defineComponent({
      name: "Agent1Renderer",
      props: rendererProps,
      template: `
        <div
          v-if="position === 'after' && message.role === 'assistant'"
          :data-testid="'agent1-badge-' + message.id"
        >
          Agent 1
        </div>
      `,
    });

    const Agent2Renderer = defineComponent({
      name: "Agent2Renderer",
      props: rendererProps,
      template: `
        <div
          v-if="position === 'after' && message.role === 'assistant'"
          :data-testid="'agent2-badge-' + message.id"
        >
          Agent 2
        </div>
      `,
    });

    renderWithCopilotKit({
      agents: { agent1, agent2 },
      agentId: "agent1",
      renderCustomMessages: [
        { agentId: "agent1", render: Agent1Renderer },
        { agentId: "agent2", render: Agent2Renderer },
      ],
    });

    const messageId = testId("message");
    await submitMessage("Test");

    await agent1.emit(runStartedEvent());
    await agent1.emit(textMessageStartEvent(messageId));
    await agent1.emit(textMessageContentEvent(messageId, "Response"));
    await agent1.emit(textMessageEndEvent(messageId));
    await agent1.emit(runFinishedEvent());

    await waitFor(() => {
      expect(screen.getByTestId(`agent1-badge-${messageId}`)).toBeDefined();
    });

    expect(screen.queryByTestId(`agent2-badge-${messageId}`)).toBeNull();
  });

  it("prioritizes agent-specific renderers over global renderers", async () => {
    const agent = new MockStepwiseAgent();

    const GlobalRenderer = defineComponent({
      name: "GlobalRenderer",
      props: rendererProps,
      template: `
        <div
          v-if="position === 'after' && message.role === 'assistant'"
          :data-testid="'global-' + message.id"
        >
          Global
        </div>
      `,
    });

    const SpecificRenderer = defineComponent({
      name: "SpecificRenderer",
      props: rendererProps,
      template: `
        <div
          v-if="position === 'after' && message.role === 'assistant'"
          :data-testid="'specific-' + message.id"
        >
          Specific
        </div>
      `,
    });

    const agentId = "specific-agent";

    renderWithCopilotKit({
      agents: { [agentId]: agent },
      agentId,
      renderCustomMessages: [
        { render: GlobalRenderer },
        { agentId, render: SpecificRenderer },
      ],
    });

    const messageId = testId("message");
    await submitMessage("Test");

    await agent.emit(runStartedEvent());
    await agent.emit(textMessageStartEvent(messageId));
    await agent.emit(textMessageContentEvent(messageId, "Response"));
    await agent.emit(textMessageEndEvent(messageId));
    await agent.emit(runFinishedEvent());

    await waitFor(() => {
      expect(screen.getByTestId(`specific-${messageId}`)).toBeDefined();
    });

    expect(screen.queryByTestId(`global-${messageId}`)).toBeNull();
  });

  it("handles missing state snapshots gracefully", async () => {
    const agent = new MockStepwiseAgent();

    const StateRenderer = defineComponent({
      name: "StateRenderer",
      props: rendererProps,
      setup(props) {
        const text = computed(() =>
          props.stateSnapshot
            ? JSON.stringify(props.stateSnapshot)
            : "no-state",
        );
        return { text };
      },
      template: `
        <div
          v-if="position === 'after' && message.role === 'assistant'"
          :data-testid="'state-' + message.id"
        >
          {{ text }}
        </div>
      `,
    });

    renderWithCopilotKit({
      agent,
      renderCustomMessages: [{ render: StateRenderer }],
    });

    const messageId = testId("message");
    await submitMessage("Test");

    await agent.emit(runStartedEvent());
    await agent.emit(textMessageStartEvent(messageId));
    await agent.emit(textMessageContentEvent(messageId, "Response"));
    await agent.emit(textMessageEndEvent(messageId));
    await agent.emit(runFinishedEvent());

    await waitFor(() => {
      expect(screen.getByTestId(`state-${messageId}`).textContent).toBe(
        "no-state",
      );
    });
  });

  it("provides correct message index properties", async () => {
    const agent = new MockStepwiseAgent();
    let capturedProps: {
      messageIndex?: number;
      messageIndexInRun?: number;
      numberOfMessagesInRun?: number;
    } | null = null;

    const IndexRenderer = defineComponent({
      name: "IndexRenderer",
      props: rendererProps,
      setup(props) {
        capturedProps = {
          messageIndex: props.messageIndex,
          messageIndexInRun: props.messageIndexInRun,
          numberOfMessagesInRun: props.numberOfMessagesInRun,
        };
        return {};
      },
      template: `
        <div
          v-if="position === 'after' && message.role === 'assistant'"
          :data-testid="'index-' + message.id"
        >
          {{ messageIndex }}/{{ messageIndexInRun }}/{{ numberOfMessagesInRun }}
        </div>
      `,
    });

    renderWithCopilotKit({
      agent,
      renderCustomMessages: [{ render: IndexRenderer }],
    });

    const msg1 = testId("msg1");
    const msg2 = testId("msg2");

    await submitMessage("First");

    await agent.emit(runStartedEvent());
    await agent.emit(textMessageStartEvent(msg1));
    await agent.emit(textMessageContentEvent(msg1, "Response 1"));
    await agent.emit(textMessageEndEvent(msg1));
    await agent.emit(runFinishedEvent());

    await waitFor(() => {
      expect(screen.getByTestId(`index-${msg1}`)).toBeDefined();
    });

    await submitMessage("Second");

    await agent.emit(runStartedEvent());
    await agent.emit(textMessageStartEvent(msg2));
    await agent.emit(textMessageContentEvent(msg2, "Response 2"));
    await agent.emit(textMessageEndEvent(msg2));
    await agent.emit(runFinishedEvent());

    await waitFor(() => {
      expect(screen.getByTestId(`index-${msg2}`)).toBeDefined();
    });

    expect(capturedProps).toBeTruthy();
    if (!capturedProps) {
      throw new Error("Expected capturedProps to be set");
    }
    expect(typeof capturedProps.messageIndex).toBe("number");
    expect(typeof capturedProps.messageIndexInRun).toBe("number");
    expect(typeof capturedProps.numberOfMessagesInRun).toBe("number");
  });

  it("works across multi-turn conversations", async () => {
    const agent = new MockStepwiseAgent();

    const TurnCounter = defineComponent({
      name: "TurnCounter",
      props: rendererProps,
      setup(props) {
        const turn = computed(() => {
          const snapshot = props.stateSnapshot as { turn?: number } | undefined;
          return snapshot?.turn ?? 0;
        });
        return { turn };
      },
      template: `
        <div
          v-if="position === 'after' && message.role === 'assistant'"
          :data-testid="'turn-' + message.id"
        >Turn: {{ turn }}</div>
      `,
    });

    renderWithCopilotKit({
      agent,
      renderCustomMessages: [{ render: TurnCounter }],
    });

    const msg1 = testId("msg1");
    await submitMessage("Turn 1");

    await agent.emit(runStartedEvent());
    await agent.emit(stateSnapshotEvent({ turn: 1 }));
    await agent.emit(textMessageStartEvent(msg1));
    await agent.emit(textMessageContentEvent(msg1, "Response 1"));
    await agent.emit(textMessageEndEvent(msg1));
    await agent.emit(runFinishedEvent());

    await waitFor(() => {
      expect(screen.getByTestId(`turn-${msg1}`).textContent).toBe("Turn: 1");
    });

    const msg2 = testId("msg2");
    await submitMessage("Turn 2");

    await agent.emit(runStartedEvent());
    await agent.emit(stateSnapshotEvent({ turn: 2 }));
    await agent.emit(textMessageStartEvent(msg2));
    await agent.emit(textMessageContentEvent(msg2, "Response 2"));
    await agent.emit(textMessageEndEvent(msg2));
    await agent.emit(runFinishedEvent());

    await waitFor(() => {
      expect(screen.getByTestId(`turn-${msg2}`).textContent).toBe("Turn: 2");
    });

    const msg3 = testId("msg3");
    await submitMessage("Turn 3");

    await agent.emit(runStartedEvent());
    await agent.emit(stateSnapshotEvent({ turn: 3 }));
    await agent.emit(textMessageStartEvent(msg3));
    await agent.emit(textMessageContentEvent(msg3, "Response 3"));
    await agent.emit(textMessageEndEvent(msg3));
    await agent.emit(runFinishedEvent());

    await waitFor(() => {
      expect(screen.getByTestId(`turn-${msg3}`).textContent).toBe("Turn: 3");
    });

    expect(screen.getByTestId(`turn-${msg1}`)).toBeDefined();
    expect(screen.getByTestId(`turn-${msg2}`)).toBeDefined();
    expect(screen.getByTestId(`turn-${msg3}`)).toBeDefined();
  });

  it("handles renderers returning null without breaking", async () => {
    const agent = new MockStepwiseAgent();

    const NullRenderer = defineComponent({
      name: "NullRenderer",
      props: rendererProps,
      template: `<div v-if="false" />`,
    });

    const FallbackRenderer = defineComponent({
      name: "FallbackRenderer",
      props: rendererProps,
      template: `
        <div
          v-if="position === 'after' && message.role === 'assistant'"
          :data-testid="'fallback-' + message.id"
        >
          Fallback
        </div>
      `,
    });

    renderWithCopilotKit({
      agent,
      renderCustomMessages: [
        { render: NullRenderer },
        { render: FallbackRenderer },
      ],
    });

    const messageId = testId("message");
    await submitMessage("Test");

    await agent.emit(runStartedEvent());
    await agent.emit(textMessageStartEvent(messageId));
    await agent.emit(textMessageContentEvent(messageId, "Response"));
    await agent.emit(textMessageEndEvent(messageId));
    await agent.emit(runFinishedEvent());

    await waitFor(() => {
      const fallback = screen.queryByTestId(`fallback-${messageId}`);
      expect(fallback).toBeNull();
    });
  });

  it("re-renders custom message when state updates within the same run", async () => {
    const agent = new MockStepwiseAgent();

    const StateCountRenderer = defineComponent({
      name: "StateCountRenderer",
      props: rendererProps,
      setup(props) {
        const count = computed(() => {
          const snapshot = props.stateSnapshot as
            | { count?: number }
            | undefined;
          return snapshot?.count ?? "none";
        });
        return { count };
      },
      template: `
        <div
          v-if="position === 'after' && message.role === 'assistant'"
          :data-testid="'count-' + message.id"
        >Count: {{ count }}</div>
      `,
    });

    renderWithCopilotKit({
      agent,
      renderCustomMessages: [{ render: StateCountRenderer }],
    });

    const messageId = testId("message");
    await submitMessage("Test");

    await agent.emit(runStartedEvent());
    await agent.emit(textMessageStartEvent(messageId));
    await agent.emit(textMessageContentEvent(messageId, "Response"));
    await agent.emit(textMessageEndEvent(messageId));

    await agent.emit(stateSnapshotEvent({ count: 1 }));

    await waitFor(() => {
      expect(screen.getByTestId(`count-${messageId}`).textContent).toBe(
        "Count: 1",
      );
    });

    await agent.emit(stateSnapshotEvent({ count: 2 }));

    await waitFor(() => {
      expect(screen.getByTestId(`count-${messageId}`).textContent).toBe(
        "Count: 2",
      );
    });

    await agent.emit(runFinishedEvent());
  });

  it("receives state snapshots from different runs", async () => {
    const agent = new MockStepwiseAgent();
    const receivedSnapshots: Array<{ messageId: string; count: number }> = [];

    const CounterRenderer = defineComponent({
      name: "CounterRenderer",
      props: rendererProps,
      setup(props) {
        if (props.position !== "after" || props.message.role !== "assistant") {
          return { count: computed(() => 0) };
        }

        const count = computed(() => {
          const snapshot = props.stateSnapshot as
            | { count?: number }
            | undefined;
          return snapshot?.count ?? 0;
        });

        const existing = receivedSnapshots.find(
          (snapshot) => snapshot.messageId === props.message.id,
        );
        if (!existing) {
          receivedSnapshots.push({
            messageId: props.message.id,
            count: Number(count.value),
          });
        }

        return { count };
      },
      template: `
        <div
          v-if="position === 'after' && message.role === 'assistant'"
          :data-testid="'count-' + message.id"
        >
          Count: {{ count }}
        </div>
      `,
    });

    renderWithCopilotKit({
      agent,
      renderCustomMessages: [{ render: CounterRenderer }],
    });

    const msg1 = testId("msg1");
    await submitMessage("First");

    await agent.emit(runStartedEvent());
    await agent.emit(stateSnapshotEvent({ count: 5 }));
    await agent.emit(textMessageStartEvent(msg1));
    await agent.emit(textMessageContentEvent(msg1, "Response"));
    await agent.emit(textMessageEndEvent(msg1));
    await agent.emit(runFinishedEvent());

    await waitFor(() => {
      expect(screen.getByTestId(`count-${msg1}`)).toBeDefined();
    });

    const msg2 = testId("msg2");
    await submitMessage("Second");

    await agent.emit(runStartedEvent());
    await agent.emit(stateSnapshotEvent({ count: 10 }));
    await agent.emit(textMessageStartEvent(msg2));
    await agent.emit(textMessageContentEvent(msg2, "Response 2"));
    await agent.emit(textMessageEndEvent(msg2));
    await agent.emit(runFinishedEvent());

    await waitFor(() => {
      expect(screen.getByTestId(`count-${msg2}`)).toBeDefined();
    });

    expect(receivedSnapshots.length).toBe(2);
    expect(
      receivedSnapshots.some((snapshot) => snapshot.messageId === msg1),
    ).toBe(true);
    expect(
      receivedSnapshots.some((snapshot) => snapshot.messageId === msg2),
    ).toBe(true);
  });
});

describe("Vue-specific semantics", () => {
  it("local message-after slot overrides provider renderCustomMessages for the same position", async () => {
    const agent = new MockStepwiseAgent();
    const messageId = testId("message");

    const ProviderRenderer = defineComponent({
      name: "ProviderRenderer",
      props: rendererProps,
      template: `
        <div
          v-if="position === 'after' && message.role === 'assistant'"
          :data-testid="'provider-' + message.id"
        >
          Provider
        </div>
      `,
    });

    const Host = defineComponent({
      components: { CopilotChat },
      template: `
        <div style="height: 400px;">
          <CopilotChat :welcome-screen="false">
            <template #message-after="{ message, position }">
              <div
                v-if="position === 'after' && message.role === 'assistant'"
                :data-testid="'slot-' + message.id"
              >
                Slot
              </div>
            </template>
          </CopilotChat>
        </div>
      `,
    });

    renderWithCopilotKit({
      agent,
      renderCustomMessages: [{ render: ProviderRenderer }],
      children: Host,
    });

    await submitMessage("Test");

    await agent.emit(runStartedEvent());
    await agent.emit(textMessageStartEvent(messageId));
    await agent.emit(textMessageContentEvent(messageId, "Response"));
    await agent.emit(textMessageEndEvent(messageId));
    await agent.emit(runFinishedEvent());

    await waitFor(() => {
      expect(screen.getByTestId(`slot-${messageId}`)).toBeDefined();
    });

    expect(screen.queryByTestId(`provider-${messageId}`)).toBeNull();
  });
});
