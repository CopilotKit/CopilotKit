# CopilotKit React API

This document describes the public surface exported by `@copilotkitnext/react`. The package bundles React providers, hooks, and chat UI components that sit on top of `@copilotkitnext/core` and the AG UI agent runtime. Import UI styles from `@copilotkitnext/react/styles.css` when you render the bundled components.

## Providers

### `CopilotKitProvider`
Creates and owns a `CopilotKitCore` instance that manages agents, frontend tools, and runtime metadata. Props:
- `runtimeUrl?: string` – lazily forwarded to the core after mount (`undefined` during SSR). Update this to retarget the runtime.
- `headers?: Record<string,string>` – request headers forwarded with runtime calls; default `{}`.
- `properties?: Record<string,unknown>` – runtime metadata payload; default `{}`.
- `agents?: Record<string, AbstractAgent>` – preinstantiated agents, keyed by id.
- `renderToolCalls?: ReactToolCallRenderer[]` – static set of tool renderers. The provider expects a stable array identity; changing the structure logs a console error.
- `frontendTools?: ReactFrontendTool[]` – static tool handlers defined up front. Like `renderToolCalls`, the array should be stable.
- `humanInTheLoop?: ReactHumanInTheLoop[]` – declarative human-in-the-loop tool definitions. Each becomes both a tool handler and a tool call renderer.

The provider merges the above into a `CopilotKitCore` instance, keeps render definitions in sync with React state, and exposes them through context. Frontend tools added through hooks (`useFrontendTool`, `useHumanInTheLoop`) are automatically registered and cleaned up.

Render your entire Copilot-enabled tree inside this provider:

```tsx
import { CopilotKitProvider } from "@copilotkitnext/react";

<CopilotKitProvider runtimeUrl={process.env.RUNTIME_URL}>
  <App />
</CopilotKitProvider>
```

### `useCopilotKit`
Context hook that returns:
- `copilotkit: CopilotKitCore` – the live core instance.
- `renderToolCalls: ReactToolCallRenderer[]` – full render list derived from provider props.
- `currentRenderToolCalls: ReactToolCallRenderer[]` – current stateful render list used by `useRenderToolCall`.
- `setCurrentRenderToolCalls` – setter for augmenting renderers (used internally by tooling hooks).

The hook subscribes to runtime load events so components re-render if the core finishes loading or fails to load.

### `CopilotChatConfigurationProvider`
Lightweight provider that exposes localized labels and optional input handlers used by the chat components. Props:
- `labels?: Partial<CopilotChatLabels>` – override copy such as tooltips, placeholder text, and disclaimers.
- `inputValue?: string` – controlled text input value.
- `onSubmitInput?: (value: string) => void` – submit handler for chat text.
- `onChangeInput?: (value: string) => void` – change handler.

The provider merges overrides with `CopilotChatDefaultLabels` and makes the result available through `useCopilotChatConfiguration`. `CopilotChat` and `CopilotChatInput` both consume this context automatically.

### `useCopilotChatConfiguration`
Hook that reads the configuration context. It throws if used outside of `CopilotChatConfigurationProvider`.

## Hooks

### `useAgent({ agentId }?)`
Retrieves a live `AbstractAgent` for the given id (default `DEFAULT_AGENT_ID`) and subscribes to its lifecycle. Returns `{ agent }` (never `undefined`). While the runtime is still syncing, the hook provides a provisional `ProxiedCopilotRuntimeAgent` so UI can optimistically bind and update. Once the runtime syncs, if the agent does not exist, the hook throws an error. The hook forces React updates when the agent changes messages, state, or run status so UI stays in sync.

### `useAgentContext(context)`
Registers a dynamic `Context` object with the active Copilot runtime for the lifetime of the component. The hook adds the context on mount and removes it on unmount; update the incoming `context` object to refresh what the agent sees.

### `useFrontendTool(tool)`
Accepts a `ReactFrontendTool<T>` (a `FrontendTool` with an optional `render` component). The hook:
- Warns if a tool with the same name already exists.
- Registers the tool with CopilotKit on mount.
- Adds the tool’s render component to `currentRenderToolCalls` if provided.
- Cleans up registrations on unmount.

Use this to wire custom client-side tool handlers at component scope.

### `useHumanInTheLoop(tool)`
Wraps `useFrontendTool` for interactive tools that pause agent execution. Expects a `ReactHumanInTheLoop<T>`:
- Provides an internal status machine (`inProgress → executing → complete`).
- Supplies a `respond(result)` callback to the render component while executing.
- Resolves the tool call promise with the caller’s response.

The render component receives consistent shape based on the tool call status so you can drive bespoke UI/UX for human confirmations.

### `useRenderToolCall()`
Returns a renderer function that takes `{ toolCall, toolMessage, isLoading }` and returns a React element or `null`. The hook looks up the first matching render config by name (falling back to a wildcard `"*"` renderer), parses the JSON arguments, and chooses status props:
- `ToolCallStatus.InProgress` when no tool message exists and `isLoading` is true.
- `ToolCallStatus.Complete` with `result` populated when a matching `ToolMessage` exists.

Use this helper to project tool call UI inside chat transcripts.

## Components

### `CopilotChat`
High-level chat container that wires an agent into `CopilotChatView` while providing configuration context. Props:
- Inherits all `CopilotChatViewProps` except `messages` (messages come from the agent).
- `agentId?: string` – agent to drive; defaults to `DEFAULT_AGENT_ID`.
- `threadId?: string` – optional conversation id. Defaults to a random UUID per mount.

`CopilotChat` obtains the agent via `useAgent`, triggers an initial `runAgent` when mounting CopilotKit agents, manages pending state, and auto-clears the input after submission. Override any of the internal slots by passing `CopilotChatView` props.

### `CopilotChatView`
Layout component that combines a scrollable transcript with the input area. Key props:
- `messages?: Message[]` – transcript; defaults to `[]`.
- `autoScroll?: boolean` – toggles stick-to-bottom behavior (default `true`). When `false`, scrolling is manual and a “scroll to bottom” button appears when the user is away from the end.
- Slot overrides:
  - `messageView` (`CopilotChatMessageView`)
  - `scrollView` (wraps the scroll container; defaults to StickToBottom wiring)
  - `scrollToBottomButton` (defaults to a round `ChevronDown` button)
  - `input` (`CopilotChatInput`)
  - `inputContainer` (absolute positioned wrapper around the input)
  - `feather` (gradient overlay above the input)
  - `disclaimer` (footer text under the input)

Slots accept either a replacement component, a className string merged into the default, or partial props to extend the default. Passing a `children` render-prop returns all composed pieces.

### `CopilotChatMessageView`
Renders a list of chat messages and, optionally, a typing cursor while `isLoading` is true. Props:
- `messages?: Message[]`
- `isLoading?: boolean`
- Slot overrides:
  - `assistantMessage` (default `CopilotChatAssistantMessage`)
  - `userMessage` (default `CopilotChatUserMessage`)
  - `cursor` (default pulsing dot via `CopilotChatMessageView.Cursor`)

Provide a render-prop via `children` to take full control over how the message elements array is inserted.

### `CopilotChatAssistantMessage`
Displays assistant messages with Markdown support, tool call rendering, and an action toolbar. Props:
- `message: AssistantMessage` (required)
- `messages?: Message[]` – full transcript so tool calls can find their response messages.
- `isLoading?: boolean` – forwarded to tool call renderers.
- Toolbar callbacks: `onThumbsUp`, `onThumbsDown`, `onReadAloud`, `onRegenerate`.
- `additionalToolbarItems?: React.ReactNode`
- `toolbarVisible?: boolean` (default `true`).
- Slot overrides for the markdown renderer, toolbar, individual buttons, and the tool call panel. By default the Markdown renderer uses `remark-gfm`, `remark-math`, syntax highlighting via `rehype-pretty-code`, and KaTeX support.

The copy, rating, read aloud, and regenerate buttons all derive their tooltip text from `CopilotChatConfigurationProvider` labels and handle clipboard writes as appropriate.

### `CopilotChatUserMessage`
Shows user-authored messages aligned to the right with optional branch navigation. Props:
- `message: UserMessage`
- `onEditMessage?(props)` – invoked when the edit button is pressed.
- `onSwitchToBranch?(props)` – called with the target branch metadata when navigating alternative drafts.
- `branchIndex?: number` and `numberOfBranches?: number` – control branch navigation UI (only rendered when `numberOfBranches > 1` and a switch handler exists).
- `additionalToolbarItems?: React.ReactNode`
- Slots for the message renderer, toolbar container, copy/edit buttons, and branch navigation control.

The default renderer formats messages with `whitespace-pre-wrap`. Toolbar actions surface localized tooltips via `CopilotChatConfigurationProvider`.

### `CopilotChatInput`
Primary text input and control surface. Props:
- `mode?: "input" | "transcribe" | "processing"` (default `"input"`). When set to `"transcribe"`, the audio recorder slot replaces the textarea and transcription controls become visible.
- `toolsMenu?: (ToolsMenuItem | "-")[]` – declarative menu configuration rendered inside the persistent add (`+`) dropdown. Separators insert dividers and nested `items` build submenus.
- `autoFocus?: boolean` (default `true`).
- `onSubmitMessage?(value: string)` – invoked when submitting non-empty text (Enter or the send button). Defaults to the configuration provider’s `onSubmitInput` when available.
- `onStartTranscribe?`, `onCancelTranscribe?`, `onFinishTranscribe?`, `onAddFile?` – optional handlers for the transcription controls and default add menu item.
- `value?: string` & `onChange?(value: string)` – controlled mode (falls back to the configuration provider when omitted).
- Slot overrides for the textarea, send button, add menu button, transcription controls, and audio recorder. Override strings are merged into the default class list via `twMerge`, or pass a custom component to replace the slot entirely.

The default textarea auto-grows up to `maxRows` (default 5). When the text spans multiple rows, the layout automatically stacks the textarea above the control row while keeping the add menu and buttons accessible. The children render prop receives an `isMultiline` flag so custom layouts can react to the same transition.

### `CopilotChatAudioRecorder`
Visual audio waveform stub used during transcription mode. It exposes an imperative API via `ref` with signature `{ state, start(), stop(), dispose() }`:
- `state` always reports `"idle"` (the stub does not track actual recording state).
- `start()` returns a resolved promise without side effects.
- `stop()` resolves to an empty `Blob` of type `audio/webm`.
- `dispose()` performs no cleanup.

Use the exported `AudioRecorderState` union and `AudioRecorderError` class if you provide a real recorder implementation.

### `CopilotChatToolCallsView`
Given an assistant message, renders each of its tool calls using the closest registered tool renderer. It looks up the matching `ToolMessage` inside the provided `messages` list to supply a `result`. When `isLoading` is true and there is no tool response yet, the renderer is invoked with `ToolCallStatus.InProgress`.

## Types and Utilities

- `CopilotChatLabels` – shape of the localized label bundle. Customize by passing overrides to `CopilotChatConfigurationProvider`.
- `CopilotChatConfigurationValue` – public context contract returned by `useCopilotChatConfiguration`.
- `CopilotChatProps`, `CopilotChatViewProps`, `CopilotChatMessageViewProps`, `CopilotChatAssistantMessageProps`, `CopilotChatUserMessageProps`, `CopilotChatInputProps`, `CopilotChatToolCallsViewProps` – exported TypeScript interfaces for component props.
- `ToolsMenuItem` – discriminated union for toolbar menu configuration used by `CopilotChatInput`.
- `AudioRecorderState` and `AudioRecorderError` – helper types for custom audio recorder integrations.

## Styling

All chat components rely on Tailwind utility classes baked into `@copilotkitnext/react/styles.css`. Import the CSS once at the app boundary (after your Tailwind base) to ensure animations, prose styling, and gradients render correctly.

## Usage Checklist

1. Wrap your app with `CopilotKitProvider` to provide agent access and tool registries.
2. Optionally wrap the chat portion with `CopilotChatConfigurationProvider` to override labels or drive controlled inputs.
3. Render `CopilotChat` for an out-of-the-box experience, or compose `CopilotChatView`, `CopilotChatMessageView`, and `CopilotChatInput` manually for deeper customization.
4. Register custom tools with `useFrontendTool` or `useHumanInTheLoop`, and render tool call output with `useRenderToolCall` or `CopilotChatToolCallsView`.
