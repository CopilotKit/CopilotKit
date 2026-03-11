import type { Component } from "vue";
import type { Meta, StoryObj } from "@storybook/vue3-vite";
import { ArrowRight, Sparkles } from "lucide-vue-next";
import { CopilotChatSuggestionPill } from "@copilotkitnext/vue";

type SuggestionPillStoryArgs = {
  label: string;
  isLoading?: boolean;
  icon?: Component;
};
type SuggestionPillIcon = InstanceType<typeof CopilotChatSuggestionPill>["$props"]["icon"];

const meta = {
  title: "UI/CopilotChatSuggestionPill",
  component: CopilotChatSuggestionPill,
  args: {
    label: "Draft a project brief",
  },
  parameters: {
    layout: "centered",
  },
  render: (args: SuggestionPillStoryArgs) => ({
    components: { CopilotChatSuggestionPill },
    setup() {
      return { args };
    },
    template: `
      <CopilotChatSuggestionPill :icon="args.icon" :is-loading="args.isLoading">
        {{ args.label }}
      </CopilotChatSuggestionPill>
    `,
  }),
} satisfies Meta<SuggestionPillStoryArgs>;

export default meta;
type Story = StoryObj<SuggestionPillStoryArgs>;

export const Default: Story = {};

export const WithIcon: Story = {
  args: {
    icon: Sparkles as unknown as SuggestionPillIcon,
  },
};

export const Loading: Story = {
  args: {
    isLoading: true,
  },
};

export const WithArrow: Story = {
  args: {
    icon: ArrowRight as unknown as SuggestionPillIcon,
    label: "Summarize notes into next steps",
  },
};
