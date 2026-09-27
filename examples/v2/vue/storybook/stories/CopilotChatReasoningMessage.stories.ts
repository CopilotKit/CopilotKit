import { computed, defineComponent, onBeforeUnmount, ref, watch } from "vue";
import type { Meta, StoryObj } from "@storybook/vue3-vite";
import { expect, userEvent, within } from "storybook/test";
import { CopilotChatReasoningMessage } from "@copilotkit/vue";
import type { ReasoningMessage } from "@copilotkit/vue";
import { longReasoning, shortReasoning } from "./support/fixtures";
import { withMessageColumn } from "./support/layouts";

const reasoning = (content: string): ReasoningMessage => ({
  id: "reasoning-story",
  role: "reasoning",
  content,
});

/**
 * Reasoning ("thinking") output. It is open while the reasoning message is the
 * latest one in a running turn, then collapses to "Thought for …" when the run
 * moves on; the header toggles it.
 */
const meta = {
  title: "UI/CopilotChatReasoningMessage",
  component: CopilotChatReasoningMessage,
  decorators: [withMessageColumn],
  parameters: {
    layout: "fullscreen",
  },
  args: {
    message: reasoning(shortReasoning),
  },
  render: (args) => ({
    components: { CopilotChatReasoningMessage },
    setup() {
      return { args };
    },
    template: `<CopilotChatReasoningMessage v-bind="args" />`,
  }),
} satisfies Meta<typeof CopilotChatReasoningMessage>;

export default meta;
type Story = StoryObj<typeof meta>;

const streamingMessage = reasoning(
  shortReasoning.split(" ").slice(0, 14).join(" "),
);

/** Reasoning is streaming: open, with the pulsing cursor after the text. */
export const Streaming: Story = {
  args: {
    message: streamingMessage,
    messages: [streamingMessage],
    isRunning: true,
  },
};

const emptyMessage = reasoning("");

/** The run started but no reasoning text has arrived yet. */
export const ThinkingWithoutContent: Story = {
  args: {
    message: emptyMessage,
    messages: [emptyMessage],
    isRunning: true,
  },
};

/** Finished: collapsed to its summary line. */
export const Finished: Story = {};

/** A long, finished reasoning block expanded by clicking the header. */
export const ExpandedLongReasoning: Story = {
  args: {
    message: reasoning(longReasoning),
  },
  play: async ({ canvasElement }) => {
    const header = await within(canvasElement).findByRole("button", {
      name: /thought for/i,
    });
    await userEvent.click(header);
    await expect(header).toHaveAttribute("aria-expanded", "true");
    // Drop the programmatic focus ring so the resting expanded state shows.
    header.blur();
  },
};

const StreamThenCollapseDemo = defineComponent({
  name: "StreamThenCollapseDemo",
  components: { CopilotChatReasoningMessage },
  setup() {
    const words = longReasoning.split(" ");
    const run = ref(0);
    const count = ref(0);
    let timer: ReturnType<typeof setInterval> | undefined;

    watch(
      run,
      () => {
        clearInterval(timer);
        count.value = 0;
        timer = setInterval(() => {
          count.value = Math.min(count.value + 2, words.length);
          if (count.value >= words.length) clearInterval(timer);
        }, 40);
      },
      { immediate: true },
    );
    onBeforeUnmount(() => clearInterval(timer));

    const message = computed(() =>
      reasoning(words.slice(0, count.value).join(" ")),
    );
    const streaming = computed(() => count.value < words.length);
    const replay = () => {
      run.value += 1;
    };
    return { message, streaming, replay };
  },
  template: `
    <div class="story-stack">
      <CopilotChatReasoningMessage
        :message="message"
        :messages="[message]"
        :is-running="streaming"
      />
      <div>
        <button type="button" class="story-button" @click="replay">Replay</button>
      </div>
    </div>
  `,
});

/** Streams word by word, then collapses when the turn ends. Replays on click. */
export const StreamThenCollapse: Story = {
  render: () => ({
    components: { StreamThenCollapseDemo },
    template: `<StreamThenCollapseDemo />`,
  }),
};
