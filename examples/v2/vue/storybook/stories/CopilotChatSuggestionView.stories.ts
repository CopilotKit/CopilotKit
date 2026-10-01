import { defineComponent, h, markRaw } from "vue";
import type { Suggestion } from "@copilotkit/core";
import type { Meta, StoryObj } from "@storybook/vue3-vite";
import { Sparkles } from "lucide-vue-next";
import {
  CopilotChatSuggestionPill,
  CopilotChatSuggestionView,
} from "@copilotkit/vue";
import { manySuggestions, starterSuggestions } from "./support/fixtures";

const suggestions: Suggestion[] = [
  {
    title: "Summarize this thread",
    message: "Summarize the latest chat",
    isLoading: false,
  },
  {
    title: "Draft a reply",
    message: "Draft a polite follow-up",
    isLoading: false,
  },
  {
    title: "Create action items",
    message: "List next steps",
    isLoading: false,
  },
];

const SparklesIcon = markRaw(
  defineComponent({
    name: "SparklesIcon",
    render() {
      return h(Sparkles, { size: 16, "aria-hidden": "true" });
    },
  }),
);

const meta = {
  title: "UI/CopilotChatSuggestionView",
  component: CopilotChatSuggestionView,
  args: {
    suggestions,
  },
  parameters: {
    layout: "centered",
  },
} satisfies Meta<typeof CopilotChatSuggestionView>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const LoadingSecond: Story = {
  args: {
    suggestions: suggestions.map((suggestion, index) =>
      index === 1 ? { ...suggestion, isLoading: true } : suggestion,
    ),
  },
};

export const CustomSuggestionSlot: Story = {
  render: (args: Story["args"]) => ({
    components: {
      CopilotChatSuggestionView,
      CopilotChatSuggestionPill,
      SparklesIcon,
    },
    setup() {
      return { args, SparklesIcon };
    },
    template: `
      <CopilotChatSuggestionView :suggestions="args.suggestions">
        <template #suggestion="{ suggestion, isLoading, onSelect }">
          <CopilotChatSuggestionPill
            :is-loading="isLoading"
            :icon="SparklesIcon"
            @click="onSelect"
          >
            {{ suggestion.title }}
          </CopilotChatSuggestionPill>
        </template>
      </CopilotChatSuggestionView>
    `,
  }),
};

/** A container-query host, like the chat view, so the card grid can respond to its width. */
const withContainer = (width: number): NonNullable<Story["decorators"]> => [
  (story) => ({
    components: { story },
    template: `<div style="container-type: inline-size; width: ${width}px"><story /></div>`,
  }),
];

/** Welcome-screen cards: the title is the header, the message the body. */
export const Cards: Story = {
  args: {
    appearance: "cards",
    suggestions: starterSuggestions,
  },
  decorators: withContainer(720),
};

/** Cards stack in one column in narrow chats such as the popup or sidebar. */
export const CardsNarrow: Story = {
  args: {
    appearance: "cards",
    suggestions: starterSuggestions.map((suggestion, index) =>
      index === 1 ? { ...suggestion, isLoading: true } : suggestion,
    ),
  },
  decorators: withContainer(360),
};

/** Pills overflowing a narrow width: the row scrolls and its edge fades. */
export const Overflowing: Story = {
  args: {
    suggestions: manySuggestions,
  },
  decorators: withContainer(420),
};
