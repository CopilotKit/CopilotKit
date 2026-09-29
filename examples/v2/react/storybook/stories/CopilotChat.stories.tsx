import React from "react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import {
  CopilotChat,
  useConfigureSuggestions,
} from "@copilotkit/react-core/v2";
import {
  longReasoning,
  reactHooksConversation,
  reasoningConversation,
  storySuggestions,
  streamingCursorReply,
} from "./support/fixtures";
import { withFullHeight } from "./support/layouts";
import { withStandaloneCopilotKit } from "./support/providers";

/**
 * `CopilotChat` is the fully wired chat: it binds `CopilotChatView` to an
 * agent, so these stories are interactive — send a message and the local
 * StoryAgent streams a reply.
 */
const meta = {
  title: "UI/CopilotChat",
  component: CopilotChat,
  decorators: [withFullHeight],
  parameters: {
    layout: "fullscreen",
  },
} satisfies Meta<typeof CopilotChat>;

export default meta;
type Story = StoryObj<typeof meta>;

/** A fresh thread: the welcome screen with the input centered. */
export const Default: Story = {
  decorators: [withStandaloneCopilotKit()],
  parameters: { copilotkit: false },
};

/** An existing thread, restored from the agent when the chat connects. */
export const WithConversation: Story = {
  parameters: {
    copilotkit: { agent: { initialMessages: reactHooksConversation } },
  },
};

/**
 * A finished turn with its collapsed reasoning. New messages stream a
 * reasoning block ("Thinking…") before the reply.
 */
export const WithReasoning: Story = {
  parameters: {
    copilotkit: {
      agent: {
        initialMessages: reasoningConversation,
        reasoning: longReasoning,
        chunkDelayMs: 15,
      },
    },
  },
};

/**
 * Send any message to watch the cursor write a slow reply through paragraphs,
 * a heading, lists, a quote, a code block and a table. Pass
 * `messageView={{ inlineCursor: false }}` to keep it below the messages.
 */
export const StreamingCursor: Story = {
  parameters: {
    copilotkit: {
      agent: { reply: () => streamingCursorReply, chunkDelayMs: 140 },
    },
  },
};

const StaticSuggestions: React.FC<{ children: React.ReactNode }> = ({
  children,
}) => {
  useConfigureSuggestions({
    suggestions: storySuggestions,
    available: "always",
  });
  return <>{children}</>;
};

/** Static suggestions registered with `useConfigureSuggestions`. */
export const WithSuggestions: Story = {
  decorators: [
    (Story) => (
      <StaticSuggestions>
        <Story />
      </StaticSuggestions>
    ),
    withStandaloneCopilotKit(),
  ],
  parameters: { copilotkit: false },
};

/** Copy overrides through the `labels` prop. */
export const CustomLabels: Story = {
  args: {
    labels: {
      welcomeMessageText: "What are we shipping today?",
      chatInputPlaceholder: "Ask Acme Assistant…",
      chatDisclaimerText:
        "Acme Assistant can make mistakes. Check important info.",
    },
  },
  decorators: [withStandaloneCopilotKit()],
  parameters: { copilotkit: false },
};
