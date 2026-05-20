import type { Meta, StoryObj } from "@storybook/react";
import {
  CopilotChatConfigurationProvider,
  CopilotChatView,
  CopilotKitProvider,
} from "@copilotkit/react-core/v2";
import { Suggestion } from "@copilotkit/core";

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

export const Default: Story = {
  parameters: {
    layout: "fullscreen",
  },
  decorators: [
    (Story) => (
      <div
        style={{ height: "100vh", margin: 0, padding: 0, overflow: "hidden" }}
      >
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
              onSubmitMessage={(value) => {
                alert(`Message submitted: ${value}`);
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

export const PinToSend: Story = {
  parameters: {
    layout: "fullscreen",
    docs: {
      description: {
        story:
          "Pin-to-send mode anchors the user's last message at the top of the viewport when they submit. Useful for inspecting how content fades (or doesn't) above the input.",
      },
    },
  },
  decorators: Default.decorators,
  render: () => {
    return (
      <CopilotKitProvider runtimeUrl="https://copilotkit.ai">
        <CopilotChatConfigurationProvider threadId="storybook-pin-to-send">
          <div style={{ height: "100%" }}>
            <CopilotChatView
              autoScroll="pin-to-send"
              messages={pinToSendMessages}
              onSubmitMessage={(value) => {
                alert(`Message submitted: ${value}`);
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
            onSelectSuggestion={(suggestion) =>
              alert(`Selected suggestion: ${suggestion.title}`)
            }
            onSubmitMessage={(value) => {
              alert(`Message submitted: ${value}`);
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

// Enough back-and-forth to force scrolling so the feather region above the
// input is clearly visible in pin-to-send mode.
const pinToSendMessages = [
  {
    id: "u1",
    role: "user" as const,
    content: "Give me a quick intro to useEffect.",
    timestamp: new Date(),
  },
  {
    id: "a1",
    role: "assistant" as const,
    content: `\`useEffect\` runs side effects after render. Common uses:

- Data fetching
- Subscriptions
- Manual DOM work
- Timers

It takes a callback and an optional dependency array. If the deps change between renders, the callback re-runs. Return a cleanup function to tear down subscriptions or timers.`,
    timestamp: new Date(),
  },
  {
    id: "u2",
    role: "user" as const,
    content: "Show me a subscription example.",
    timestamp: new Date(),
  },
  {
    id: "a2",
    role: "assistant" as const,
    content: `\`\`\`jsx
useEffect(() => {
  const socket = new WebSocket(url);
  socket.addEventListener("message", onMessage);
  return () => socket.close();
}, [url]);
\`\`\`

The cleanup closes the socket if \`url\` changes or the component unmounts. Without it you'd leak connections on every dependency change.`,
    timestamp: new Date(),
  },
  {
    id: "u3",
    role: "user" as const,
    content: "What about running something only once on mount?",
    timestamp: new Date(),
  },
  {
    id: "a3",
    role: "assistant" as const,
    content: `Pass an empty dependency array:

\`\`\`jsx
useEffect(() => {
  analytics.track("page_viewed");
}, []);
\`\`\`

With \`[]\`, React runs the effect once after the first render and never again (in production — Strict Mode runs it twice in dev to help surface cleanup bugs).`,
    timestamp: new Date(),
  },
  {
    id: "u4",
    role: "user" as const,
    content:
      "How do I avoid the stale-closure trap when reading state inside an effect?",
    timestamp: new Date(),
  },
  {
    id: "a4",
    role: "assistant" as const,
    content: `A few options:

1. **Add the value to deps** so the effect re-subscribes with the fresh closure.
2. **Use a ref** (\`useRef\`) and read \`ref.current\` inside the callback — the ref always sees the latest value.
3. **Use functional setState** when updating: \`setCount(c => c + 1)\` avoids reading the stale \`count\`.

Dependency arrays are the honest answer — refs are an escape hatch when the value changes too often to re-subscribe on.`,
    timestamp: new Date(),
  },
  {
    id: "u5",
    role: "user" as const,
    content: "Anything to watch out for with async work inside useEffect?",
    timestamp: new Date(),
  },
  {
    id: "a5",
    role: "assistant" as const,
    content: `Two big ones:

1. **The effect itself can't be \`async\`.** Define an inner async function and call it: \`useEffect(() => { (async () => { ... })(); }, [])\`.
2. **Guard against unmount / stale responses.** If a fetch resolves after the component unmounts (or after a new request starts), you'll either set state on an unmounted component or overwrite newer data with older. An \`ignore\` flag in cleanup, or an \`AbortController\`, handles both.`,
    timestamp: new Date(),
  },
];
