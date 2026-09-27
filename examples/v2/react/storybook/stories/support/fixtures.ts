/**
 * Shared, deterministic conversation data for stories. Everything here is
 * plain AG-UI messages, so the same fixtures feed presentational views
 * (`messages` props) and the StoryAgent (`initialMessages`).
 */
import type {
  AssistantMessage,
  Message,
  Suggestion,
  ToolMessage,
} from "@copilotkit/react-core/v2";

/** Builds an assistant tool call entry. */
export const toolCall = (
  id: string,
  name: string,
  args: Record<string, unknown> | string,
): NonNullable<AssistantMessage["toolCalls"]>[number] => ({
  id,
  type: "function",
  function: {
    name,
    arguments: typeof args === "string" ? args : JSON.stringify(args),
  },
});

/** Builds the tool message that completes a tool call. */
export const toolResult = (
  toolCallId: string,
  content: string,
): ToolMessage => ({
  id: `result-${toolCallId}`,
  role: "tool",
  toolCallId,
  content,
});

export const reactHooksConversation: Message[] = [
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

/** A single user turn waiting on the assistant. */
export const pendingQuestion: Message[] = [
  {
    id: "user-pending",
    role: "user",
    content: "Can you explain how AI models work?",
  },
];

/** Search + calculator calls in mixed states, plus one tool with no dedicated renderer. */
export const toolCallConversation: Message[] = [
  {
    id: "user-tools",
    role: "user",
    content:
      "Search the React hooks docs, work out 42 × 17 and 100 / 4 + 75, and check the weather in San Francisco.",
  },
  {
    id: "assistant-tools",
    role: "assistant",
    content:
      "I'll search the docs, run both calculations and check the weather.",
    toolCalls: [
      toolCall("search-1", "search", {
        query: "React hooks documentation",
        filters: ["official", "latest"],
      }),
      toolCall("calc-1", "calculator", { expression: "42 * 17" }),
      toolCall("calc-2", "calculator", { expression: "100 / 4 + 75" }),
      toolCall("weather-1", "getWeather", {
        location: "San Francisco",
        units: "fahrenheit",
      }),
    ],
  },
  toolResult(
    "search-1",
    "Found 5 pages covering useState, useEffect, useContext and custom hooks.",
  ),
  toolResult("calc-1", "714"),
  toolResult(
    "weather-1",
    JSON.stringify({ temperature: 68, conditions: "Partly cloudy" }),
  ),
];

/** Tool calls rendered by the built-in default card: one done, one running. */
export const defaultRendererConversation: Message[] = [
  {
    id: "user-default-tools",
    role: "user",
    content: "Find the latest CopilotKit release notes and check npm status.",
  },
  {
    id: "assistant-default-tools",
    role: "assistant",
    content: "I'll check both sources and summarize what I find.",
    toolCalls: [
      toolCall("release-notes-tool", "searchReleaseNotes", {
        query: "CopilotKit release notes",
        includePrereleases: false,
      }),
      toolCall("npm-status-tool", "checkPackageStatus", {
        packageName: "@copilotkit/react-core",
      }),
    ],
  },
  toolResult(
    "release-notes-tool",
    "Found release notes for @copilotkit/react-core and the runtime packages.",
  ),
];

/**
 * One user message answered in several steps (text, a tool call, more text).
 * The steps read as a single reply, so it gets one toolbar by default.
 */
export const multiStepReply: Message[] = [
  {
    id: "multi-user",
    role: "user",
    content: "How many open launch tasks does each team still have?",
  },
  {
    id: "multi-assistant-1",
    role: "assistant",
    content: "Let me pull the latest numbers from the tracker.",
  },
  {
    id: "multi-assistant-2",
    role: "assistant",
    content: "",
    toolCalls: [
      toolCall("multi-tool", "getOpenTasks", { project: "Q3 launch" }),
    ],
  },
  toolResult(
    "multi-tool",
    "engineering: 4, design: 0, marketing: 7, support: 3",
  ),
  {
    id: "multi-assistant-3",
    role: "assistant",
    content:
      "Here's where things stand:\n\n- **Engineering:** 4 open\n- **Design:** done\n- **Marketing:** 7 open\n- **Support:** 3 open\n\nMarketing is the long pole; want me to draft a nudge?",
  },
];

export const shortReasoning =
  "The user wants a launch checklist. I should group the tasks by team, keep each item actionable, and flag the two items that block the launch date.";

export const longReasoning = `Let me break this request down before answering.

1. **Scope** — the user is asking for a migration plan from REST polling to server-sent events. They mentioned a React frontend and an Express backend, so I can assume Node on the server.
2. **Constraints** — they need to keep the old endpoint alive for mobile clients during the transition, which rules out a hard cut-over.
3. **Approach** — the cleanest path is to add an \`/events\` endpoint that streams the same payloads, feature-flag the frontend, and only then deprecate polling.

A few risks worth calling out:

- Proxies that buffer responses will break streaming unless \`X-Accel-Buffering: no\` is set.
- Reconnects need \`Last-Event-ID\` handling, otherwise clients will miss events.
- Load balancers with short idle timeouts will drop long-lived connections; a heartbeat every 15s avoids that.

I'll present the plan as three phases with a short checklist each, then add the risks as a closing note.`;

/** A finished turn with reasoning ahead of the reply. */
export const reasoningConversation: Message[] = [
  {
    id: "user-reasoning",
    role: "user",
    content: "Put together a launch checklist for Friday.",
  },
  {
    id: "reasoning-1",
    role: "reasoning",
    content: shortReasoning,
  },
  {
    id: "assistant-reasoning",
    role: "assistant",
    content: `Here's a checklist grouped by team:

**Engineering**
- Freeze the release branch on Wednesday
- Run the full regression suite *(blocks launch)*

**Marketing**
- Schedule the announcement post
- Final review of the landing page copy *(blocks launch)*

**Support**
- Publish the updated help-center articles`,
  },
];

export const storySuggestions: Suggestion[] = [
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
    isLoading: false,
  },
];

/**
 * Welcome-screen starters: each title is the card header and each message the
 * card body (and what gets sent when picked).
 */
export const starterSuggestions: Suggestion[] = [
  {
    title: "Plan a launch",
    message: "Turn the Q3 goals into a week-by-week launch checklist",
    isLoading: false,
  },
  {
    title: "Summarize a thread",
    message: "Pull the decisions and owners out of a long discussion",
    isLoading: false,
  },
  {
    title: "Draft a reply",
    message: "Write a friendly follow-up to yesterday's design review",
    isLoading: false,
  },
  {
    title: "Explain a concept",
    message: "Walk me through how React hooks manage component state",
    isLoading: false,
  },
];

/** More suggestions than fit in one row, to show the docked bar scrolling. */
export const manySuggestions: Suggestion[] = [
  "Summarize conversation",
  "Draft reply",
  "List next steps",
  "Translate to Spanish",
  "Make it shorter",
  "Add a code example",
  "Explain like I'm five",
  "Create a checklist",
].map((title) => ({ title, message: title, isLoading: false }));

/** Thread records in the shape `CopilotThreadsDrawer` renders. */
const hoursAgo = (hours: number) =>
  new Date(Date.UTC(2026, 8, 25, 12) - hours * 3_600_000).toISOString();

export const storyThreads = [
  { name: "Q3 launch checklist", hours: 0.2 },
  { name: "Migrate polling to SSE", hours: 3 },
  { name: "Pricing page copy review", hours: 26 },
  { name: "Customer interview notes", hours: 50 },
  { name: "Onboarding email sequence", hours: 120 },
  { name: "Hiring plan for design", hours: 300 },
].map(({ name, hours }, index) => ({
  id: `thread-${index + 1}`,
  name,
  archived: false,
  createdAt: hoursAgo(hours + 1),
  updatedAt: hoursAgo(hours),
  lastRunAt: hoursAgo(hours),
}));

/**
 * A reply that walks the streaming cursor through each place it can land:
 * paragraphs, a heading, nested lists, a quote, a code block and a table.
 */
export const streamingCursorReply = `Here's how the cursor follows a reply as it's **written**, block by block.

## A heading

It trails the last word of each paragraph, including [links](https://docs.copilotkit.ai) and \`inline code\`.

- Lists put it after the newest item
- Nested items work too
  - even two levels deep

> Quotes keep it inside the quote.

\`\`\`ts
// Code streams without a cursor, then it picks up again after.
const agent = useAgent({ agentId: "default" });
\`\`\`

| Case | Cursor |
| --- | --- |
| Table cell | After the last cell |

And once the reply finishes, it disappears.`;
