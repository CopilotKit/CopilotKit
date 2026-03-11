import { defineComponent, h, markRaw } from "vue";
import type { Suggestion } from "@copilotkitnext/core";
import type { Meta, StoryObj } from "@storybook/vue3-vite";
import { Sparkles } from "lucide-vue-next";
import { CopilotChatSuggestionPill, CopilotChatSuggestionView } from "@copilotkitnext/vue";

const suggestions: Suggestion[] = [
  { title: "Summarize this thread", message: "Summarize the latest chat", isLoading: false },
  { title: "Draft a reply", message: "Draft a polite follow-up", isLoading: false },
  { title: "Create action items", message: "List next steps", isLoading: false },
];

const SparklesIcon = markRaw(
  defineComponent({
    name: "SparklesIcon",
    render() {
      return h(Sparkles, { class: "h-4 w-4", "aria-hidden": "true" });
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
    components: { CopilotChatSuggestionView, CopilotChatSuggestionPill, SparklesIcon },
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
