import type { Meta, StoryObj } from "@storybook/react";
import { Sparkles, ArrowRight } from "lucide-react";
import { CopilotChatSuggestionPill } from "@copilotkit/react-core/v2";

const meta = {
  title: "UI/CopilotChatSuggestionPill",
  component: CopilotChatSuggestionPill,
  args: {
    children: "Draft a project brief",
  },
  parameters: {
    layout: "centered",
  },
} satisfies Meta<typeof CopilotChatSuggestionPill>;

export default meta;

type Story = StoryObj<typeof CopilotChatSuggestionPill>;

export const Default: Story = {};

export const WithIcon: Story = {
  args: {
    icon: <Sparkles className="h-4 w-4" aria-hidden="true" />,
  },
};

export const Loading: Story = {
  args: {
    isLoading: true,
  },
};

export const WithArrow: Story = {
  args: {
    icon: <ArrowRight className="h-4 w-4" aria-hidden="true" />,
    children: "Summarize notes into next steps",
  },
};

/** The card appearance used on welcome screens: label as header, description as body. */
export const Card: Story = {
  args: {
    appearance: "card",
    children: "Plan a launch",
    description: "Turn the Q3 goals into a week-by-week launch checklist",
  },
  decorators: [
    (Story) => (
      <div className="w-80">
        <Story />
      </div>
    ),
  ],
};

export const CardLoading: Story = {
  ...Card,
  args: { ...Card.args, isLoading: true },
};
