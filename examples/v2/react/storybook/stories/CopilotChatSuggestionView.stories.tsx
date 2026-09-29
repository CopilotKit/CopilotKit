import type { Meta, StoryObj } from "@storybook/react";
import {
  CopilotChatSuggestionView,
  CopilotChatSuggestionPill,
} from "@copilotkit/react-core/v2";
import type { Suggestion } from "@copilotkit/core";
import { Sparkles } from "lucide-react";
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

/** Welcome-screen cards: the title is the header, the message the body. */
export const Cards: Story = {
  args: {
    appearance: "cards",
    suggestions: starterSuggestions,
  },
  decorators: [
    (Story) => (
      <div className="@container w-[720px]">
        <Story />
      </div>
    ),
  ],
};

/** Cards stack in one column in narrow chats such as the popup or sidebar. */
export const CardsNarrow: Story = {
  ...Cards,
  args: {
    appearance: "cards",
    suggestions: starterSuggestions.map((suggestion, index) =>
      index === 1 ? { ...suggestion, isLoading: true } : suggestion,
    ),
  },
  decorators: [
    (Story) => (
      <div className="@container w-[360px]">
        <Story />
      </div>
    ),
  ],
};

/** Pills overflowing a narrow width: the row scrolls and its edge fades. */
export const Overflowing: Story = {
  args: {
    suggestions: manySuggestions,
  },
  decorators: [
    (Story) => (
      <div className="w-[420px]">
        <Story />
      </div>
    ),
  ],
};
