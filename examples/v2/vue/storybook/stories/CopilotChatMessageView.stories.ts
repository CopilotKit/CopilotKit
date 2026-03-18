import type { AssistantMessage, Message, ReasoningMessage, ToolMessage } from "@ag-ui/core";
import type { Meta, StoryObj } from "@storybook/vue3-vite";
import {
  CopilotChatAssistantMessage,
  CopilotChatConfigurationProvider,
  CopilotChatMessageView,
  CopilotKitProvider,
} from "@copilotkitnext/vue";
import { ref } from "vue";

const defaultMessages: Message[] = [
  {
    id: "user-1",
    role: "user",
    content: "Hello! Can you help me understand how React hooks work?",
  },
  {
    id: "assistant-1",
    role: "assistant",
    content: `React hooks are functions that let you use state and other React features in functional components. Here are the most common ones:

- **useState** - Manages local state
- **useEffect** - Handles side effects
- **useContext** - Accesses context values
- **useCallback** - Memoizes functions
- **useMemo** - Memoizes values

Would you like me to explain any of these in detail?`,
  },
  {
    id: "user-2",
    role: "user",
    content: "Yes, could you explain useState with a simple example?",
  },
  {
    id: "assistant-2",
    role: "assistant",
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
  },
];

const showCursorMessages: Message[] = [
  {
    id: "user-1",
    role: "user",
    content: "Can you explain how AI models work?",
  },
];

const toolCallMessages: Message[] = [
  {
    id: "user-1",
    role: "user",
    content:
      "Search for React hooks documentation, calculate 42 * 17 and 100 / 4 + 75, and check the weather in San Francisco",
  },
  {
    id: "assistant-1",
    role: "assistant",
    content:
      "I'll help you search for React hooks documentation, calculate both expressions, and check the weather.",
    toolCalls: [
      {
        id: "search-1",
        type: "function",
        function: {
          name: "search",
          arguments: JSON.stringify({
            query: "React hooks documentation",
            filters: ["official", "latest"],
          }),
        },
      },
      {
        id: "calc-1",
        type: "function",
        function: {
          name: "calculator",
          arguments: JSON.stringify({
            expression: "42 * 17",
          }),
        },
      },
      {
        id: "calc-2",
        type: "function",
        function: {
          name: "calculator",
          arguments: JSON.stringify({
            expression: "100 / 4 + 75",
          }),
        },
      },
      {
        id: "weather-1",
        type: "function",
        function: {
          name: "getWeather",
          arguments: '{"location": "San Francisco", "units": "fahren',
        },
      },
    ],
  } as AssistantMessage,
  {
    id: "tool-search-1",
    role: "tool",
    toolCallId: "search-1",
    content:
      "Found 5 relevant documentation pages about React hooks including useState, useEffect, and custom hooks.",
  } as ToolMessage,
  {
    id: "tool-calc-1",
    role: "tool",
    toolCallId: "calc-1",
    content: "714",
  } as ToolMessage,
  {
    id: "tool-calc-2",
    role: "tool",
    toolCallId: "calc-2",
    content: "100",
  } as ToolMessage,
  {
    id: "tool-weather-1",
    role: "tool",
    toolCallId: "weather-1",
    content:
      "Current weather in San Francisco: 68°F, partly cloudy with a gentle breeze.",
  } as ToolMessage,
];

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
  parameters: {
    layout: "fullscreen",
    docs: {
      description: {
        component:
          "A simple conversation between user and AI using CopilotChatMessageView component.",
      },
    },
  },
  decorators: [
    (story) => ({
      components: { story },
      template: `
        <div style="height: 100vh; margin: 0; padding: 0; overflow: auto">
          <story />
        </div>
      `,
    }),
  ],
} satisfies Meta<typeof CopilotChatMessageView>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  render: () => ({
    components: {
      CopilotKitProvider,
      CopilotChatConfigurationProvider,
      CopilotChatMessageView,
      CopilotChatAssistantMessage,
    },
    setup() {
      const handleThumbsUp = () => {
        window.alert("thumbsUp");
      };
      const handleThumbsDown = () => {
        window.alert("thumbsDown");
      };
      return { messages: defaultMessages, handleThumbsUp, handleThumbsDown };
    },
    template: `
      <CopilotKitProvider runtime-url="https://copilotkit.ai">
        <CopilotChatConfigurationProvider thread-id="123">
          <div style="height: 100%">
            <CopilotChatMessageView :messages="messages">
              <template #assistant-message="{ message, messages: allMessages, isRunning }">
                <CopilotChatAssistantMessage
                  :message="message"
                  :messages="allMessages"
                  :is-running="isRunning"
                  :on-thumbs-up="handleThumbsUp"
                  :on-thumbs-down="handleThumbsDown"
                />
              </template>
            </CopilotChatMessageView>
          </div>
        </CopilotChatConfigurationProvider>
      </CopilotKitProvider>
    `,
  }),
};

export const ShowCursor: Story = {
  render: () => ({
    components: {
      CopilotKitProvider,
      CopilotChatConfigurationProvider,
      CopilotChatMessageView,
      CopilotChatAssistantMessage,
    },
    setup() {
      const handleThumbsUp = () => {
        window.alert("thumbsUp");
      };
      const handleThumbsDown = () => {
        window.alert("thumbsDown");
      };
      return {
        messages: showCursorMessages,
        isRunning: true,
        handleThumbsUp,
        handleThumbsDown,
      };
    },
    template: `
      <CopilotKitProvider runtime-url="https://copilotkit.ai">
        <CopilotChatConfigurationProvider thread-id="123">
          <div style="height: 100%">
            <CopilotChatMessageView :messages="messages" :is-running="isRunning">
              <template #assistant-message="{ message, messages: allMessages, isRunning: running }">
                <CopilotChatAssistantMessage
                  :message="message"
                  :messages="allMessages"
                  :is-running="running"
                  :on-thumbs-up="handleThumbsUp"
                  :on-thumbs-down="handleThumbsDown"
                />
              </template>
            </CopilotChatMessageView>
          </div>
        </CopilotChatConfigurationProvider>
      </CopilotKitProvider>
    `,
  }),
};

export const WithToolCalls: Story = {
  parameters: {
    docs: {
      description: {
        story:
          "Demonstrates tool call rendering parity via Vue tool-call slots.",
      },
    },
  },
  render: () => ({
    components: {
      CopilotKitProvider,
      CopilotChatConfigurationProvider,
      CopilotChatMessageView,
    },
    setup() {
      const globalCounter = ref(0);
      const localCounters = ref<Record<string, number>>({});

      const getLocalCounter = (toolCallId: string) =>
        localCounters.value[toolCallId] ?? 0;
      const incrementLocalCounter = (toolCallId: string) => {
        localCounters.value[toolCallId] = getLocalCounter(toolCallId) + 1;
      };
      const decrementLocalCounter = (toolCallId: string) => {
        localCounters.value[toolCallId] = getLocalCounter(toolCallId) - 1;
      };

      const incrementGlobalCounter = () => {
        globalCounter.value += 1;
      };
      const decrementGlobalCounter = () => {
        globalCounter.value -= 1;
      };

      return {
        messages: toolCallMessages,
        toolCallStatus: {
          InProgress: "inProgress",
          Complete: "complete",
        },
        globalCounter,
        getLocalCounter,
        incrementLocalCounter,
        decrementLocalCounter,
        incrementGlobalCounter,
        decrementGlobalCounter,
      };
    },
    template: `
      <CopilotKitProvider runtime-url="https://copilotkit.ai">
        <CopilotChatConfigurationProvider thread-id="123">
          <div style="height: 100%">
            <CopilotChatMessageView :messages="messages">
              <template #tool-call-search="{ args, status, result }">
                <div
                  style="
                    padding: 12px;
                    margin: 8px 0;
                    border-radius: 8px;
                    border: 1px solid #cce0ff;
                  "
                  :style="{ backgroundColor: status === toolCallStatus.InProgress ? '#f0f4f8' : '#e6f3ff' }"
                >
                  <div style="font-weight: 700; margin-bottom: 4px">🔍 Search Tool</div>
                  <div style="font-size: 14px; color: #666">
                    Query: {{ args?.query }}
                    <div v-if="args?.filters?.length">
                      Filters: {{ args.filters.join(", ") }}
                    </div>
                  </div>
                  <div v-if="status === toolCallStatus.InProgress" style="margin-top: 8px; color: #0066cc">
                    Searching...
                  </div>
                  <div v-if="status === toolCallStatus.Complete && result" style="margin-top: 8px; color: #006600">
                    Results: {{ result }}
                  </div>
                </div>
              </template>

              <template #tool-call-calculator="{ args, status, result, toolCall }">
                <div
                  style="
                    padding: 12px;
                    margin: 8px 0;
                    border-radius: 8px;
                    border: 1px solid #ffcc66;
                  "
                  :style="{ backgroundColor: status === toolCallStatus.InProgress ? '#fff9e6' : '#fff4cc' }"
                >
                  <div style="font-weight: 700; margin-bottom: 4px">🧮 Calculator</div>
                  <div style="font-size: 14px; color: #666">Expression: {{ args?.expression }}</div>
                  <div v-if="status === toolCallStatus.InProgress" style="margin-top: 8px; color: #cc6600">
                    Calculating...
                  </div>
                  <div v-if="status === toolCallStatus.Complete && result" style="margin-top: 8px; color: #006600">
                    Result: {{ result }}
                  </div>

                  <div style="margin-top: 12px; padding: 8px; background-color: #fff8e6; border-radius: 4px">
                    <div style="font-size: 13px; color: #666; margin-bottom: 4px">
                      Local counter: {{ getLocalCounter(toolCall.id) }}
                    </div>
                    <div style="display: flex; gap: 8px; margin-bottom: 8px">
                      <button
                        type="button"
                        @click="decrementLocalCounter(toolCall.id)"
                        style="padding: 4px 12px; background: #ff9933; color: white; border: none; border-radius: 4px; cursor: pointer"
                      >
                        -
                      </button>
                      <button
                        type="button"
                        @click="incrementLocalCounter(toolCall.id)"
                        style="padding: 4px 12px; background: #ff9933; color: white; border: none; border-radius: 4px; cursor: pointer"
                      >
                        +
                      </button>
                    </div>

                    <div style="border-top: 1px solid #ffcc66; padding-top: 8px">
                      <div style="font-size: 13px; color: #666; margin-bottom: 4px; font-weight: 700">
                        Global counter: {{ globalCounter }}
                      </div>
                      <div style="display: flex; gap: 8px">
                        <button
                          type="button"
                          @click="decrementGlobalCounter"
                          style="padding: 4px 12px; background: #cc6600; color: white; border: none; border-radius: 4px; cursor: pointer"
                        >
                          Global -
                        </button>
                        <button
                          type="button"
                          @click="incrementGlobalCounter"
                          style="padding: 4px 12px; background: #cc6600; color: white; border: none; border-radius: 4px; cursor: pointer"
                        >
                          Global +
                        </button>
                      </div>
                    </div>
                  </div>
                </div>
              </template>

              <template #tool-call="{ args, status, result }">
                <div
                  style="
                    padding: 12px;
                    margin: 8px 0;
                    background-color: #f5f5f5;
                    border-radius: 8px;
                    border: 1px solid #ddd;
                  "
                >
                  <div style="font-weight: 700; margin-bottom: 4px">🔧 Tool Execution</div>
                  <div style="font-size: 14px; color: #666; white-space: pre-wrap">
                    {{ JSON.stringify(args, null, 2) }}
                  </div>
                  <div v-if="status === toolCallStatus.InProgress" style="margin-top: 8px; color: #666">
                    Processing...
                  </div>
                  <div v-if="status === toolCallStatus.Complete && result" style="margin-top: 8px; color: #333">
                    Output: {{ result }}
                  </div>
                </div>
              </template>
            </CopilotChatMessageView>
          </div>
        </CopilotChatConfigurationProvider>
      </CopilotKitProvider>
    `,
  }),
};

export const ReasoningParityBridge: Story = {
  parameters: {
    docs: {
      description: {
        story:
          "Vue-only parity bridge: reasoning-message rendering and cursor suppression when reasoning is the latest streaming message.",
      },
    },
  },
  render: () => ({
    components: {
      CopilotKitProvider,
      CopilotChatConfigurationProvider,
      CopilotChatMessageView,
    },
    setup() {
      return {
        messages: reasoningMessages,
        isRunning: true,
      };
    },
    template: `
      <CopilotKitProvider runtime-url="https://copilotkit.ai">
        <CopilotChatConfigurationProvider thread-id="123">
          <div style="height: 100%">
            <CopilotChatMessageView :messages="messages" :is-running="isRunning" />
          </div>
        </CopilotChatConfigurationProvider>
      </CopilotKitProvider>
    `,
  }),
};
