import type { Message, ReasoningMessage } from "@ag-ui/core";
import type { Meta, StoryObj } from "@storybook/vue3-vite";
import {
  CopilotChatAssistantMessage,
  CopilotChatMessageView,
} from "@copilotkit/vue";
import {
  defaultRendererConversation,
  multiStepReply,
  pendingQuestion,
  reactHooksConversation,
  toolCallConversation,
} from "./support/fixtures";
import { withMessageColumn } from "./support/layouts";
import { withDefaultToolRenderer } from "./support/providers";
import CalculatorToolCard from "./support/CalculatorToolCard.vue";
import SearchToolCard from "./support/SearchToolCard.vue";

const handleThumbsUp = () => console.log("[Storybook] Thumbs up");
const handleThumbsDown = () => console.log("[Storybook] Thumbs down");

const reasoningMessages: Message[] = [
  {
    id: "user-reasoning",
    role: "user",
    content: "Explain this step by step",
  },
  {
    id: "reasoning-1",
    role: "reasoning",
    content: "First, I will break the request into smaller parts.",
  } as ReasoningMessage,
];

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
  },
  render: (args) => ({
    components: { CopilotChatMessageView },
    setup() {
      return { args };
    },
    template: `<CopilotChatMessageView v-bind="args" />`,
  }),
} satisfies Meta<typeof CopilotChatMessageView>;

export default meta;
type Story = StoryObj<typeof meta>;

/** The `#assistant-message` slot wires the feedback buttons. */
export const Default: Story = {
  render: (args) => ({
    components: { CopilotChatMessageView, CopilotChatAssistantMessage },
    setup() {
      return { args, handleThumbsUp, handleThumbsDown };
    },
    template: `
      <CopilotChatMessageView v-bind="args">
        <template #assistant-message="{ message, messages: allMessages, isRunning, showCursor }">
          <CopilotChatAssistantMessage
            :message="message"
            :messages="allMessages"
            :is-running="isRunning"
            :show-cursor="showCursor"
            @thumbs-up="handleThumbsUp"
            @thumbs-down="handleThumbsDown"
          />
        </template>
      </CopilotChatMessageView>
    `,
  }),
};

/** A run in flight before the first token: the cursor holds the assistant's place. */
export const ShowCursor: Story = {
  args: {
    messages: pendingQuestion,
    isRunning: true,
  },
};

/**
 * App-defined renderers supplied through `#tool-call-<name>` slots, with
 * CopilotKit's built-in card (`useDefaultRenderTool()`) as the fallback for
 * `getWeather`, which has no renderer of its own.
 */
export const WithToolCalls: Story = {
  args: {
    messages: toolCallConversation,
  },
  decorators: [withDefaultToolRenderer],
  render: (args) => ({
    components: { CopilotChatMessageView, SearchToolCard, CalculatorToolCard },
    setup() {
      return { args };
    },
    template: `
      <CopilotChatMessageView v-bind="args">
        <template #tool-call-search="{ args: toolArgs, status, result }">
          <SearchToolCard :args="toolArgs" :status="status" :result="result" />
        </template>
        <template #tool-call-calculator="{ args: toolArgs, status, result }">
          <CalculatorToolCard :args="toolArgs" :status="status" :result="result" />
        </template>
      </CopilotChatMessageView>
    `,
  }),
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

/**
 * One user message answered by several assistant messages (text, a tool call,
 * more text) reads as one reply: only its last message shows the toolbar, and
 * copy covers the whole reply.
 */
export const MultiStepReply: Story = {
  args: {
    messages: multiStepReply,
  },
  decorators: [withDefaultToolRenderer],
  render: (args) => ({
    components: { CopilotChatMessageView, CopilotChatAssistantMessage },
    setup() {
      return { args, handleThumbsUp, handleThumbsDown };
    },
    template: `
      <CopilotChatMessageView v-bind="args">
        <template #assistant-message="{ message, messages: allMessages, isRunning, showCursor }">
          <CopilotChatAssistantMessage
            :message="message"
            :messages="allMessages"
            :is-running="isRunning"
            :show-cursor="showCursor"
            @thumbs-up="handleThumbsUp"
            @thumbs-down="handleThumbsDown"
          />
        </template>
      </CopilotChatMessageView>
    `,
  }),
};

/** The same reply with `toolbar-scope="message"`: a toolbar per message. */
export const ToolbarPerMessage: Story = {
  args: {
    messages: multiStepReply,
  },
  decorators: [withDefaultToolRenderer],
  render: (args) => ({
    components: { CopilotChatMessageView, CopilotChatAssistantMessage },
    setup() {
      return { args, handleThumbsUp, handleThumbsDown };
    },
    template: `
      <CopilotChatMessageView v-bind="args">
        <template #assistant-message="{ message, messages: allMessages, isRunning, showCursor }">
          <CopilotChatAssistantMessage
            :message="message"
            :messages="allMessages"
            :is-running="isRunning"
            :show-cursor="showCursor"
            toolbar-scope="message"
            @thumbs-up="handleThumbsUp"
            @thumbs-down="handleThumbsDown"
          />
        </template>
      </CopilotChatMessageView>
    `,
  }),
};

/**
 * Vue-only parity bridge: reasoning-message rendering and cursor suppression
 * when reasoning is the latest streaming message.
 */
export const ReasoningParityBridge: Story = {
  args: {
    messages: reasoningMessages,
    isRunning: true,
  },
};
