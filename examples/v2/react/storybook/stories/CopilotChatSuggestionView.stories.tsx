import type { Meta, StoryObj } from "@storybook/react";
import {
  CopilotChatSuggestionView,
  CopilotChatSuggestionPill,
} from "@copilotkitnext/react";
import { Suggestion } from "@copilotkitnext/core";
import { Sparkles } from "lucide-react";

const suggestions: Suggestion[] = [
  { title: "Summarize this thread", message: "Summarize the latest chat", isLoading: false },
  { title: "Draft a reply", message: "Draft a polite follow-up", isLoading: false },
  { title: "Create action items", message: "List next steps", isLoading: false },
];

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

type Story = StoryObj<typeof CopilotChatSuggestionView>;

export const Default: Story = {};

export const LoadingSecond: Story = {
  args: {
    suggestions: suggestions.map((suggestion, index) =>
      index === 1 ? { ...suggestion, isLoading: true } : suggestion,
    ),
  },
};

export const CustomSuggestionSlot: Story = {
  args: {
    suggestion: {
      icon: <Sparkles className="h-4 w-4" aria-hidden="true" />,
    },
  },
};
