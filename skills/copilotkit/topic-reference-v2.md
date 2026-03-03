# V2 API Reference

V2 hooks/components references and API-oriented documentation.

## Guidance
### API Reference
- Route: `/reference/v2`
- Source: `docs/content/docs/reference/v2/index.mdx`
- Description: API Reference for the next-generation CopilotKit React API.

The v2 React API (`@copilotkit/react-core/v2`) is the next-generation interface for building copilot-powered applications. It provides a streamlined set of hooks and components built on top of the [AG-UI](https://docs.ag-ui.com) agent protocol.

## Provider Setup

The v2 API uses the [``](/reference/v2/components/CopilotKit) provider. Wrap your application with it to configure the runtime connection:

```tsx
// CopilotKit is imported from the root package, not from the v2 subpackage
import { CopilotKit } from "@copilotkit/react-core";

function App() {
  return (
    <CopilotKit runtimeUrl="/api/copilotkit">
      <YourApp />
    </CopilotKit>
  );
}
```

  `CopilotKitProvider` is a low-level provider intended for advanced use cases. Most applications should use the `` component from `@copilotkit/react-core` instead.

If you need direct control over the v2 provider (e.g. for custom integrations), you can import `CopilotKitProvider` from `@copilotkit/react-core/v2`:

```tsx
import { CopilotKitProvider } from "@copilotkit/react-core/v2";

<CopilotKitProvider runtimeUrl="/api/copilotkit">
  <App />
</CopilotKitProvider>
```

### Props

  URL of the CopilotKit runtime endpoint. Lazily forwarded to the core after mount.

  Request headers forwarded with runtime calls.

  Credentials mode for fetch requests (e.g. `"include"` for HTTP-only cookies in cross-origin requests).

  Copilot Cloud public API key.

  Alias for `publicApiKey`.

  Runtime metadata payload.

  When enabled, all runtime calls use a single endpoint.

  Preinstantiated agents for development/testing. **Not intended for production use.**

  Static set of tool call renderers. The array should be stable across renders.

  Static set of activity message renderers.

  Static set of custom message renderers.

  Static tool handlers defined at the provider level. The array should be stable across renders.

  Declarative human-in-the-loop tool definitions. Each becomes both a tool handler and a tool call renderer.

  Show the CopilotKit developer console for debugging.

## Styling

When using v2 UI components, import the stylesheet once at your app boundary:

```tsx
import "@copilotkit/react-core/v2/styles.css";
```

## API Reference

  Looking for tool rendering hooks? Start with [`useComponent`](/reference/v2/hooks/useComponent), [`useRenderTool`](/reference/v2/hooks/useRenderTool), and [`useDefaultRenderTool`](/reference/v2/hooks/useDefaultRenderTool).

### useAgent
- Route: `/reference/v2/hooks/useAgent`
- Source: `docs/content/docs/reference/v2/hooks/useAgent.mdx`
- Description: React hook for accessing AG-UI agent instances

## Overview

`useAgent` is a React hook that returns an [AG-UI AbstractAgent](https://docs.ag-ui.com/sdk/js/client/abstract-agent) instance. The hook subscribes to agent state changes and triggers re-renders when the agent's state, messages, or execution status changes.

**Throws error** if no agent is configured with the specified `agentId`.

## Signature

```tsx
import { useAgent } from "@copilotkit/react-core/v2";

function useAgent(options?: UseAgentProps): { agent: AbstractAgent }
```

## Parameters

  Configuration object for the hook.

    ID of the agent to retrieve. Must match an agent configured in `CopilotKitProvider`.

    Controls which agent changes trigger component re-renders. Options:
    - `UseAgentUpdate.OnMessagesChanged` - Re-render when messages change
    - `UseAgentUpdate.OnStateChanged` - Re-render when state changes
    - `UseAgentUpdate.OnRunStatusChanged` - Re-render when execution status changes

    Pass an empty array `[]` to prevent automatic re-renders.

## Return Value

  Object containing the agent instance.

    The AG-UI agent instance. See [AbstractAgent documentation](https://docs.ag-ui.com/sdk/js/client/abstract-agent) for full interface details.

    ### Core Properties

      Unique identifier for the agent instance.

      Human-readable description of the agent's purpose.

      Unique identifier for the current conversation thread.

      Array of conversation messages. Each message contains:
      - `id: string` - Unique message identifier
      - `role: "user" | "assistant" | "system"` - Message role
      - `content: string` - Message content

      Shared state object synchronized between application and agent. Both can read and modify this state.

      Indicates whether the agent is currently executing.

    ### Methods

      Manually triggers agent execution.

      **Parameters:**
      - `options.forwardedProps?: any` - Data to pass to the agent execution context

      **Example:**
```tsx
      await agent.runAgent({
        forwardedProps: {
          command: { resume: "user response" }
        }
      });
```

      Updates the shared state. Changes are immediately available to both application and agent.

      **Example:**
```tsx
      agent.setState({
        ...agent.state,
        theme: "dark"
      });
```

      Subscribes to agent events. Returns cleanup function.

      **Subscriber Events:**
      - `onCustomEvent?: ({ event: { name: string, value: any } }) => void` - Custom events
      - `onRunStartedEvent?: () => void` - Agent execution starts
      - `onRunFinalized?: () => void` - Agent execution completes
      - `onStateChanged?: (state: any) => void` - State changes
      - `onMessagesChanged?: (messages: Message[]) => void` - Messages added/modified

      Adds a single message to the conversation and notifies subscribers.

      Adds multiple messages to the conversation and notifies subscribers once.

      Replaces the entire message history with a new array of messages.

      Aborts the currently running agent execution.

      Creates a deep copy of the agent with cloned messages, state, and configuration.

## Usage

### Basic Usage

```tsx
import { useAgent } from "@copilotkit/react-core/v2";

function AgentStatus() {
  const { agent } = useAgent();

  return (
    <div>
      <div>Agent: {agent.agentId}</div>
      <div>Messages: {agent.messages.length}</div>
      <div>Running: {agent.isRunning ? "Yes" : "No"}</div>
    </div>
  );
}
```

### Accessing and Updating State

```tsx
import { useAgent } from "@copilotkit/react-core/v2";

function StateController() {
  const { agent } = useAgent();

  return (
    <div>
      <pre>{JSON.stringify(agent.state, null, 2)}</pre>
      <button onClick={() => agent.setState({ ...agent.state, count: 1 })}>
        Update State
      </button>
    </div>
  );
}
```

### Event Subscription

```tsx
import { useEffect } from "react";
import { useAgent } from "@copilotkit/react-core/v2";

function EventListener() {
  const { agent } = useAgent();

  useEffect(() => {
    const { unsubscribe } = agent.subscribe({
      onRunStartedEvent: () => console.log("Started"),
      onRunFinalized: () => console.log("Finished"),
    });

    return unsubscribe;
  }, []);

  return null;
}
```

### Multiple Agents

```tsx
import { useAgent } from "@copilotkit/react-core/v2";

function MultiAgentView() {
  const { agent: primary } = useAgent({ agentId: "primary" });
  const { agent: support } = useAgent({ agentId: "support" });

  return (
    <div>
      <div>Primary: {primary.messages.length} messages</div>
      <div>Support: {support.messages.length} messages</div>
    </div>
  );
}
```

### Optimizing Re-renders

```tsx
import { useAgent, UseAgentUpdate } from "@copilotkit/react-core/v2";

// Only re-render when messages change
function MessageCount() {
  const { agent } = useAgent({
    updates: [UseAgentUpdate.OnMessagesChanged]
  });

  return <div>Messages: {agent.messages.length}</div>;
}
```

## Behavior

- **Automatic Re-renders**: Component re-renders when agent state, messages, or execution status changes (configurable via `updates` parameter)
- **Error Handling**: Throws error if no agent exists with specified `agentId`
- **State Synchronization**: State updates via `setState()` are immediately available to both app and agent
- **Event Subscriptions**: Subscribe/unsubscribe pattern for lifecycle and custom events

## Related

- [AG-UI AbstractAgent](https://docs.ag-ui.com/sdk/js/client/abstract-agent) - Full agent interface documentation

### useFrontendTool
- Route: `/reference/v2/hooks/useFrontendTool`
- Source: `docs/content/docs/reference/v2/hooks/useFrontendTool.mdx`
- Description: React hook for registering client-side tool handlers with optional UI rendering

## Overview

`useFrontendTool` registers a client-side tool with CopilotKit at component scope. When the agent decides to call the tool, the provided `handler` function executes in the browser. Optionally, you can supply a `render` component to display custom UI in the chat showing the tool's execution progress and results.

The hook manages the full registration lifecycle: it warns if a tool with the same name already exists, registers the tool and its render component on mount, and cleans up both registrations on unmount. In v2, parameter schemas are defined using [Zod](https://zod.dev) instead of plain parameter arrays.

## Signature

```tsx
import { useFrontendTool } from "@copilotkit/react-core/v2";

function useFrontendTool<T extends Record<string, unknown>>(
  tool: ReactFrontendTool<T>,
  deps?: ReadonlyArray<unknown>,
): void;
```

## Parameters

  The tool definition object.

    A unique name for the tool. The agent references this name when deciding to call the tool. If a tool with this name is already registered, a warning is logged.

    A natural-language description that tells the agent what the tool does and when to use it.

    A Zod schema defining the tool's input parameters. The schema is used for both validation and type inference.

    An async function that executes when the agent calls the tool. Receives the validated, typed arguments and should return a string result that is sent back to the agent.

    An optional React component rendered in the chat interface to visualize tool execution. The component receives:
    - `name` -- the tool name
    - `args` -- the arguments (partial while streaming, complete once execution starts)
    - `status` -- one of `ToolCallStatus.InProgress`, `ToolCallStatus.Executing`, or `ToolCallStatus.Complete`
    - `result` -- the string result returned by the handler (only available when status is `Complete`)

    Controls tool availability. Set to `"disabled"` to temporarily prevent the agent from calling the tool, or `"remote"` to indicate the tool is handled server-side.

  An optional dependency array, similar to `useEffect`. When provided, the tool registration is refreshed whenever any value in the array changes. Use this when your handler or render function captures external state.

## Usage

### Basic Tool with Zod Parameters

```tsx
import { z } from "zod";
import { useFrontendTool } from "@copilotkit/react-core/v2";

function TodoManager() {
  const [todos, setTodos] = useState<string[]>([]);

  useFrontendTool({
    name: "addTodo",
    description: "Add a new item to the user's todo list",
    parameters: z.object({
      text: z.string().describe("The todo item text"),
      priority: z.enum(["low", "medium", "high"]).describe("Priority level"),
    }),
    handler: async ({ text, priority }) => {
      setTodos((prev) => [...prev, text]);
      return `Added "${text}" with ${priority} priority`;
    },
  }, []);

  return <ul>{todos.map((t, i) => <li key={i}>{t}</li>)}</ul>;
}
```

### Tool with Custom Render Component

```tsx
import { z } from "zod";
import { useFrontendTool, ToolCallStatus } from "@copilotkit/react-core/v2";

function WeatherWidget() {
  useFrontendTool({
    name: "getWeather",
    description: "Fetch and display weather information for a city",
    parameters: z.object({
      city: z.string().describe("City name"),
      units: z.enum(["celsius", "fahrenheit"]).default("celsius"),
    }),
    handler: async ({ city, units }) => {
      const response = await fetch(`/api/weather?city=${city}&units=${units}`);
      const data = await response.json();
      return JSON.stringify(data);
    },
    render: ({ args, status, result }) => {
      if (status === ToolCallStatus.InProgress) {
        return <div className="animate-pulse">Fetching weather for {args.city}...</div>;
      }
      if (status === ToolCallStatus.Complete && result) {
        const data = JSON.parse(result);
        return (
          <div className="p-4 border rounded">
            <h3>{data.city}</h3>
            <p>{data.temperature}&deg; {data.units}</p>
            <p>{data.conditions}</p>
          </div>
        );
      }
      return null;
    },
  }, []);

  return null;
}
```

### Conditionally Available Tool

```tsx
import { z } from "zod";
import { useFrontendTool } from "@copilotkit/react-core/v2";

function AdminPanel({ isAdmin }: { isAdmin: boolean }) {
  useFrontendTool({
    name: "deleteUser",
    description: "Delete a user account by ID (admin only)",
    parameters: z.object({
      userId: z.string().describe("The ID of the user to delete"),
    }),
    handler: async ({ userId }) => {
      await fetch(`/api/users/${userId}`, { method: "DELETE" });
      return `User ${userId} deleted`;
    },
    available: isAdmin ? "enabled" : "disabled",
  }, [isAdmin]);

  return <div>{/* admin UI */}</div>;
}
```

## Behavior

- **Duplicate detection**: If a tool with the same `name` is already registered, the hook logs a warning. Only one tool per name is active at a time.
- **Mount/Unmount lifecycle**: The tool and its optional render component are registered on mount and removed on unmount.
- **Dependency tracking**: When `deps` is provided, the tool registration is refreshed whenever any dependency value changes, similar to `useEffect`.
- **Render component lifecycle**: If a `render` function is provided, it is added to the internal render tool calls registry. It receives streaming `args` (partial during `InProgress`, complete during `Executing` and `Complete`).
- **No return value**: The hook returns `void`.

## Related

- [`useHumanInTheLoop`](/reference/v2/hooks/useHumanInTheLoop) -- for tools that pause execution and wait for user input
- [`useRenderToolCall`](/reference/v2/hooks/useRenderToolCall) -- for rendering backend tool calls without a client-side handler
- [`useComponent`](/reference/v2/hooks/useComponent) -- convenience wrapper for rendering React components from tool args
- [`useRenderTool`](/reference/v2/hooks/useRenderTool) -- register renderer-only tool call UI (named or wildcard)
- [`useCopilotAction`](/reference/v1/hooks/useCopilotAction) -- v1 equivalent

### useAgentContext
- Route: `/reference/v2/hooks/useAgentContext`
- Source: `docs/content/docs/reference/v2/hooks/useAgentContext.mdx`
- Description: React hook for providing dynamic context to agents

## Overview

`useAgentContext` registers a dynamic context object with the active Copilot runtime for the lifetime of the component. The hook adds the context on mount and removes it on unmount, so the agent always sees an up-to-date snapshot of your application state without manual cleanup.

Update the incoming context object to refresh what the agent sees. This is the v2 equivalent of `useCopilotReadable` -- it lets you surface any serializable application state (user preferences, selected items, computed values, etc.) as context that agents can reference when generating responses or making decisions.

## Signature

```tsx
import { useAgentContext } from "@copilotkit/react-core/v2";

function useAgentContext(context: AgentContextInput): void;
```

## Parameters

  An object describing the context to expose to the agent.

    A human-readable description of the context. The agent uses this to understand what the value represents and when to reference it.

    The context value to provide. Must be JSON-serializable: `string`, `number`, `boolean`, `null`, arrays, or plain objects with string keys and serializable values. Object values are serialized automatically.

## Usage

### Basic Usage

Provide simple application state as context for the agent.

```tsx
import { useAgentContext } from "@copilotkit/react-core/v2";

function UserGreeting({ user }: { user: { name: string; role: string } }) {
  useAgentContext({
    description: "The currently logged-in user",
    value: { name: user.name, role: user.role },
  });

  return <div>Welcome, {user.name}</div>;
}
```

### Dynamic Context from Component State

The context updates automatically when the value changes between renders.

```tsx
import { useState } from "react";
import { useAgentContext } from "@copilotkit/react-core/v2";

function ProductCatalog() {
  const [selectedCategory, setSelectedCategory] = useState("electronics");
  const [priceRange, setPriceRange] = useState({ min: 0, max: 500 });

  useAgentContext({
    description: "The user's current product filter settings",
    value: {
      category: selectedCategory,
      priceRange,
    },
  });

  return (
    <div>
      <select
        value={selectedCategory}
        onChange={(e) => setSelectedCategory(e.target.value)}
      >
        <option value="electronics">Electronics</option>
        <option value="books">Books</option>
        <option value="clothing">Clothing</option>
      </select>
      {/* ... price range controls ... */}
    </div>
  );
}
```

### Multiple Contexts in Nested Components

Each component can register its own context. All registered contexts are visible to the agent simultaneously.

```tsx
import { useAgentContext } from "@copilotkit/react-core/v2";

function Dashboard() {
  useAgentContext({
    description: "Current dashboard view and layout",
    value: { view: "analytics", columns: 3 },
  });

  return (
    <div>
      <Sidebar />
      <MainPanel />
    </div>
  );
}

function Sidebar() {
  const [collapsed, setCollapsed] = useState(false);

  useAgentContext({
    description: "Sidebar navigation state",
    value: { collapsed, activeSection: "reports" },
  });

  return <nav>{/* ... */}</nav>;
}
```

## Behavior

- **Mount/Unmount lifecycle**: The context is registered when the component mounts and automatically removed when it unmounts. There is no manual cleanup required.
- **Reactive updates**: When the `context` object changes between renders, the agent immediately sees the updated value.
- **Serialization**: The `value` must conform to `JsonSerializable` (`string | number | boolean | null | JsonSerializable[] | { [key: string]: JsonSerializable }`). Non-serializable values such as functions, class instances, or symbols will cause errors.
- **Multiple contexts**: Multiple `useAgentContext` calls across your component tree are all visible to the agent concurrently. Each is identified by its description and value.
- **No return value**: The hook returns `void`. Unlike `useCopilotReadable`, it does not return an ID for parent-child hierarchies.

## Related

- [`useCopilotReadable`](/reference/v1/hooks/useCopilotReadable) -- v1 equivalent for providing context

### CopilotChat
- Route: `/reference/v2/components/CopilotChat`
- Source: `docs/content/docs/reference/v2/components/CopilotChat.mdx`
- Description: High-level chat component that connects an agent to a chat view

## Overview

`CopilotChat` is a high-level chat container that wires an agent into `CopilotChatView` while providing configuration context. It obtains the agent via `useAgent`, triggers an initial `runAgent` when mounting CopilotKit agents, manages pending state, and auto-clears the input after submission. Override any of the internal slots by passing `CopilotChatView` props directly.

`CopilotChat` manages messages, running state, and suggestions automatically -- you only need to specify which agent to connect and, optionally, customise labels or slot overrides.

## Import

```tsx
import { CopilotChat } from "@copilotkit/react-core/v2";
import "@copilotkit/react-core/v2/styles.css";
```

## Props

### Own Props

  ID of the agent to use. Must match an agent configured in `CopilotKitProvider`. Defaults to the provider-level default agent when omitted.

  ID of the conversation thread. Pass a specific thread ID to resume an existing conversation or let the agent create a new one.

  Partial label overrides for all text strings rendered inside the chat (input placeholder, toolbar buttons, disclaimer text, etc.). Any label you omit falls back to the built-in default.

  Slot override for the inner `CopilotChatView` component. Accepts a replacement component, a `className` string merged into the default, or a partial props object to extend the default.

  When used inside `CopilotPopup` or `CopilotSidebar`, controls whether the modal starts in the open state. Stored in the chat configuration context so child components can read it.

### Inherited CopilotChatView Props

`CopilotChat` accepts all props from [`CopilotChatViewProps`](/reference/v2/components/CopilotChatView) **except** `messages`, `isRunning`, `suggestions`, `suggestionLoadingIndexes`, and `onSelectSuggestion`, which are managed internally by the agent connection.

This means you can pass slot overrides such as `messageView`, `input`, `scrollView`, `inputContainer`, `feather`, `disclaimer`, `suggestionView`, and `welcomeScreen` directly to `CopilotChat`.

  Whether the chat scrolls to the bottom automatically when new messages arrive.

  Additional props forwarded to the inner `CopilotChatInput` component. Use this to configure auto-focus, custom submission handlers, transcription callbacks, or tools menus.

  Controls the welcome screen shown when no messages exist. Pass `true` for the default, `false` to disable, a `className` to style the default, or a replacement component.

## Slot System

All slot props inherited from `CopilotChatView` follow the same override pattern. Each slot accepts one of three value types:

| Value | Behavior |
|-------|----------|
| **Component** | Replaces the default component entirely. Receives the same props the default would. |
| **`className` string** | Merged into the default component's class list via `twMerge`. |
| **Partial props object** | Spread into the default component as additional or overriding props. |

Additionally, a `children` render-prop can be used to receive all composed slot elements and arrange them in a custom layout.

## Usage

### Basic Usage

```tsx
import { CopilotChat } from "@copilotkit/react-core/v2";
import "@copilotkit/react-core/v2/styles.css";

function App() {
  return (
    <CopilotChat
      agentId="my-agent"
      labels={{ chatInputPlaceholder: "Ask me anything..." }}
    />
  );
}
```

### Custom Welcome Screen

```tsx
import { CopilotChat } from "@copilotkit/react-core/v2";
import "@copilotkit/react-core/v2/styles.css";

function App() {
  return (
    <CopilotChat
      agentId="my-agent"
      welcomeScreen={({ input, suggestionView }) => (
        <div className="flex flex-col items-center justify-center h-full gap-4">
          <h2>Welcome to the assistant</h2>
          {suggestionView}
          {input}
        </div>
      )}
    />
  );
}
```

### Overriding the Chat View Slot

```tsx
import { CopilotChat } from "@copilotkit/react-core/v2";
import "@copilotkit/react-core/v2/styles.css";

function App() {
  return (
    <CopilotChat
      agentId="my-agent"
      chatView="bg-gray-50 rounded-xl shadow-lg"
    />
  );
}
```

## Behavior

- **Agent wiring**: On mount, `CopilotChat` calls `useAgent` with the provided `agentId` and binds the agent's `messages`, `isRunning`, and suggestion state to `CopilotChatView`.
- **Initial run**: If the agent has not been run yet, `CopilotChat` triggers `runAgent` automatically so the agent can send an initial greeting or set up state.
- **Auto-clear input**: After a message is submitted, the input field is cleared automatically.
- **Configuration context**: Wraps children in `CopilotChatConfigurationProvider`, making `labels`, `agentId`, `threadId`, and modal state available to all descendant components via `useCopilotChatConfiguration`.
- **Suggestion management**: Subscribes to the agent's suggestion system and passes suggestions, loading states, and selection callbacks down to `CopilotChatView`.

## Related

- [`CopilotChatView`](/reference/v2/components/CopilotChatView) -- the layout component used internally
- [`CopilotPopup`](/reference/v2/components/CopilotPopup) -- popup variant of `CopilotChat`
- [`CopilotSidebar`](/reference/v2/components/CopilotSidebar) -- sidebar variant of `CopilotChat`
- [`useAgent`](/reference/v2/hooks/useAgent) -- hook used internally to access the agent

### CopilotSidebar
- Route: `/reference/v2/components/CopilotSidebar`
- Source: `docs/content/docs/reference/v2/components/CopilotSidebar.mdx`
- Description: Sidebar variant of CopilotChat that renders in a fixed side panel

## Overview

`CopilotSidebar` renders a fixed sidebar panel for chat interaction. It wraps [`CopilotChat`](/reference/v2/components/CopilotChat) and provides sidebar-specific layout and open/close behavior. The sidebar includes a header with a title and close button, and can be toggled via a floating button.

See [`CopilotPopup`](/reference/v2/components/CopilotPopup) for a popup variant of this component.

## Import

```tsx
import { CopilotSidebar } from "@copilotkit/react-core/v2";
import "@copilotkit/react-core/v2/styles.css";
```

## Props

### Own Props

  Slot override for the sidebar header. Accepts a replacement component, a `className` string merged into the default, or a partial props object. The default header displays a title and a close button.

  Whether the sidebar should be open when the component first mounts.

  Width of the sidebar panel. Accepts a number (pixels) or a CSS string (e.g. `"400px"`, `"30vw"`).

### Inherited CopilotChat Props

`CopilotSidebar` accepts all props from [`CopilotChatProps`](/reference/v2/components/CopilotChat) **except** `chatView`, which is set internally to `CopilotSidebarView`. This includes:

  ID of the agent to use. Must match an agent configured in `CopilotKitProvider`.

  ID of the conversation thread.

  Partial label overrides for all text strings rendered inside the chat.

  Whether the chat scrolls to the bottom automatically when new messages arrive.

  Additional props forwarded to the inner `CopilotChatInput` component.

  Controls the welcome screen shown when no messages exist.

All `CopilotChatView` slot props (`messageView`, `input`, `scrollView`, `inputContainer`, `feather`, `disclaimer`, `suggestionView`) are also accepted and forwarded through.

## Slot System

All slot props follow the same override pattern used across CopilotKit v2 components. Each slot accepts one of three value types:

| Value | Behavior |
|-------|----------|
| **Component** | Replaces the default component entirely. Receives the same props the default would. |
| **`className` string** | Merged into the default component's class list via `twMerge`. |
| **Partial props object** | Spread into the default component as additional or overriding props. |

## Usage

### Basic Usage

```tsx
import { CopilotSidebar } from "@copilotkit/react-core/v2";
import "@copilotkit/react-core/v2/styles.css";

function App() {
  return (
    <CopilotSidebar
      agentId="my-agent"
      labels={{ modalHeaderTitle: "Assistant" }}
    />
  );
}
```

### Default Open with Custom Width

```tsx
import { CopilotSidebar } from "@copilotkit/react-core/v2";
import "@copilotkit/react-core/v2/styles.css";

function App() {
  return (
    <CopilotSidebar
      agentId="my-agent"
      defaultOpen={true}
      width={500}
    />
  );
}
```

### Custom Header

```tsx
import { CopilotSidebar } from "@copilotkit/react-core/v2";
import "@copilotkit/react-core/v2/styles.css";

function App() {
  return (
    <CopilotSidebar
      agentId="my-agent"
      header="bg-indigo-700 text-white"
    />
  );
}
```

## Behavior

- **Toggle button**: Renders a floating toggle button that opens and closes the sidebar. The button uses `CopilotChatToggleButton` internally.
- **Modal state**: Open/close state is managed via the chat configuration context. The `defaultOpen` prop sets the initial state; after that, state changes come from user interaction (toggle button, close button in the header).
- **Layout**: The sidebar uses `CopilotSidebarView` internally, which provides a sidebar-specific welcome screen layout with suggestions at the top, the welcome message in the middle, and the input fixed at the bottom.
- **Fixed positioning**: The sidebar renders as a fixed panel on one side of the viewport, pushing or overlaying content depending on CSS.
- **Agent connection**: All agent wiring (messages, running state, suggestions) is handled by the parent `CopilotChat` logic.

## Related

- [`CopilotChat`](/reference/v2/components/CopilotChat) -- the base chat component used internally
- [`CopilotPopup`](/reference/v2/components/CopilotPopup) -- popup variant
- [`CopilotChatView`](/reference/v2/components/CopilotChatView) -- the layout component used internally
