# CopilotKit v2 Public API Reference

Package imports: `@copilotkit/react`, `@copilotkit/runtime`, `@copilotkit/core`.

Note: `@copilotkit/react` re-exports everything from `@ag-ui/client` (which itself re-exports `@ag-ui/core`), so applications typically only need `@copilotkit/react` and `@copilotkit/runtime`.

---

## Hooks (`@copilotkit/react`)

### useFrontendTool

```ts
function useFrontendTool<T extends Record<string, unknown>>(
  tool: ReactFrontendTool<T>,
  deps?: ReadonlyArray<unknown>,
): void;
```

Registers a tool that the agent can invoke in the browser. The tool object has these fields:

- `name: string` -- Tool name (must be unique per agentId scope).
- `description?: string` -- Human/model-readable description.
- `parameters?: StandardSchemaV1<any, T>` -- Schema for tool arguments (Zod, Valibot, ArkType, etc.).
- `handler?: (args: T, context: FrontendToolHandlerContext) => Promise<unknown>` -- Function called when the agent invokes the tool.
- `render?: React.ComponentType<...>` -- Optional inline renderer for the tool call in chat.
- `agentId?: string` -- Constrain to a specific agent.
- `available?: boolean` -- Toggle visibility without unregistering. Defaults to `true`.
- `followUp?: boolean` -- Whether the agent should follow up after tool execution.

Re-registers when `tool.name`, `tool.available`, or any value in `deps` changes.

---

### useComponent

```ts
function useComponent<TSchema extends StandardSchemaV1 | undefined = undefined>(
  config: {
    name: string;
    description?: string;
    parameters?: TSchema;
    render: ComponentType<InferRenderProps<TSchema>>;
    agentId?: string;
  },
  deps?: ReadonlyArray<unknown>,
): void;
```

Convenience wrapper around `useFrontendTool`. Registers a React component as a visual tool in chat. The model is told to use the tool to "display the component." Render props are inferred from the `parameters` schema.

---

### useAgentContext

```ts
function useAgentContext(context: AgentContextInput): void;

interface AgentContextInput {
  description: string;
  value: JsonSerializable; // string | number | boolean | null | array | object
}
```

Shares application state with the agent. The `value` is serialized to JSON and registered as context. Context is removed on unmount.

---

### useAgent

```ts
function useAgent(props?: UseAgentProps): { agent: AbstractAgent };

interface UseAgentProps {
  agentId?: string;
  updates?: UseAgentUpdate[];
}

enum UseAgentUpdate {
  OnMessagesChanged = "OnMessagesChanged",
  OnStateChanged = "OnStateChanged",
  OnRunStatusChanged = "OnRunStatusChanged",
}
```

Returns the `AbstractAgent` instance for the given `agentId` (defaults to `"default"`). Subscribes to the specified update categories to trigger re-renders. By default subscribes to all three.

While the runtime is connecting, returns a provisional `ProxiedCopilotRuntimeAgent` to prevent crashes.

---

### useInterrupt

```ts
function useInterrupt<TResult = never, TRenderInChat extends boolean | undefined = undefined>(
  config: UseInterruptConfig<any, TResult, TRenderInChat>,
): React.ReactElement | null | void;

interface UseInterruptConfig<TValue, TResult, TRenderInChat> {
  render: (props: InterruptRenderProps<TValue, TResult | null>) => React.ReactElement;
  handler?: (props: InterruptHandlerProps<TValue>) => TResult | PromiseLike<TResult>;
  enabled?: (event: InterruptEvent<TValue>) => boolean;
  agentId?: string;
  renderInChat?: TRenderInChat; // default: true
}

interface InterruptEvent<TValue = unknown> {
  name: string;
  value: TValue;
}

interface InterruptRenderProps<TValue, TResult> {
  event: InterruptEvent<TValue>;
  result: TResult;
  resolve: (response: unknown) => void;
}
```

Handles agent `on_interrupt` events. When `renderInChat` is `true` (default), the element is published into `<CopilotChat>` and the hook returns `void`. When `false`, it returns the element for manual placement. Call `resolve()` from your render to resume the agent.

---

### useHumanInTheLoop

```ts
function useHumanInTheLoop<T extends Record<string, unknown>>(
  tool: ReactHumanInTheLoop<T>,
  deps?: ReadonlyArray<unknown>,
): void;
```

Registers a tool that pauses agent execution until the user responds. The `render` component receives a `respond` callback during the `"executing"` phase. Built on top of `useFrontendTool` with a promise-based handler.

```ts
type ReactHumanInTheLoop<T> = Omit<FrontendTool<T>, "handler"> & {
  render: React.ComponentType<
    | { status: "inProgress"; args: Partial<T>; respond: undefined }
    | { status: "executing"; args: T; respond: (result: unknown) => Promise<void> }
    | { status: "complete"; args: T; result: string; respond: undefined }
  >;
};
```

---

### useRenderTool

```ts
// Named tool renderer with typed parameters
function useRenderTool<S extends StandardSchemaV1>(
  config: {
    name: string;
    parameters: S;
    render: (props: RenderToolProps<S>) => React.ReactElement;
    agentId?: string;
  },
  deps?: ReadonlyArray<unknown>,
): void;

// Wildcard renderer (fallback for unregistered tools)
function useRenderTool(
  config: {
    name: "*";
    render: (props: any) => React.ReactElement;
    agentId?: string;
  },
  deps?: ReadonlyArray<unknown>,
): void;

type RenderToolProps<S> =
  | { name: string; parameters: Partial<InferSchemaOutput<S>>; status: "inProgress"; result: undefined }
  | { name: string; parameters: InferSchemaOutput<S>; status: "executing"; result: undefined }
  | { name: string; parameters: InferSchemaOutput<S>; status: "complete"; result: string };
```

Registers a visual renderer for tool calls in the chat. Renderers are deduplicated by `agentId:name`. The renderer is intentionally NOT removed on unmount so historical tool calls can still render.

---

### useDefaultRenderTool

```ts
function useDefaultRenderTool(
  config?: { render?: (props: DefaultRenderProps) => React.ReactElement },
  deps?: ReadonlyArray<unknown>,
): void;
```

Registers a wildcard `"*"` renderer via `useRenderTool`. With no arguments, uses the built-in expandable card UI showing tool name, status badge, arguments, and result.

---

### useSuggestions

```ts
function useSuggestions(options?: { agentId?: string }): UseSuggestionsResult;

interface UseSuggestionsResult {
  suggestions: Suggestion[];
  reloadSuggestions: () => void;
  clearSuggestions: () => void;
  isLoading: boolean;
}

type Suggestion = {
  title: string;
  message: string;
  isLoading: boolean;
};
```

Reads the current suggestion list for an agent. Subscribes to real-time updates.

---

### useConfigureSuggestions

```ts
function useConfigureSuggestions(
  config: SuggestionsConfigInput | null | undefined,
  deps?: ReadonlyArray<unknown>,
): void;
```

Registers a suggestion configuration. Two modes:

**Dynamic** (LLM-generated):
```ts
{
  instructions: "Suggest follow-up questions about the data",
  minSuggestions?: number,  // default 1
  maxSuggestions?: number,  // default 3
  available?: "before-first-message" | "after-first-message" | "always" | "disabled",
  providerAgentId?: string,
  consumerAgentId?: string, // default "*"
}
```

**Static**:
```ts
{
  suggestions: [{ title: "...", message: "..." }],
  available?: SuggestionAvailability,
  consumerAgentId?: string,
}
```

---

### useThreads

```ts
function useThreads(input: UseThreadsInput): UseThreadsResult;

interface UseThreadsInput {
  userId: string;
  agentId: string;
}

interface UseThreadsResult {
  threads: Thread[];
  isLoading: boolean;
  error: Error | null;
  renameThread: (threadId: string, name: string) => Promise<void>;
  archiveThread: (threadId: string) => Promise<void>;
  deleteThread: (threadId: string) => Promise<void>;
}

interface Thread {
  id: string;
  name?: string;
  createdAt: string;
  updatedAt: string;
}
```

Lists and manages Intelligence platform threads. Uses a realtime WebSocket subscription when available.

---

### useRenderToolCall (internal)

```ts
function useRenderToolCall(): (props: {
  toolCall: ToolCall;
  toolMessage?: ToolMessage;
}) => React.ReactElement | null;
```

Returns a function that resolves the correct renderer for a tool call. Priority: exact name match (prefer agent-scoped) > wildcard `"*"`.

---

### useRenderActivityMessage (internal)

```ts
function useRenderActivityMessage(): {
  renderActivityMessage: (message: ActivityMessage) => React.ReactElement | null;
  findRenderer: (activityType: string) => ReactActivityMessageRenderer | null;
};
```

Resolves and renders activity messages by type. Matches by `activityType` with agent-scoping, falls back to wildcard `"*"`.

---

### useRenderCustomMessages (internal)

Returns a function to render custom message decorators at `"before"` or `"after"` positions relative to each message.

---

## Components (`@copilotkit/react`)

### CopilotKitProvider

```tsx
<CopilotKitProvider
  runtimeUrl?: string
  headers?: Record<string, string>
  credentials?: RequestCredentials
  publicApiKey?: string          // alias: publicLicenseKey
  properties?: Record<string, unknown>
  agents__unsafe_dev_only?: Record<string, AbstractAgent>
  selfManagedAgents?: Record<string, AbstractAgent>
  renderToolCalls?: ReactToolCallRenderer[]
  renderActivityMessages?: ReactActivityMessageRenderer[]
  renderCustomMessages?: ReactCustomMessageRenderer[]
  frontendTools?: ReactFrontendTool[]
  humanInTheLoop?: ReactHumanInTheLoop[]
  showDevConsole?: boolean | "auto"
  useSingleEndpoint?: boolean
  onError?: (event: { error: Error; code: CopilotKitCoreErrorCode; context: Record<string, any> }) => void
  a2ui?: { theme?: A2UITheme }
>
  {children}
</CopilotKitProvider>
```

Root provider. Configures the runtime connection, registers static tool renderers and tools, and provides the CopilotKit context to all descendant hooks and components.

---

### CopilotChat

```tsx
<CopilotChat
  agentId?: string               // default: "default"
  threadId?: string               // auto-generated if omitted
  labels?: Partial<CopilotChatLabels>
  chatView?: SlotValue<typeof CopilotChatView>
  onError?: (event: { error: Error; code: CopilotKitCoreErrorCode; context: Record<string, any> }) => void
  // Plus all CopilotChatViewProps (messageView, input, suggestionView, welcomeScreen, etc.)
/>
```

Full chat interface. Connects to the agent on mount, handles message submission, suggestion selection, stop, and audio transcription.

---

### CopilotPopup

```tsx
<CopilotPopup
  // All CopilotChat props, plus:
  header?: SlotValue
  toggleButton?: SlotValue
  defaultOpen?: boolean
  width?: number | string
  height?: number | string
  clickOutsideToClose?: boolean
/>
```

Chat in a floating popup with a toggle button.

---

### CopilotSidebar

```tsx
<CopilotSidebar
  // All CopilotChat props, plus:
  header?: SlotValue
  toggleButton?: SlotValue
  defaultOpen?: boolean
  width?: number | string
/>
```

Chat in a collapsible sidebar panel.

---

### CopilotChatView

Headless chat view with a slot-based architecture. Accepts slots for `messageView`, `scrollView`, `input`, `suggestionView`, and `welcomeScreen`. Also exposes sub-components: `CopilotChatView.ScrollView`, `CopilotChatView.Feather`, `CopilotChatView.WelcomeScreen`, `CopilotChatView.WelcomeMessage`, `CopilotChatView.ScrollToBottomButton`.

---

### Other Chat Sub-Components

- `CopilotChatInput` -- Textarea with send, stop, and transcription controls.
- `CopilotChatMessageView` -- Renders the message list.
- `CopilotChatAssistantMessage` -- Single assistant message bubble.
- `CopilotChatUserMessage` -- Single user message bubble.
- `CopilotChatReasoningMessage` -- Reasoning/thinking message display.
- `CopilotChatSuggestionView` -- Renders suggestion pills.
- `CopilotChatSuggestionPill` -- Individual suggestion pill.
- `CopilotChatToolCallsView` -- Renders tool call results in a message.
- `CopilotChatToggleButton` -- Open/close toggle for popup/sidebar.
- `CopilotModalHeader` -- Header bar for popup/sidebar modals.
- `CopilotPopupView` -- Popup layout wrapper.
- `CopilotSidebarView` -- Sidebar layout wrapper.
- `CopilotKitInspector` -- Dev console overlay (controlled by `showDevConsole`).
- `MCPAppsActivityRenderer` -- Built-in renderer for MCP Apps activity messages.
- `WildcardToolCallRender` -- Built-in wildcard tool call renderer component.

---

## Types (`@copilotkit/react`)

### ReactFrontendTool

```ts
type ReactFrontendTool<T> = FrontendTool<T> & {
  render?: ReactToolCallRenderer<T>["render"];
};
```

### ReactToolCallRenderer

```ts
interface ReactToolCallRenderer<T> {
  name: string;
  args: StandardSchemaV1<any, T>;
  agentId?: string;
  render: React.ComponentType<
    | { name: string; args: Partial<T>; status: "inProgress"; result: undefined }
    | { name: string; args: T; status: "executing"; result: undefined }
    | { name: string; args: T; status: "complete"; result: string }
  >;
}
```

### ReactHumanInTheLoop

See `useHumanInTheLoop` above.

### ReactActivityMessageRenderer

```ts
interface ReactActivityMessageRenderer<TActivityContent> {
  activityType: string;    // or "*" for wildcard
  agentId?: string;
  content: StandardSchemaV1<any, TActivityContent>;
  render: React.ComponentType<{
    activityType: string;
    content: TActivityContent;
    message: ActivityMessage;
    agent: AbstractAgent | undefined;
  }>;
}
```

### ToolCallStatus

```ts
enum ToolCallStatus {
  InProgress = "inProgress",
  Executing = "executing",
  Complete = "complete",
}
```

### FrontendToolHandlerContext

```ts
type FrontendToolHandlerContext = {
  toolCall: ToolCall;
  agent: AbstractAgent;
};
```

---

## Runtime (`@copilotkit/runtime`)

See [runtime-api.md](./runtime-api.md) for full runtime reference.
