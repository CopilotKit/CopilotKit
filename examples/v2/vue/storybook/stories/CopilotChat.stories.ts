import type { Meta, StoryObj } from "@storybook/vue3-vite";
import { CopilotChat, useConfigureSuggestions } from "@copilotkit/vue";
import type { CopilotKitStoryParameters } from "../.storybook/preview";
import {
  longReasoning,
  reactHooksConversation,
  reasoningConversation,
  storySuggestions,
  streamingCursorReply,
} from "./support/fixtures";
import { withFullHeight } from "./support/layouts";

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
  render: (args) => ({
    components: { CopilotChat },
    setup() {
      return { args };
    },
    template: `<CopilotChat v-bind="args" />`,
  }),
} satisfies Meta<typeof CopilotChat>;

export default meta;
type Story = StoryObj<typeof meta>;

/** A fresh thread: the welcome screen with the input centered. */
export const Default: Story = {};

/** An existing thread, restored from the agent. */
export const WithConversation: Story = {
  parameters: {
    copilotkit: {
      agent: { initialMessages: reactHooksConversation },
    } satisfies CopilotKitStoryParameters,
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
    } satisfies CopilotKitStoryParameters,
  },
};

/**
 * Send any message to watch the cursor write a slow reply through paragraphs,
 * a heading, lists, a quote, a code block and a table. Pass
 * `:inline-cursor="false"` to keep it below the messages.
 */
export const StreamingCursor: Story = {
  parameters: {
    copilotkit: {
      agent: { reply: () => streamingCursorReply, chunkDelayMs: 140 },
    } satisfies CopilotKitStoryParameters,
  },
};

/** Static suggestions registered with `useConfigureSuggestions`. */
export const WithSuggestions: Story = {
  decorators: [
    (story) => ({
      components: { story },
      setup() {
        useConfigureSuggestions({
          suggestions: storySuggestions,
          available: "always",
        });
      },
      template: `<story />`,
    }),
  ],
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
};
