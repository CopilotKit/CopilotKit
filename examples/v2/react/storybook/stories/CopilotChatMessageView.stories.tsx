import type { Meta, StoryObj } from "@storybook/react-vite";
import { fn } from "storybook/test";
import {
  CopilotChatMessageView,
  WildcardToolCallRender,
} from "@copilotkit/react-core/v2";
import {
  defaultRendererConversation,
  pendingQuestion,
  reactHooksConversation,
  toolCallConversation,
} from "./support/fixtures";
import { withMessageColumn } from "./support/layouts";
import { withDefaultToolRenderer } from "./support/providers";
import { demoToolRenderers } from "./support/ToolCards";

const meta = {
  title: "UI/CopilotChatMessageView",
  component: CopilotChatMessageView,
  decorators: [withMessageColumn],
  parameters: {
    layout: "fullscreen",
    docs: {
      description: {
        component:
          "Renders a transcript: user, assistant, reasoning and tool-call messages, plus the typing cursor while a run is in flight.",
      },
    },
  },
  args: {
    messages: reactHooksConversation,
    assistantMessage: {
      onThumbsUp: fn(),
      onThumbsDown: fn(),
    },
  },
} satisfies Meta<typeof CopilotChatMessageView>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};

/** A run in flight before the first token: the cursor holds the assistant's place. */
export const ShowCursor: Story = {
  args: {
    messages: pendingQuestion,
    isRunning: true,
  },
};

/**
 * App-defined renderers registered through `renderToolCalls` on the provider,
 * with `WildcardToolCallRender` as the fallback for `getWeather`, which has no
 * renderer of its own.
 */
export const WithToolCalls: Story = {
  args: {
    messages: toolCallConversation,
  },
  parameters: {
    copilotkit: {
      provider: {
        renderToolCalls: [...demoToolRenderers, WildcardToolCallRender],
      },
    },
  },
};

/**
 * The built-in tool card enabled with `useDefaultRenderTool()`: one call has
 * finished, the other is still running. Click a card to expand its arguments
 * and result.
 */
export const DefaultToolRendererDarkTheme: Story = {
  name: "Default Tool Renderer",
  args: {
    messages: defaultRendererConversation,
  },
  decorators: [withDefaultToolRenderer],
};
