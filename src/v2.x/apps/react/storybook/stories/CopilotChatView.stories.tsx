import type { Meta, StoryObj } from "@storybook/react";
import { CopilotChatConfigurationProvider, CopilotChatView, CopilotKitProvider } from "@copilotkitnext/react";
import { Suggestion } from "@copilotkitnext/core";

const meta = {
  title: "UI/CopilotChatView",
  parameters: {
    docs: {
      description: {
        component: "A complete chat interface with message feed and input components.",
      },
    },
  },
} satisfies Meta<{}>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  parameters: {
    layout: "fullscreen",
  },
  decorators: [
    (Story) => (
      <div style={{ height: "100vh", margin: 0, padding: 0, overflow: "hidden" }}>
        <Story />
      </div>
    ),
  ],
  render: () => {
    return (
      <CopilotKitProvider runtimeUrl="https://copilotkit.ai">
        <CopilotChatConfigurationProvider threadId="storybook-thread">
          <div style={{ height: "100%" }}>
            <CopilotChatView
              messages={storyMessages}
              inputProps={{
                onSubmitMessage: (value) => {
                  alert(`Message submitted: ${value}`);
                },
              }}
              messageView={{
                assistantMessage: {
                  onThumbsUp: () => {
                    alert("thumbsUp");
                  },
                  onThumbsDown: () => {
                    alert("thumbsDown");
                  },
                },
              }}
            />
          </div>
        </CopilotChatConfigurationProvider>
      </CopilotKitProvider>
    );
  },
};

export const WithSuggestions: Story = {
  parameters: {
    layout: "fullscreen",
  },
  decorators: Default.decorators,
  render: () => (
    <CopilotKitProvider runtimeUrl="https://copilotkit.ai">
      <CopilotChatConfigurationProvider threadId="storybook-thread">
        <div style={{ height: "100%" }}>
          <CopilotChatView
            messages={storyMessages}
            suggestions={suggestionSamples}
            onSelectSuggestion={(suggestion) => alert(`Selected suggestion: ${suggestion.title}`)}
            inputProps={{
              onSubmitMessage: (value) => {
                alert(`Message submitted: ${value}`);
              },
            }}
            messageView={{
              assistantMessage: {
                onThumbsUp: () => alert("thumbsUp"),
                onThumbsDown: () => alert("thumbsDown"),
              },
            }}
          />
        </div>
      </CopilotChatConfigurationProvider>
    </CopilotKitProvider>
  ),
};

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

const storyMessages = [
  {
    id: "user-1",
    content: "Hello! Can you help me understand how React hooks work?",
    timestamp: new Date(),
    role: "user" as const,
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
    timestamp: new Date(),
    role: "assistant" as const,
  },
  {
    id: "user-2",
    content: "Yes, could you explain useState with a simple example?",
    timestamp: new Date(),
    role: "user" as const,
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
    timestamp: new Date(),
    role: "assistant" as const,
  },
];
