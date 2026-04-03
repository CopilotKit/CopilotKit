# CopilotChat Customization Reference

## CopilotChat Props

`CopilotChat` is the primary chat component. It wraps `CopilotChatView` and handles agent connection, message submission, suggestions, stop, and audio transcription.

```tsx
interface CopilotChatProps {
  // Agent configuration
  agentId?: string;              // Agent to connect to. Default: "default"
  threadId?: string;             // Thread ID. Auto-generated UUID if omitted.

  // Labels and text customization
  labels?: Partial<CopilotChatLabels>;

  // Layout override
  chatView?: SlotValue<typeof CopilotChatView>;

  // Error handling (scoped to this chat's agent)
  onError?: (event: {
    error: Error;
    code: CopilotKitCoreErrorCode;
    context: Record<string, any>;
  }) => void;

  // All CopilotChatViewProps are also accepted (see below)
}
```

## CopilotChatView Props (Layout Slots)

`CopilotChatView` uses a slot-based architecture. Each slot can be:
- Omitted (uses the default component)
- A props object (merges with the default component)
- A custom React component (replaces the default)

```tsx
interface CopilotChatViewProps {
  // Slot overrides
  messageView?: SlotValue<typeof CopilotChatMessageView>;
  scrollView?: SlotValue<typeof CopilotChatView.ScrollView>;
  input?: SlotValue<typeof CopilotChatInput>;
  suggestionView?: SlotValue<typeof CopilotChatSuggestionView>;

  // Welcome screen: true (default), false (disabled), or custom component
  welcomeScreen?: SlotValue<React.FC<WelcomeScreenProps>> | boolean;

  // Data (usually provided by CopilotChat, not set directly)
  messages?: Message[];
  isRunning?: boolean;
  suggestions?: Suggestion[];
  autoScroll?: boolean;          // Default: true

  // Input behavior (usually provided by CopilotChat)
  onSubmitMessage?: (value: string) => void;
  onStop?: () => void;
  inputMode?: "input" | "transcribe" | "processing";
  inputValue?: string;
  onInputChange?: (value: string) => void;

  // Transcription handlers
  onStartTranscribe?: () => void;
  onCancelTranscribe?: () => void;
  onFinishTranscribe?: () => void;
  onFinishTranscribeWithAudio?: (audioBlob: Blob) => Promise<void>;

  // Standard HTML div props
  className?: string;
  // ...rest HTMLAttributes<HTMLDivElement>
}
```

## Labels (Text Customization)

All user-visible text can be customized via the `labels` prop:

```tsx
const CopilotChatDefaultLabels = {
  chatInputPlaceholder: "Type a message...",
  chatInputToolbarStartTranscribeButtonLabel: "Transcribe",
  chatInputToolbarCancelTranscribeButtonLabel: "Cancel",
  chatInputToolbarFinishTranscribeButtonLabel: "Finish",
  chatInputToolbarAddButtonLabel: "Add photos or files",
  chatInputToolbarToolsButtonLabel: "Tools",
  assistantMessageToolbarCopyCodeLabel: "Copy",
  assistantMessageToolbarCopyCodeCopiedLabel: "Copied",
  assistantMessageToolbarCopyMessageLabel: "Copy",
  assistantMessageToolbarThumbsUpLabel: "Good response",
  assistantMessageToolbarThumbsDownLabel: "Bad response",
  assistantMessageToolbarReadAloudLabel: "Read aloud",
  assistantMessageToolbarRegenerateLabel: "Regenerate",
  userMessageToolbarCopyMessageLabel: "Copy",
  userMessageToolbarEditMessageLabel: "Edit",
  chatDisclaimerText: "AI can make mistakes. Please verify important information.",
  chatToggleOpenLabel: "Open chat",
  chatToggleCloseLabel: "Close chat",
  modalHeaderTitle: "CopilotKit Chat",
  welcomeMessageText: "How can I help you today?",
};
```

Example:

```tsx
<CopilotChat
  agentId="myAgent"
  labels={{
    chatInputPlaceholder: "Ask me anything...",
    welcomeMessageText: "Welcome! How can I assist you?",
    modalHeaderTitle: "AI Assistant",
  }}
/>
```

## CopilotPopup Props

```tsx
interface CopilotPopupProps extends CopilotChatProps {
  header?: SlotValue;              // Custom header component
  toggleButton?: SlotValue;        // Custom toggle button
  defaultOpen?: boolean;           // Start open? Default: true
  width?: number | string;         // Popup width
  height?: number | string;        // Popup height
  clickOutsideToClose?: boolean;   // Close on outside click
}
```

## CopilotSidebar Props

```tsx
interface CopilotSidebarProps extends CopilotChatProps {
  header?: SlotValue;              // Custom header component
  toggleButton?: SlotValue;        // Custom toggle button
  defaultOpen?: boolean;           // Start open? Default: true
  width?: number | string;         // Sidebar width
}
```

## Styling

CopilotKit v2 uses Tailwind CSS with a `cpk:` prefix namespace. All internal classes use this prefix to avoid conflicts with your application's styles.

### CSS Data Attributes

The chat container exposes data attributes for CSS targeting:

- `[data-copilotkit]` -- Present on the root chat element.
- `[data-testid="copilot-chat"]` -- The main chat container.
- `[data-copilot-running="true"]` -- While the agent is running.
- `[data-testid="copilot-welcome-screen"]` -- The welcome screen container.
- `[data-sidebar-chat]` -- On sidebar layout wrapper.
- `[data-popup-chat]` -- On popup layout wrapper.

### Dark Mode

The components support dark mode through Tailwind's `dark:` variant. All internal components include `cpk:dark:` color variants. Enable dark mode by adding the `dark` class to a parent element per Tailwind convention.

### Slot-Based Customization

Every visual sub-component is a "slot" that can be replaced or extended:

```tsx
// Override the input component with custom props
<CopilotChat
  input={{ className: "my-custom-input" }}
/>

// Replace the input entirely
<CopilotChat
  input={MyCustomInput}
/>

// Override welcome screen
<CopilotChat
  welcomeScreen={({ input, suggestionView }) => (
    <div className="my-welcome">
      <h1>Hello!</h1>
      {input}
      {suggestionView}
    </div>
  )}
/>

// Disable welcome screen
<CopilotChat welcomeScreen={false} />
```

### CopilotChatView Sub-Components

These can be used directly when building fully custom layouts:

- `CopilotChatView.ScrollView` -- Scroll container with auto-scroll (uses `use-stick-to-bottom`).
- `CopilotChatView.ScrollToBottomButton` -- Floating "scroll to bottom" button.
- `CopilotChatView.Feather` -- Bottom gradient overlay.
- `CopilotChatView.WelcomeScreen` -- Default welcome layout.
- `CopilotChatView.WelcomeMessage` -- Welcome heading text.

### CopilotChatInput Slots

The input component has its own slots:

- `textArea` -- The textarea element.
- `sendButton` -- Send/stop button.
- `startTranscribeButton` -- Microphone button.
- `cancelTranscribeButton` -- Cancel recording button.
- `finishTranscribeButton` -- Finish recording button.
- `addMenuButton` -- File attachment button.
- `audioRecorder` -- Audio recording component.
- `disclaimer` -- Disclaimer text below the input.

## System Prompt / Agent Context

CopilotKit v2 does not have a `systemPrompt` prop on the chat component. Instead, context is provided to agents through:

1. **`useAgentContext`** -- Share structured application data.
2. **Agent configuration** -- System prompts are configured on the agent itself (server-side), not on the React chat component.

## Error Handling

Errors can be handled at two levels:

```tsx
// Provider-level: catches all errors
<CopilotKitProvider
  runtimeUrl="/api/copilotkit"
  onError={({ error, code, context }) => {
    console.error("CopilotKit error:", code, error.message);
  }}
>
  {/* Chat-level: catches errors for this specific agent */}
  <CopilotChat
    agentId="myAgent"
    onError={({ error, code }) => {
      showToast(`Agent error: ${error.message}`);
    }}
  />
</CopilotKitProvider>
```

The chat-level `onError` fires in addition to (not instead of) the provider-level handler. It only receives errors whose `context.agentId` matches the chat's agent.
