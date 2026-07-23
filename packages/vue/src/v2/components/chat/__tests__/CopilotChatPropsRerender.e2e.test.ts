import { screen, fireEvent, waitFor } from "@testing-library/vue";
import { defineComponent, nextTick, onMounted, onUpdated, ref } from "vue";
import type { PropType } from "vue";
import type { Message } from "@ag-ui/core";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import CopilotChat from "../CopilotChat.vue";
import { useCopilotChatConfiguration } from "../../../providers/useCopilotChatConfiguration";
import {
  MockStepwiseAgent,
  renderWithCopilotKit,
  runFinishedEvent,
  runStartedEvent,
  textChunkEvent,
} from "../../../__tests__/utils/test-helpers";

let assistantRenderCount = 0;
let labelConsumerRenderCount = 0;

const CountingAssistantMessage = defineComponent({
  props: {
    message: {
      type: Object as PropType<Message>,
      required: true,
    },
  },
  setup() {
    const trackRender = () => {
      assistantRenderCount += 1;
    };
    onMounted(trackRender);
    onUpdated(trackRender);
    return {};
  },
  template: `<div data-testid="counting-assistant" />`,
});

const LabelConsumerAssistantMessage = defineComponent({
  props: {
    message: {
      type: Object as PropType<Message>,
      required: true,
    },
  },
  setup() {
    useCopilotChatConfiguration();
    const trackRender = () => {
      labelConsumerRenderCount += 1;
    };
    onMounted(trackRender);
    onUpdated(trackRender);
    return {};
  },
  template: `<div data-testid="counting-assistant" />`,
});

function createChatHost(options: { withInlineLabels: boolean }) {
  const { withInlineLabels } = options;
  return defineComponent({
    components: {
      CopilotChat,
      CountingAssistantMessage,
      LabelConsumerAssistantMessage,
    },
    setup() {
      const mirroredInput = ref("");
      const handleInputChange = (value: string) => {
        // Force parent re-renders on keystrokes so inline slot/labels references
        // churn exactly like the React inline-object regression scenario.
        mirroredInput.value = value;
      };
      return { mirroredInput, handleInputChange };
    },
    template: withInlineLabels
      ? `
        <div>
          <CopilotChat
            :welcome-screen="false"
            :labels="{ chatInputPlaceholder: 'Type here...' }"
            @input-change="handleInputChange"
          >
            <template #assistant-message="slotProps">
              <LabelConsumerAssistantMessage v-bind="slotProps" />
            </template>
          </CopilotChat>
          <div data-testid="input-mirror">{{ mirroredInput }}</div>
        </div>
      `
      : `
        <div>
          <CopilotChat
            :welcome-screen="false"
            @input-change="handleInputChange"
          >
            <template #assistant-message="slotProps">
              <CountingAssistantMessage v-bind="slotProps" />
            </template>
          </CopilotChat>
          <div data-testid="input-mirror">{{ mirroredInput }}</div>
        </div>
      `,
  });
}

async function flushVueUpdates() {
  await nextTick();
  await new Promise((resolve) => setTimeout(resolve, 0));
  await nextTick();
}

async function submitAndReceiveAssistantMessage(
  agent: MockStepwiseAgent,
  messageId: string,
) {
  const input = await screen.findByRole("textbox");
  await fireEvent.update(input, "hello");
  await fireEvent.keyDown(input, { key: "Enter", code: "Enter" });

  await waitFor(() => {
    expect(screen.getByText("hello")).toBeDefined();
  });

  await agent.emit(runStartedEvent());
  await agent.emit(textChunkEvent(messageId, "assistant reply"));
  await agent.emit(runFinishedEvent());

  await waitFor(() => {
    expect(screen.getByTestId("counting-assistant")).toBeDefined();
  });

  await agent.complete();
  await flushVueUpdates();
}

describe("FOR-75: messageView / labels props — no re-renders on input change", () => {
  beforeEach(() => {
    assistantRenderCount = 0;
    labelConsumerRenderCount = 0;
  });

  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("messageView inline object: completed messages do not re-render on keystroke", async () => {
    const agent = new MockStepwiseAgent();
    const Host = createChatHost({ withInlineLabels: false });
    renderWithCopilotKit({ agent, children: Host });

    await submitAndReceiveAssistantMessage(agent, "msg-rerender-1");

    const renderCountAfterMessage = assistantRenderCount;
    expect(renderCountAfterMessage).toBeGreaterThan(0);

    const input = screen.getByRole("textbox");
    await fireEvent.update(input, "a");
    await fireEvent.update(input, "ab");
    await fireEvent.update(input, "abc");
    await flushVueUpdates();

    expect(assistantRenderCount).toBe(renderCountAfterMessage);
  });

  it("labels inline object: context consumers do not re-render on keystroke", async () => {
    const agent = new MockStepwiseAgent();
    const Host = createChatHost({ withInlineLabels: true });
    renderWithCopilotKit({ agent, children: Host });

    await submitAndReceiveAssistantMessage(agent, "msg-rerender-labels-1");

    const renderCountAfterMessage = labelConsumerRenderCount;
    expect(renderCountAfterMessage).toBeGreaterThan(0);

    const input = screen.getByRole("textbox");
    await fireEvent.update(input, "a");
    await fireEvent.update(input, "ab");
    await fireEvent.update(input, "abc");
    await flushVueUpdates();

    expect(labelConsumerRenderCount).toBe(renderCountAfterMessage);
  });
});
