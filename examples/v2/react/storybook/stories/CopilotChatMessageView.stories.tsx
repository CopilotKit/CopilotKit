import React from "react";
import type { Meta, StoryObj } from "@storybook/react";
import { CopilotChatConfigurationProvider, CopilotChatMessageView, CopilotKitProvider } from "@copilotkitnext/react";
import { z } from "zod";
import { ToolCallStatus } from "@copilotkitnext/core";

const STORYBOOK_THREAD_ID = "storybook-thread";

const meta = {
  title: "UI/CopilotChatMessageView",
  parameters: {
    docs: {
      description: {
        component: "A simple conversation between user and AI using CopilotChatMessageView component.",
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
      <div style={{ height: "100vh", margin: 0, padding: 0, overflow: "auto" }}>
        <Story />
      </div>
    ),
  ],
  render: () => {
    const messages = [
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

    return (
      <CopilotKitProvider runtimeUrl="https://copilotkit.ai">
        <CopilotChatConfigurationProvider threadId={"123"}>
          <div style={{ height: "100%" }}>
            <CopilotChatMessageView
              messages={messages}
              assistantMessage={{
                onThumbsUp: () => {
                  alert("thumbsUp");
                },
                onThumbsDown: () => {
                  alert("thumbsDown");
                },
              }}
            />
          </div>
        </CopilotChatConfigurationProvider>
      </CopilotKitProvider>
    );
  },
};

export const ShowCursor: Story = {
  parameters: {
    layout: "fullscreen",
  },
  decorators: [
    (Story) => (
      <div style={{ height: "100vh", margin: 0, padding: 0, overflow: "auto" }}>
        <Story />
      </div>
    ),
  ],
  render: () => {
    const messages = [
      {
        id: "user-1",
        content: "Can you explain how AI models work?",
        timestamp: new Date(),
        role: "user" as const,
      },
    ];

    return (
      <CopilotKitProvider runtimeUrl="https://copilotkit.ai">
        <CopilotChatConfigurationProvider threadId={"123"}>
          <div style={{ height: "100%" }}>
            <CopilotChatMessageView
              messages={messages}
              isRunning={true}
              assistantMessage={{
                onThumbsUp: () => {
                  alert("thumbsUp");
                },
                onThumbsDown: () => {
                  alert("thumbsDown");
                },
              }}
            />
          </div>
        </CopilotChatConfigurationProvider>
      </CopilotKitProvider>
    );
  },
};

export const WithToolCalls: Story = {
  parameters: {
    layout: "fullscreen",
    docs: {
      description: {
        story: "Demonstrates tool call rendering with CopilotKitProvider's renderToolCalls prop",
      },
      source: {
        type: "code",
        code: `import {
  CopilotChatConfigurationProvider,
  CopilotChatMessageView,
  CopilotKitProvider,
} from "@copilotkitnext/react";
import { z } from "zod";
import { ToolCallStatus } from "@copilotkitnext/core";

// Define schemas for different tool arguments
const searchSchema = z.object({
  query: z.string(),
  filters: z.array(z.string()).optional(),
});

const calculatorSchema = z.object({
  expression: z.string(),
  variables: z.record(z.number()).optional(),
});

// Create render components for different tools
const SearchToolRender = ({ args, status, result }) => (
  <div style={{
    padding: "12px",
    margin: "8px 0",
    backgroundColor: status === ToolCallStatus.InProgress ? "#f0f4f8" : "#e6f3ff",
    borderRadius: "8px",
    border: "1px solid #cce0ff",
  }}>
    <div style={{ fontWeight: "bold", marginBottom: "4px" }}>🔍 Search Tool</div>
    <div style={{ fontSize: "14px", color: "#666" }}>
      Query: {args.query}
      {args.filters && args.filters.length > 0 && (
        <div>Filters: {args.filters.join(", ")}</div>
      )}
    </div>
    {status === ToolCallStatus.InProgress && (
      <div style={{ marginTop: "8px", color: "#0066cc" }}>Searching...</div>
    )}
    {status === ToolCallStatus.Complete && result && (
      <div style={{ marginTop: "8px", color: "#006600" }}>
        Results: {result}
      </div>
    )}
  </div>
);


// Wildcard render for unmatched tools
const WildcardToolRender = ({ args, status, result }) => (
  <div style={{
    padding: "12px",
    margin: "8px 0",
    backgroundColor: "#f5f5f5",
    borderRadius: "8px",
    border: "1px solid #ddd",
  }}>
    <div style={{ fontWeight: "bold", marginBottom: "4px" }}>🔧 Tool Execution</div>
    <div style={{ fontSize: "14px", color: "#666" }}>
      <pre>{JSON.stringify(args, null, 2)}</pre>
    </div>
    {status === ToolCallStatus.InProgress && (
      <div style={{ marginTop: "8px", color: "#666" }}>Processing...</div>
    )}
    {status === ToolCallStatus.Complete && result && (
      <div style={{ marginTop: "8px", color: "#333" }}>
        Output: {result}
      </div>
    )}
  </div>
);

export function WithToolCallsExample() {
  const messages = [
    {
      id: "user-1",
      content: "Search for React hooks documentation and calculate 42 * 17",
      timestamp: new Date(),
      role: "user",
    },
    {
      id: "assistant-1",
      content: "I'll help you search for React hooks documentation and calculate that expression.",
      timestamp: new Date(),
      role: "assistant",
      toolCalls: [
        {
          id: "search-1",
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
          function: {
            name: "calculator",
            arguments: JSON.stringify({
              expression: "42 * 17",
            }),
          },
        },
      ],
    },
    {
      id: "tool-search-1",
      role: "tool",
      toolCallId: "search-1",
      content: "Found 5 relevant documentation pages about React hooks including useState, useEffect, and custom hooks.",
    },
    {
      id: "tool-calc-1",
      role: "tool",
      toolCallId: "calc-1",
      content: "714",
    },
  ];

  const renderToolCalls = [
    {
      name: "search",
      args: searchSchema,
      render: SearchToolRender,
    },
    {
      name: "calculator",
      args: calculatorSchema,
      render: CalculatorToolRender,
    },
    {
      name: "*",
      args: z.any(),
      render: WildcardToolRender,
    },
  ];

  return (
    <CopilotKitProvider renderToolCalls={renderToolCalls}>
      <CopilotChatConfigurationProvider threadId={"123}>
        <div style={{ height: "100%" }}>
          <CopilotChatMessageView messages={messages} />
        </div>
      </CopilotChatConfigurationProvider>
    </CopilotKitProvider>
  );
}`,
        language: "tsx",
      },
    },
  },
  decorators: [
    (Story) => (
      <div style={{ height: "100vh", margin: 0, padding: 0, overflow: "auto" }}>
        <Story />
      </div>
    ),
  ],
  render: () => {
    // Global counter shared between calculator instances
    const [globalCounter, setGlobalCounter] = React.useState(0);

    // Define schemas for different tool arguments
    const searchSchema = z.object({
      query: z.string(),
      filters: z.array(z.string()).optional(),
    });

    const calculatorSchema = z.object({
      expression: z.string(),
      variables: z.record(z.number()).optional(),
    });

    // Create render components for different tools
    const SearchToolRender: React.FC<any> = ({ args, status, result }) => (
      <div
        style={{
          padding: "12px",
          margin: "8px 0",
          backgroundColor: status === ToolCallStatus.InProgress ? "#f0f4f8" : "#e6f3ff",
          borderRadius: "8px",
          border: "1px solid #cce0ff",
        }}
      >
        <div style={{ fontWeight: "bold", marginBottom: "4px" }}>🔍 Search Tool</div>
        <div style={{ fontSize: "14px", color: "#666" }}>
          Query: {args?.query}
          {args?.filters && args.filters.length > 0 && <div>Filters: {args.filters.join(", ")}</div>}
        </div>
        {status === ToolCallStatus.InProgress && <div style={{ marginTop: "8px", color: "#0066cc" }}>Searching...</div>}
        {status === ToolCallStatus.Complete && result && (
          <div style={{ marginTop: "8px", color: "#006600" }}>Results: {result}</div>
        )}
      </div>
    );

    const CalculatorToolRender: React.FC<any> = ({ args, status, result }) => {
      const [counter, setCounter] = React.useState(0);

      return (
        <div
          style={{
            padding: "12px",
            margin: "8px 0",
            backgroundColor: status === ToolCallStatus.InProgress ? "#fff9e6" : "#fff4cc",
            borderRadius: "8px",
            border: "1px solid #ffcc66",
          }}
        >
          <div style={{ fontWeight: "bold", marginBottom: "4px" }}>🧮 Calculator</div>
          <div style={{ fontSize: "14px", color: "#666" }}>Expression: {args?.expression}</div>
          {status === ToolCallStatus.InProgress && (
            <div style={{ marginTop: "8px", color: "#cc6600" }}>Calculating...</div>
          )}
          {status === ToolCallStatus.Complete && result && (
            <div style={{ marginTop: "8px", color: "#006600" }}>Result: {result}</div>
          )}
          <div
            style={{
              marginTop: "12px",
              padding: "8px",
              backgroundColor: "#fff8e6",
              borderRadius: "4px",
            }}
          >
            <div style={{ fontSize: "13px", color: "#666", marginBottom: "4px" }}>Local counter: {counter}</div>
            <div style={{ display: "flex", gap: "8px", marginBottom: "8px" }}>
              <button
                onClick={() => setCounter(counter - 1)}
                style={{
                  padding: "4px 12px",
                  backgroundColor: "#ff9933",
                  color: "white",
                  border: "none",
                  borderRadius: "4px",
                  cursor: "pointer",
                }}
              >
                -
              </button>
              <button
                onClick={() => setCounter(counter + 1)}
                style={{
                  padding: "4px 12px",
                  backgroundColor: "#ff9933",
                  color: "white",
                  border: "none",
                  borderRadius: "4px",
                  cursor: "pointer",
                }}
              >
                +
              </button>
            </div>

            <div style={{ borderTop: "1px solid #ffcc66", paddingTop: "8px" }}>
              <div
                style={{
                  fontSize: "13px",
                  color: "#666",
                  marginBottom: "4px",
                  fontWeight: "bold",
                }}
              >
                Global counter: {globalCounter}
              </div>
              <div style={{ display: "flex", gap: "8px" }}>
                <button
                  onClick={() => setGlobalCounter(globalCounter - 1)}
                  style={{
                    padding: "4px 12px",
                    backgroundColor: "#cc6600",
                    color: "white",
                    border: "none",
                    borderRadius: "4px",
                    cursor: "pointer",
                  }}
                >
                  Global -
                </button>
                <button
                  onClick={() => setGlobalCounter(globalCounter + 1)}
                  style={{
                    padding: "4px 12px",
                    backgroundColor: "#cc6600",
                    color: "white",
                    border: "none",
                    borderRadius: "4px",
                    cursor: "pointer",
                  }}
                >
                  Global +
                </button>
              </div>
            </div>
          </div>
        </div>
      );
    };

    // Wildcard render for unmatched tools
    const WildcardToolRender: React.FC<any> = ({ args, status, result }) => (
      <div
        style={{
          padding: "12px",
          margin: "8px 0",
          backgroundColor: "#f5f5f5",
          borderRadius: "8px",
          border: "1px solid #ddd",
        }}
      >
        <div style={{ fontWeight: "bold", marginBottom: "4px" }}>🔧 Tool Execution</div>
        <div style={{ fontSize: "14px", color: "#666" }}>
          <pre>{JSON.stringify(args, null, 2)}</pre>
        </div>
        {status === ToolCallStatus.InProgress && <div style={{ marginTop: "8px", color: "#666" }}>Processing...</div>}
        {status === ToolCallStatus.Complete && result && (
          <div style={{ marginTop: "8px", color: "#333" }}>Output: {result}</div>
        )}
      </div>
    );

    const messages = [
      {
        id: "user-1",
        content:
          "Search for React hooks documentation, calculate 42 * 17 and 100 / 4 + 75, and check the weather in San Francisco",
        timestamp: new Date(),
        role: "user" as const,
      },
      {
        id: "assistant-1",
        content:
          "I'll help you search for React hooks documentation, calculate both expressions, and check the weather.",
        timestamp: new Date(),
        role: "assistant" as const,
        toolCalls: [
          {
            id: "search-1",
            type: "function" as const,
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
            type: "function" as const,
            function: {
              name: "calculator",
              arguments: JSON.stringify({
                expression: "42 * 17",
              }),
            },
          },
          {
            id: "calc-2",
            type: "function" as const,
            function: {
              name: "calculator",
              arguments: JSON.stringify({
                expression: "100 / 4 + 75",
              }),
            },
          },
          {
            id: "weather-1",
            type: "function" as const,
            function: {
              name: "getWeather",
              arguments: '{"location": "San Francisco", "units": "fahren', // Intentionally cut off mid-word
            },
          },
        ],
      },
      {
        id: "tool-search-1",
        role: "tool" as const,
        toolCallId: "search-1",
        content:
          "Found 5 relevant documentation pages about React hooks including useState, useEffect, and custom hooks.",
      },
      {
        id: "tool-calc-1",
        role: "tool" as const,
        toolCallId: "calc-1",
        content: "714",
      },
      {
        id: "tool-calc-2",
        role: "tool" as const,
        toolCallId: "calc-2",
        content: "100",
      },
      {
        id: "tool-weather-1",
        role: "tool" as const,
        toolCallId: "weather-1",
        content: "Current weather in San Francisco: 68°F, partly cloudy with a gentle breeze.",
      },
    ];

    const renderToolCalls = React.useMemo(
      () => [
        {
          name: "search",
          args: searchSchema,
          render: SearchToolRender,
        },
        {
          name: "calculator",
          args: calculatorSchema,
          render: CalculatorToolRender,
        },
        {
          name: "*",
          args: z.any(),
          render: WildcardToolRender,
        },
      ],
      [globalCounter],
    );

    return (
      <CopilotKitProvider renderToolCalls={renderToolCalls} runtimeUrl="https://copilotkit.ai">
        <CopilotChatConfigurationProvider threadId={"123"}>
          <div style={{ height: "100%" }}>
            <CopilotChatMessageView messages={messages} />
          </div>
        </CopilotChatConfigurationProvider>
      </CopilotKitProvider>
    );
  },
};
