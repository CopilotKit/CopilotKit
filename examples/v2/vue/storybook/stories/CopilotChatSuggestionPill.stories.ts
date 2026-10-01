import type { Component } from "vue";
import type { Meta, StoryObj } from "@storybook/vue3-vite";
import { ArrowRight, Sparkles } from "lucide-vue-next";
import { CopilotChatSuggestionPill } from "@copilotkit/vue";

type SuggestionPillStoryArgs = {
  label: string;
  isLoading?: boolean;
  icon?: Component;
  appearance?: "pill" | "card";
  description?: string;
};
type SuggestionPillIcon = InstanceType<
  typeof CopilotChatSuggestionPill
>["$props"]["icon"];

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
      <CopilotChatSuggestionPill
        :icon="args.icon"
        :is-loading="args.isLoading"
        :appearance="args.appearance"
        :description="args.description"
      >
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

/** The card appearance used on welcome screens: label as header, description as body. */
export const Card: Story = {
  args: {
    appearance: "card",
    label: "Plan a launch",
    description: "Turn the Q3 goals into a week-by-week launch checklist",
  },
  decorators: [
    (story) => ({
      components: { story },
      template: `<div style="width: 20rem"><story /></div>`,
    }),
  ],
};

export const CardLoading: Story = {
  ...Card,
  args: { ...Card.args, isLoading: true },
};
