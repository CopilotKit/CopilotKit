import React from "react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { fn } from "storybook/test";
import { ProxiedCopilotRuntimeAgent } from "@copilotkit/core";
import {
  CopilotChatConfigurationProvider,
  CopilotChatMessageView,
  CopilotChatView,
  CopilotKitProvider,
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

const resizeMessages = Array.from({ length: 100 }, (_, index) => ({
  id: `resize-${index}`,
  role: "user" as const,
  content: `Message ${index}: ${"Long messages wrap differently when the chat panel changes width. ".repeat(30)}`,
}));

function VirtualizedResizeExample() {
  const [width, setWidth] = React.useState(650);
  const [pinned, setPinned] = React.useState(false);
  const [agents] = React.useState(() => ({
    default: new ProxiedCopilotRuntimeAgent({ agentId: "default" }),
  }));

  return (
    <CopilotKitProvider agents__unsafe_dev_only={agents} showDevConsole={false}>
      <CopilotChatConfigurationProvider threadId="virtualized-resize">
        <p>
          Scroll into the history, then change the width. The reading position
          should stay fixed.
        </p>
        <div style={{ display: "flex", gap: 12, marginBottom: 12 }}>
          <button onClick={() => setWidth(330)}>Narrow</button>
          <button onClick={() => setWidth(650)}>Wide</button>
          <label>
            <input
              type="checkbox"
              checked={pinned}
              onChange={(event) => setPinned(event.target.checked)}
            />
            Pin to bottom
          </label>
        </div>
        <div
          style={{
            width,
            maxWidth: "100%",
            height: 520,
            display: "flex",
            flexDirection: "column",
          }}
        >
          <CopilotChatView.ScrollView
            key={String(pinned)}
            autoScroll={pinned ? "pin-to-bottom" : "none"}
          >
            <CopilotChatMessageView messages={resizeMessages} />
          </CopilotChatView.ScrollView>
        </div>
      </CopilotChatConfigurationProvider>
    </CopilotKitProvider>
  );
}

export const VirtualizedResize: Story = {
  parameters: {
    copilotkit: false,
    docs: {
      description: {
        story:
          "Resize a virtualized conversation while reading history, or enable bottom pinning and resize in both directions. Neither case should jump to a different message.",
      },
    },
  },
  render: () => <VirtualizedResizeExample />,
};
