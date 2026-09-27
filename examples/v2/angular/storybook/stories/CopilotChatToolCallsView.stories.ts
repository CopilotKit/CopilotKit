import type { Meta, StoryObj } from "@storybook/angular";
import { moduleMetadata } from "@storybook/angular";
import type { Message } from "@ag-ui/client";
import { CopilotChatToolCallsView } from "@copilotkit/angular";
import type { CopilotKitStoryParameters } from "../.storybook/preview";
import {
  streamingToolCallTurn,
  toolCallConversation,
  toolCallTurn,
  toolCallUserTurn,
} from "./support/fixtures";
import { withMessageColumn } from "./support/layouts";
import { storyToolRenderers } from "./support/tool-renderers";

/**
 * Renders the tool calls of one assistant message with whatever renderer is
 * registered for each tool. Status comes from the matching tool messages.
 * Without app renderers, `defaultToolRendering` uses CopilotKit's built-in card.
 */
const meta: Meta<CopilotChatToolCallsView> = {
  title: "UI/CopilotChatToolCallsView",
  component: CopilotChatToolCallsView,
  decorators: [
    moduleMetadata({ imports: [CopilotChatToolCallsView] }),
    withMessageColumn,
  ],
  args: {
    message: toolCallTurn,
    messages: toolCallConversation,
    isLoading: false,
  },
  parameters: {
    copilotkit: {
      config: { defaultToolRendering: true },
    } satisfies CopilotKitStoryParameters,
  },
  render: (args) => ({
    props: args,
    template: `
      <div data-copilotkit>
        <copilot-chat-tool-calls-view
          [message]="message"
          [messages]="messages"
          [isLoading]="isLoading"
        />
      </div>
    `,
  }),
};

export default meta;
type Story = StoryObj<CopilotChatToolCallsView>;

/** Calls still running: spinner, and the name and status shimmer. */
export const InProgress: Story = {
  args: {
    message: streamingToolCallTurn,
    messages: [toolCallUserTurn, streamingToolCallTurn],
    isLoading: true,
  },
};

/** Every call has a result. */
export const Complete: Story = {
  args: {
    messages: [
      ...toolCallConversation,
      {
        id: "tool-weather-1",
        role: "tool",
        toolCallId: "weather-1",
        content: "68°F and partly cloudy in San Francisco.",
      },
    ] satisfies Message[],
  },
};

/** A call expanded to show its arguments and result. */
export const Expanded: Story = {
  ...Complete,
  play: async ({ canvasElement }) => {
    const toggle = await waitForElement<HTMLButtonElement>(
      canvasElement,
      '[data-testid="copilot-tool-render"] button',
    );
    toggle.click();
  },
};

/** A tool that returned an error message as its result. */
export const ErrorResult: Story = {
  args: {
    messages: [
      ...toolCallConversation,
      {
        id: "tool-weather-1",
        role: "tool",
        toolCallId: "weather-1",
        content: "Error: weather service timed out after 10s",
      },
    ] satisfies Message[],
  },
  play: async ({ canvasElement }) => {
    const toggle = await waitForElement<HTMLButtonElement>(
      canvasElement,
      '[data-testid="copilot-tool-render"][data-tool-name="getWeather"] button',
    );
    toggle.click();
  },
};

/** App-registered renderers (`renderToolCalls`), styled with host tokens. */
export const CustomRenderer: Story = {
  parameters: {
    copilotkit: {
      config: { renderToolCalls: storyToolRenderers },
    } satisfies CopilotKitStoryParameters,
  },
};

function waitForElement<T extends Element>(
  root: ParentNode,
  selector: string,
): Promise<T> {
  return new Promise((resolve) => {
    const find = () => {
      const element = root.querySelector<T>(selector);
      if (element) resolve(element);
      else requestAnimationFrame(find);
    };
    find();
  });
}
