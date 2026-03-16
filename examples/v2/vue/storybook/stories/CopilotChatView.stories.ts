import type { Message } from "@ag-ui/core";
import type { Suggestion } from "@copilotkitnext/core";
import type { Meta, StoryObj } from "@storybook/vue3-vite";
import {
  CopilotChatAssistantMessage,
  CopilotChatConfigurationProvider,
  CopilotChatMessageView,
  CopilotChatView,
  CopilotKitProvider,
} from "@copilotkitnext/vue";

const suggestionSamples: Suggestion[] = [
  {
    title: "Summarize conversation",
    message: "Summarize our latest messages",
    isLoading: false,
  },
  {
    title: "Draft reply",
    message: "Draft a detailed response",
    isLoading: false,
  },
  {
    title: "List next steps",
    message: "List action items from this chat",
    isLoading: true,
  },
];

const storyMessages: Message[] = [
  {
    id: "user-1",
    content: "Hello! Can you help me understand how React hooks work?",
    role: "user",
  },
  {
    id: "assistant-1",
    content: `React hooks are functions that let you use state and other React features in functional components. Here are the most common ones:

- **useState** - Manages local state
- **useEffect** - Handles side effects
- **useContext** - Accesses context values
- **useCallback** - Memoizes functions
- **useMemo** - Memoizes values

Would you like me to explain any of these in detail?`,
    role: "assistant",
  },
  {
    id: "user-2",
    content: "Yes, could you explain useState with a simple example?",
    role: "user",
  },
  {
    id: "assistant-2",
    content: `Absolutely! Here's a simple useState example:

\`\`\`jsx
import React, { useState } from 'react';

function Counter() {
  const [count, setCount] = useState(0);

  return (
    <div>
      <p>You clicked {count} times</p>
      <button onClick={() => setCount(count + 1)}>
        Click me
      </button>
    </div>
  );
}
\`\`\`

In this example:
- \`useState(0)\` initializes the state with value 0
- It returns an array: \`[currentValue, setterFunction]\`
- \`count\` is the current state value
- \`setCount\` is the function to update the state`,
    role: "assistant",
  },
];

const meta = {
  title: "UI/CopilotChatView",
  parameters: {
    docs: {
      description: {
        component:
          "A complete chat interface with message feed and input components.",
      },
    },
  },
} satisfies Meta<{}>;

export default meta;
type Story = StoryObj<typeof meta>;

const fullscreenDecorator: Story["decorators"] = [
  (story) => ({
    components: { story },
    template: `
      <div style="height: 100vh; margin: 0; padding: 0; overflow: hidden">
        <story />
      </div>
    `,
  }),
];

export const Default: Story = {
  parameters: {
    layout: "fullscreen",
  },
  decorators: fullscreenDecorator,
  render: () => ({
    components: {
      CopilotKitProvider,
      CopilotChatConfigurationProvider,
      CopilotChatView,
      CopilotChatMessageView,
      CopilotChatAssistantMessage,
    },
    setup() {
      const handleSubmitMessage = (value: string) => {
        if (typeof window !== "undefined") {
          window.alert(`Message submitted: ${value}`);
        }
      };
      const handleThumbsUp = () => {
        if (typeof window !== "undefined") {
          window.alert("thumbsUp");
        }
      };
      const handleThumbsDown = () => {
        if (typeof window !== "undefined") {
          window.alert("thumbsDown");
        }
      };
      return {
        storyMessages,
        handleSubmitMessage,
        handleThumbsUp,
        handleThumbsDown,
      };
    },
    template: `
      <CopilotKitProvider runtime-url="https://copilotkit.ai">
        <CopilotChatConfigurationProvider thread-id="storybook-thread">
          <div style="height: 100%">
            <CopilotChatView :messages="storyMessages" @submit-message="handleSubmitMessage">
              <template #message-view="{ messages, isRunning }">
                <CopilotChatMessageView :messages="messages" :is-running="isRunning">
                  <template #assistant-message="{ message, messages: allMessages, isRunning: running }">
                    <CopilotChatAssistantMessage
                      :message="message"
                      :messages="allMessages"
                      :is-running="running"
                      @thumbs-up="handleThumbsUp"
                      @thumbs-down="handleThumbsDown"
                    />
                  </template>
                </CopilotChatMessageView>
              </template>
            </CopilotChatView>
          </div>
        </CopilotChatConfigurationProvider>
      </CopilotKitProvider>
    `,
  }),
};

export const WithSuggestions: Story = {
  parameters: {
    layout: "fullscreen",
  },
  decorators: fullscreenDecorator,
  render: () => ({
    components: {
      CopilotKitProvider,
      CopilotChatConfigurationProvider,
      CopilotChatView,
      CopilotChatMessageView,
      CopilotChatAssistantMessage,
    },
    setup() {
      const handleSubmitMessage = (value: string) => {
        if (typeof window !== "undefined") {
          window.alert(`Message submitted: ${value}`);
        }
      };
      const handleThumbsUp = () => {
        if (typeof window !== "undefined") {
          window.alert("thumbsUp");
        }
      };
      const handleThumbsDown = () => {
        if (typeof window !== "undefined") {
          window.alert("thumbsDown");
        }
      };
      const handleSelectSuggestion = (suggestion: Suggestion) => {
        if (typeof window !== "undefined") {
          window.alert(`Selected suggestion: ${suggestion.title}`);
        }
      };
      return {
        storyMessages,
        suggestionSamples,
        handleSubmitMessage,
        handleThumbsUp,
        handleThumbsDown,
        handleSelectSuggestion,
      };
    },
    template: `
      <CopilotKitProvider runtime-url="https://copilotkit.ai">
        <CopilotChatConfigurationProvider thread-id="storybook-thread">
          <div style="height: 100%">
            <CopilotChatView
              :messages="storyMessages"
              :suggestions="suggestionSamples"
              @submit-message="handleSubmitMessage"
              @select-suggestion="handleSelectSuggestion"
            >
              <template #message-view="{ messages, isRunning }">
                <CopilotChatMessageView :messages="messages" :is-running="isRunning">
                  <template #assistant-message="{ message, messages: allMessages, isRunning: running }">
                    <CopilotChatAssistantMessage
                      :message="message"
                      :messages="allMessages"
                      :is-running="running"
                      @thumbs-up="handleThumbsUp"
                      @thumbs-down="handleThumbsDown"
                    />
                  </template>
                </CopilotChatMessageView>
              </template>
            </CopilotChatView>
          </div>
        </CopilotChatConfigurationProvider>
      </CopilotKitProvider>
    `,
  }),
};
