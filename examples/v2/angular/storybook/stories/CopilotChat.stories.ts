import type { Meta, StoryObj } from "@storybook/angular";
import { moduleMetadata } from "@storybook/angular";
import { CopilotChat, provideCopilotChatLabels } from "@copilotkit/angular";
import type { CopilotKitStoryParameters } from "../.storybook/preview";
import { streamingCursorReply } from "./support/fixtures";
import { withFullHeight } from "./support/layouts";

/**
 * `<copilot-chat>` wired to the in-memory Storybook agent: type a message and
 * press Enter to get a streamed, canned reply. No runtime or network involved.
 */
const meta: Meta<CopilotChat> = {
  title: "UI/CopilotChat",
  component: CopilotChat,
  decorators: [moduleMetadata({ imports: [CopilotChat] }), withFullHeight],
  parameters: { layout: "fullscreen" },
  render: () => ({ template: `<copilot-chat />` }),
};

export default meta;
type Story = StoryObj<CopilotChat>;

/** Empty thread: the welcome screen. Send a message to see a streamed reply. */
export const Default: Story = {};

export const WithSuggestions: Story = {
  parameters: {
    copilotkit: {
      config: {
        suggestionsConfig: [
          {
            available: "always",
            suggestions: [
              {
                title: "Summarize this thread",
                message: "Summarize this thread in three bullet points.",
              },
              { title: "Draft a reply", message: "Draft a friendly reply." },
              {
                title: "List next steps",
                message: "What are the next steps?",
              },
            ],
          },
        ],
      },
    } satisfies CopilotKitStoryParameters,
  },
};

/** Opens mid-conversation; new replies stream in below. */
export const WithConversation: Story = {
  parameters: {
    copilotkit: {
      agent: {
        messages: [
          {
            id: "user-1",
            role: "user",
            content: "What does CopilotKit's Angular package give me?",
          },
          {
            id: "assistant-1",
            role: "assistant",
            content:
              "Drop-in chat components (`<copilot-chat>`, `<copilot-popup>`, `<copilot-sidebar>`), " +
              "signals-based agent state, and hooks for frontend tools and human-in-the-loop.\n\n" +
              "```ts\nimport { provideCopilotKit } from '@copilotkit/angular';\n\n" +
              "bootstrapApplication(App, {\n  providers: [provideCopilotKit({ runtimeUrl: '/api/copilotkit' })],\n});\n```",
          },
        ],
      },
    } satisfies CopilotKitStoryParameters,
  },
};

/** In a conversation, suggestions sit in one scrollable row docked above the input. */
export const ConversationWithSuggestions: Story = {
  parameters: {
    copilotkit: {
      agent: {
        messages: [
          {
            id: "user-1",
            role: "user",
            content: "Summarize the launch thread for me.",
          },
          {
            id: "assistant-1",
            role: "assistant",
            content:
              "The team agreed to ship the beta in July, review pricing in August, and target GA in September.",
          },
        ],
      },
      config: {
        suggestionsConfig: [
          {
            available: "always",
            suggestions: [
              { title: "Draft a reply", message: "Draft a friendly reply." },
              {
                title: "Create action items",
                message: "Turn this into action items.",
              },
              {
                title: "Summarize in three bullets",
                message: "Summarize in three bullets.",
              },
              { title: "Translate to Spanish", message: "Translate this." },
              {
                title: "Schedule a follow-up",
                message: "Schedule a follow-up.",
              },
            ],
          },
        ],
      },
    } satisfies CopilotKitStoryParameters,
  },
};

/** The agent streams its reasoning before answering. Send a message to see it. */
export const WithReasoning: Story = {
  parameters: {
    copilotkit: {
      agent: {
        chunkDelayMs: 60,
        reasoning:
          "The user wants a short answer. I'll **restate the question**, then give one concrete suggestion.",
      },
    } satisfies CopilotKitStoryParameters,
  },
};

/**
 * Send any message to watch the cursor write a slow reply through paragraphs,
 * a heading, lists, a quote, a code block and a table. Set the message view's
 * `inlineCursor` to `false` to keep it below the messages.
 */
export const StreamingCursor: Story = {
  parameters: {
    copilotkit: {
      agent: { reply: () => streamingCursorReply, chunkDelayMs: 140 },
    } satisfies CopilotKitStoryParameters,
  },
};

/** Labels come from `provideCopilotChatLabels`. */
export const CustomLabels: Story = {
  decorators: [
    moduleMetadata({
      providers: [
        provideCopilotChatLabels({
          welcomeMessageText: "What are we shipping today?",
          chatInputPlaceholder: "Ask the launch assistant…",
          chatDisclaimerText: "Double-check dates before sharing them.",
        }),
      ],
    }),
  ],
};
