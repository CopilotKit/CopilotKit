# ADK Integration

CopilotKit implementation guide for ADK.

## Guidance
### Copilot Runtime
- Route: `/adk/copilot-runtime`
- Source: `docs/content/docs/integrations/adk/copilot-runtime.mdx`
- Description: The Copilot Runtime is the backend that connects your frontend to your AI agents, providing authentication, middleware, routing, and more.

The Copilot Runtime is the backend layer that connects your frontend application to your AI agents. It's set up during the [quickstart](/quickstart) and is the recommended way to use CopilotKit.

## Setting Up the Runtime

The runtime is a lightweight server endpoint that you add to your backend. Here's a minimal example using Next.js:

```ts title="app/api/copilotkit/route.ts"
import {
  CopilotRuntime,
  ExperimentalEmptyAdapter,
  copilotRuntimeNextJSAppRouterEndpoint,
} from "@copilotkit/runtime";
import { NextRequest } from "next/server";

const serviceAdapter = new ExperimentalEmptyAdapter();

const runtime = new CopilotRuntime({
  agents: {
    // your agents go here
  },
});

export const POST = async (req: NextRequest) => {
  const { handleRequest } = copilotRuntimeNextJSAppRouterEndpoint({
    runtime,
    serviceAdapter,
    endpoint: "/api/copilotkit",
  });

  return handleRequest(req);
};
```

Then point your frontend at the endpoint:

```tsx
<CopilotKit runtimeUrl="/api/copilotkit">
  <YourApp />
</CopilotKit>
```

For setup with other backend frameworks (Express, NestJS, Node.js HTTP), see the [quickstart](/quickstart).

## What the Runtime Provides

### Authentication and Security

The runtime runs on your server, which means agent communication stays server-side. This gives you a trusted environment to enforce authentication, validate requests, and keep API keys secure. When you use the runtime, safe defaults are put in place so your agent endpoints are not exposed to unauthenticated access.

### AG-UI Middleware

The [AG-UI protocol](/ag-ui-protocol) supports a middleware layer (`agent.use`) for logging, guardrails, request transformation, and more. Because the runtime runs server-side, this middleware executes in a trusted environment where it cannot be tampered with by the client.

### Agent Routing

When you register multiple agents with the runtime, it handles discovery and routing automatically. Your frontend doesn't need to know the details of where each agent lives or how to reach it.

### Premium Features

Features like [threads](/premium/threads), [observability](/premium/observability), and the [inspector](/premium/inspector) are provided through the runtime. These give you conversation persistence, monitoring, and debugging capabilities out of the box.

## What If I Want to Connect to My AG-UI Agent Directly?

CopilotKit is built on the [AG-UI protocol](/ag-ui-protocol), which is an open standard. If you want to connect your frontend directly to an AG-UI-compatible agent without the runtime, you can do so by passing agent instances directly to the `CopilotKit` provider:

```tsx
import { HttpAgent } from "@ag-ui/client";

const myAgent = new HttpAgent({
  url: "https://my-agent.example.com",
});

<CopilotKit agents__unsafe_dev_only={{ "my-agent": myAgent }}>
  <YourApp />
</CopilotKit>
```

Direct agent connections are intended for development and prototyping. This approach is not recommended for production unless you are confident in your setup, and is not officially supported by CopilotKit. If you run into issues with a direct connection, you will need to troubleshoot on your own.

There are important things to understand before going this route:

1. **Authentication is your responsibility.** When you use the Copilot Runtime, safe defaults are put in place so that your agent endpoints are not exposed to unauthenticated access. When you connect directly, it is entirely up to you to secure your agent endpoint and manage authentication.

2. **Many ecosystem features won't work.** The AG-UI protocol supports a middleware layer designed to run on the backend. Many features in the CopilotKit ecosystem depend on this server-side middleware. Without the runtime, these features — including [threads](/premium/threads), [observability](/premium/observability), and other capabilities — will not be available.

### Comparison

| | With Runtime | Direct Connection |
|---|---|---|
| **Authentication** | Safe defaults provided | You manage it |
| **AG-UI Middleware** | Runs server-side | Not available |
| **Agent Routing** | Automatic | Manual |
| **Ecosystem Features** | Full support | Limited |
| **CopilotKit Support** | Supported | Not supported |
| **Setup** | Requires a backend endpoint | Frontend-only |

### Custom Sub-Components
- Route: `/adk/custom-look-and-feel/bring-your-own-components`
- Source: `docs/content/docs/integrations/adk/custom-look-and-feel/bring-your-own-components.mdx`

```tsx
import { type UserMessageProps } from "@copilotkit/react-ui";
import { CopilotKit } from "@copilotkit/react-core";
import { CopilotSidebar } from "@copilotkit/react-ui";
import "@copilotkit/react-ui/styles.css";

const CustomUserMessage = (props: UserMessageProps) => {
  const wrapperStyles = "flex items-center gap-2 justify-end mb-4";
  const messageStyles = "bg-blue-500 text-white py-2 px-4 rounded-xl break-words flex-shrink-0 max-w-[80%]";
  const avatarStyles = "bg-blue-500 shadow-sm min-h-10 min-w-10 rounded-full text-white flex items-center justify-center";

  return (
    <div className={wrapperStyles}>
      <div className={messageStyles}>{props.message?.content}</div>
      <div className={avatarStyles}>TS</div>
    </div>
  );
};

<CopilotKit>
  <CopilotSidebar UserMessage={CustomUserMessage} />
</CopilotKit>
```
```tsx
import { type AssistantMessageProps } from "@copilotkit/react-ui";
import { useChatContext } from "@copilotkit/react-ui";
import { Markdown } from "@copilotkit/react-ui";
import { SparklesIcon } from "@heroicons/react/24/outline";

import { CopilotKit } from "@copilotkit/react-core";
import { CopilotSidebar } from "@copilotkit/react-ui";
import "@copilotkit/react-ui/styles.css";

const CustomAssistantMessage = (props: AssistantMessageProps) => {
  const { icons } = useChatContext();
  const { message, isLoading, subComponent } = props;

  const avatarStyles = "bg-zinc-400 border-zinc-500 shadow-lg min-h-10 min-w-10 rounded-full text-white flex items-center justify-center";
  const messageStyles = "px-4 rounded-xl pt-2";

  const avatar = <div className={avatarStyles}><SparklesIcon className="h-6 w-6" /></div>

  // [!code highlight:12]
  return (
    <div className="py-2">
      <div className="flex items-start">
        {!subComponent && avatar}
        <div className={messageStyles}>
          {message && <Markdown content={message.content || ""} /> }
          {isLoading && icons.spinnerIcon}
        </div>
      </div>
      <div className="my-2">{subComponent}</div>
    </div>
  );
};

<CopilotKit>
  <CopilotSidebar AssistantMessage={CustomAssistantMessage} />
</CopilotKit>
```
```tsx
import { type WindowProps, useChatContext, CopilotSidebar } from "@copilotkit/react-ui";
import { CopilotKit } from "@copilotkit/react-core";
import "@copilotkit/react-ui/styles.css";
function Window({ children }: WindowProps) {
  const { open, setOpen } = useChatContext();

  if (!open) return null;

  // [!code highlight:15]
  return (
    <div 
      className="fixed inset-0 bg-black/50 flex items-center justify-center p-4"
      onClick={() => setOpen(false)}
    >
      <div 
        className="bg-white rounded-lg shadow-xl max-w-2xl w-full h-[80vh] overflow-auto"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex flex-col h-full">
          {children}
        </div>
      </div>
    </div>
  );
};

<CopilotKit>
  <CopilotSidebar Window={Window} />
</CopilotKit>
```
```tsx
import { type ButtonProps, useChatContext, CopilotSidebar } from "@copilotkit/react-ui";
import { CopilotKit } from "@copilotkit/react-core";
import "@copilotkit/react-ui/styles.css";
function Button({}: ButtonProps) {
  const { open, setOpen } = useChatContext();

  const wrapperStyles = "w-24 bg-blue-500 text-white p-4 rounded-lg text-center cursor-pointer";

  // [!code highlight:10]
  return (
    <div onClick={() => setOpen(!open)} className={wrapperStyles}>
      <button
        className={`${open ? "open" : ""}`}
        aria-label={open ? "Close Chat" : "Open Chat"}
      >
        Ask AI
      </button>
    </div>
  );
};

<CopilotKit>
  <CopilotSidebar Button={Button} />
</CopilotKit>
```
```tsx
import { type HeaderProps, useChatContext, CopilotSidebar } from "@copilotkit/react-ui";
import { BookOpenIcon } from "@heroicons/react/24/outline";
import { CopilotKit } from "@copilotkit/react-core";
import "@copilotkit/react-ui/styles.css";
function Header({}: HeaderProps) {
  const { setOpen, icons, labels } = useChatContext();

  // [!code highlight:15]
  return (
    <div className="flex justify-between items-center p-4 bg-blue-500 text-white">
      <div className="w-24">
        <a href="/">
          <BookOpenIcon className="w-6 h-6" />
        </a>
      </div>
      <div className="text-lg">{labels.title}</div>
      <div className="w-24 flex justify-end">
        <button onClick={() => setOpen(false)} aria-label="Close">
          {icons.headerCloseIcon}
        </button>
      </div>
    </div>
  );
};

<CopilotKit>
  <CopilotSidebar Header={Header} />
</CopilotKit>
```
```tsx
import { type MessagesProps, CopilotSidebar } from "@copilotkit/react-ui";
import { CopilotKit } from "@copilotkit/react-core";
import "@copilotkit/react-ui/styles.css";

export default function CustomMessages({
  messages,
  inProgress,
  RenderMessage,
}: MessagesProps) {
  const wrapperStyles = "p-4 flex flex-col gap-2 h-full overflow-y-auto bg-indigo-300";

  // [!code highlight:14]
  return (
    <div className={wrapperStyles}>
      {messages.map((message, index) => {
        const isCurrentMessage = index === messages.length - 1;
        return <RenderMessage
          key={index}
          message={message}
          inProgress={inProgress}
          index={index}
          isCurrentMessage={isCurrentMessage}
        />
      })}
    </div>
  );
}

<CopilotKit>
  <CopilotSidebar Messages={CustomMessages} />
</CopilotKit>
```
```tsx
        import { CopilotKit } from "@copilotkit/react-core";
        import {
            CopilotSidebar,
            type CopilotChatSuggestion,
            RenderSuggestion,
            type RenderSuggestionsListProps
        } from "@copilotkit/react-ui";
        import "@copilotkit/react-ui/styles.css";

        const CustomSuggestionsList = ({ suggestions, onSuggestionClick }: RenderSuggestionsListProps) => {
            return (
                <div className="suggestions flex flex-col gap-2 p-4">
                    <h1>Try asking:</h1>
                    <div className="flex gap-2">
                        {suggestions.map((suggestion: CopilotChatSuggestion, index) => (
                            <RenderSuggestion
                            key={index}
                                      title={suggestion.title}
                                      message={suggestion.message}
                                      partial={suggestion.partial}
                                      className="rounded-md border border-gray-500 bg-white px-2 py-1 shadow-md"
                                      onClick={() => onSuggestionClick(suggestion.message)}
                            />
                        ))}
                    </div>
                </div>
            );
        };

        <CopilotKit>
            <CopilotSidebar RenderSuggestionsList={CustomSuggestionsList} />
        </CopilotKit>
```
```tsx
import { type InputProps, CopilotSidebar } from "@copilotkit/react-ui";
import { CopilotKit } from "@copilotkit/react-core";
import "@copilotkit/react-ui/styles.css";
function CustomInput({ inProgress, onSend, isVisible }: InputProps) {
  const handleSubmit = (value: string) => {
    if (value.trim()) onSend(value);
  };

  const wrapperStyle = "flex gap-2 p-4 border-t";
  const inputStyle = "flex-1 p-2 rounded-md border border-gray-300 focus:outline-none focus:border-blue-500 disabled:bg-gray-100";
  const buttonStyle = "px-4 py-2 bg-blue-500 text-white rounded-md hover:bg-blue-600 disabled:bg-gray-400 disabled:cursor-not-allowed";

  // [!code highlight:27]
  return (
    <div className={wrapperStyle}>
      <input 
        disabled={inProgress}
        type="text" 
        placeholder="Ask your question here..." 
        className={inputStyle}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            handleSubmit(e.currentTarget.value);
            e.currentTarget.value = '';
          }
        }}
      />
      <button 
        disabled={inProgress}
        className={buttonStyle}
        onClick={(e) => {
          const input = e.currentTarget.previousElementSibling as HTMLInputElement;
          handleSubmit(input.value);
          input.value = '';
        }}
      >
        Ask
      </button>
    </div>
  );
}

<CopilotKit>
  <CopilotSidebar Input={CustomInput} />
</CopilotKit>
```
```tsx
"use client" // only necessary if you are using Next.js with the App Router.
import { useCopilotAction } from "@copilotkit/react-core"; 

// Your custom components (examples - implement these in your app)
import { LoadingView } from "./loading-view"; // Your loading component
import { CalendarMeetingCardComponent, type CalendarMeetingCardProps } from "./calendar-meeting-card"; // Your meeting card component

export function YourComponent() {
  useCopilotAction({ 
    name: "showCalendarMeeting",
    description: "Displays calendar meeting information",
    parameters: [
      {
        name: "date",
        type: "string",
        description: "Meeting date (YYYY-MM-DD)",
        required: true
      },
      {
        name: "time",
        type: "string",
        description: "Meeting time (HH:mm)",
        required: true
      },
      {
        name: "meetingName",
        type: "string",
        description: "Name of the meeting",
        required: false
      }
    ],
    render: ({ status, args }) => {
      const { date, time, meetingName } = args;

      if (status === 'inProgress') {
        return <LoadingView />; // Your own component for loading state
      } else {
        const meetingProps: CalendarMeetingCardProps = {
          date: date,
          time,
          meetingName
        };
        return <CalendarMeetingCardComponent {...meetingProps} />;
      }
    },
  });

  return (
    <>...</>
  );
}
```
```tsx
"use client"; // only necessary if you are using Next.js with the App Router.

import { useCoAgentStateRender } from "@copilotkit/react-core";
import { Progress } from "./progress";

type AgentState = {
  logs: string[];
}

useCoAgentStateRender<AgentState>({
  name: "basic_agent",
  render: ({ state, nodeName, status }) => {
    if (!state.logs || state.logs.length === 0) {
      return null;
    }

    // Progress is a component we are omitting from this example for brevity.
    return <Progress logs={state.logs} />; 
  },
});
```
```tsx
import {
  type CopilotChatReasoningMessageProps,
} from "@copilotkit/react-ui";
import { CopilotKit } from "@copilotkit/react-core";
import { CopilotSidebar } from "@copilotkit/react-ui";
import "@copilotkit/react-ui/styles.css";

function CustomReasoningMessage({
  message,
  messages,
  isRunning,
}: CopilotChatReasoningMessageProps) {
  const isLatest = messages?.[messages.length - 1]?.id === message.id;
  const isStreaming = !!(isRunning && isLatest);

  if (!message.content && !isStreaming) return null;

  // [!code highlight:8]
  return (
    <details open={isStreaming} className="my-2 rounded border p-3">
      <summary className="cursor-pointer font-medium text-sm">
        {isStreaming ? "🧠 Thinking…" : "💡 View reasoning"}
      </summary>
      <p className="mt-2 text-sm text-gray-600 whitespace-pre-wrap">
        {message.content}
      </p>
    </details>
  );
}

<CopilotKit>
  <CopilotSidebar
    messageView={{
      reasoningMessage: CustomReasoningMessage,
    }}
  />
</CopilotKit>
```

### Styling Copilot UI
- Route: `/adk/custom-look-and-feel/customize-built-in-ui-components`
- Source: `docs/content/docs/integrations/adk/custom-look-and-feel/customize-built-in-ui-components.mdx`

CopilotKit has a variety of ways to customize colors and structures of the Copilot UI components.
- [CSS Variables](#css-variables-easiest)
- [Custom CSS](#custom-css)
- [Custom Icons](#custom-icons)
- [Custom Labels](#custom-labels)

If you want to customize the style as well as the functionality of the Copilot UI, you can also try the following:
- [Custom Sub-Components](/custom-look-and-feel/bring-your-own-components)
- [Fully Headless UI](/custom-look-and-feel/headless-ui)

## CSS Variables (Easiest)
The easiest way to change the colors using in the Copilot UI components is to override CopilotKit CSS variables.

  Hover over the interactive UI elements below to see the available CSS variables.

Once you've found the right variable, you can import `CopilotKitCSSProperties` and simply wrap CopilotKit in a div and override the CSS variables.

```tsx
import { CopilotKitCSSProperties } from "@copilotkit/react-ui";

<div
  // [!code highlight:5]
  style={
    {
      "--copilot-kit-primary-color": "#222222",
    } as CopilotKitCSSProperties
  }
>
  <CopilotSidebar .../>
</div>
```

### Reference

| CSS Variable | Description |
|-------------|-------------|
| `--copilot-kit-primary-color` | Main brand/action color - used for buttons, interactive elements |
| `--copilot-kit-contrast-color` | Color that contrasts with primary - used for text on primary elements |
| `--copilot-kit-background-color` | Main page/container background color |
| `--copilot-kit-secondary-color` | Secondary background - used for cards, panels, elevated surfaces |
| `--copilot-kit-secondary-contrast-color` | Primary text color for main content |
| `--copilot-kit-separator-color` | Border color for dividers and containers |
| `--copilot-kit-muted-color` | Muted color for disabled/inactive states |

## Custom CSS

In addition to customizing the colors, the CopilotKit CSS is structured to easily allow customization via CSS classes.

```css title="globals.css"
.copilotKitButton {
  border-radius: 0;
}

.copilotKitMessages {
  padding: 2rem;
}

.copilotKitUserMessage {
  background: #007AFF;
}
```

### Reference

For a full list of styles and classes used in CopilotKit, click [here](https://github.com/CopilotKit/CopilotKit/blob/main/src/v1.x/packages/react-ui/src/css/).

| CSS Class | Description |
|-----------|-------------|
| `.copilotKitMessages` | Main container for all chat messages with scroll behavior and spacing |
| `.copilotKitInput` | Text input container with typing area and send button |
| `.copilotKitUserMessage` | Styling for user messages including background, text color and bubble shape |
| `.copilotKitAssistantMessage` | Styling for AI responses including background, text color and bubble shape |
| `.copilotKitHeader` | Top bar of chat window containing title and controls |
| `.copilotKitButton` | Primary chat toggle button with hover and active states |
| `.copilotKitWindow` | Root container defining overall chat window dimensions and position |
| `.copilotKitMarkdown` | Styles for rendered markdown content including lists, links and quotes |
| `.copilotKitCodeBlock` | Code snippet container with syntax highlighting and copy button |
| `.copilotKitChat` | Base chat layout container handling positioning and dimensions |
| `.copilotKitSidebar` | Styles for sidebar chat mode including width and animations |
| `.copilotKitPopup` | Styles for popup chat mode including position and animations |
| `.copilotKitButtonIcon` | Icon styling within the main chat toggle button |
| `.copilotKitButtonIconOpen` `.copilotKitButtonIconClose` | Icon states for when chat is open/closed |
| `.copilotKitCodeBlockToolbar` | Top bar of code blocks with language and copy controls |
| `.copilotKitCodeBlockToolbarLanguage` | Language label styling in code block toolbar |
| `.copilotKitCodeBlockToolbarButtons` | Container for code block action buttons |
| `.copilotKitCodeBlockToolbarButton` | Individual button styling in code block toolbar |
| `.copilotKitSidebarContentWrapper` | Inner container for sidebar mode content |
| `.copilotKitInputControls` | Container for input area buttons and controls |
| `.copilotKitActivityDot1` `.copilotKitActivityDot2` `.copilotKitActivityDot3` | Animated typing indicator dots |
| `.copilotKitDevConsole` | Development debugging console container |
| `.copilotKitDevConsoleWarnOutdated` | Warning styles for outdated dev console |
| `.copilotKitVersionInfo` | Version information display styles |
| `.copilotKitDebugMenuButton` | Debug menu toggle button styling |
| `.copilotKitDebugMenu` | Debug options menu container |
| `.copilotKitDebugMenuItem` | Individual debug menu option styling |

## Custom Fonts
You can customize the fonts by updating the `fontFamily` property in the various CSS classes that are used in the CopilotKit.

```css title="globals.css"
.copilotKitMessages {
  font-family: "Arial, sans-serif";
}

.copilotKitInput {
  font-family: "Arial, sans-serif";
}
```

### Reference
You can update the main content classes to change the font family for the various components.

| CSS Class | Description |
|-----------|-------------|
| `.copilotKitMessages` | Main container for all messages |
| `.copilotKitInput` | The input field |
| `.copilotKitMessage` | Base styling for all chat messages |
| `.copilotKitUserMessage` | User messages |
| `.copilotKitAssistantMessage` | AI responses |

## Custom Icons

You can customize the icons by passing the `icons` property to the `CopilotSidebar`, `CopilotPopup` or `CopilotChat` component.

```tsx
<CopilotChat
  icons={{
    // Use your own icons here – any React nodes
    openIcon: <YourOpenIconComponent />,
    closeIcon: <YourCloseIconComponent />,
  }}
/>
```

### Reference

| Icon | Description |
|--------------|-------------|
| `openIcon` | The icon to use for the open chat button |
| `closeIcon` | The icon to use for the close chat button |
| `headerCloseIcon` | The icon to use for the close chat button in the header |
| `sendIcon` | The icon to use for the send button |
| `activityIcon` | The icon to use for the activity indicator |
| `spinnerIcon` | The icon to use for the spinner |
| `stopIcon` | The icon to use for the stop button |
| `regenerateIcon` | The icon to use for the regenerate button |
| `pushToTalkIcon` | The icon to use for push to talk |

## Custom Labels

To customize labels, pass the `labels` property to the `CopilotSidebar`, `CopilotPopup` or `CopilotChat` component.

```tsx
<CopilotChat
  labels={{
    initial: "Hello! How can I help you today?",
    title: "My Copilot",
    placeholder: "Ask me anything!",
    stopGenerating: "Stop",
    regenerateResponse: "Regenerate",
  }} 
/>
```

### Reference

| Label | Description |
|---------------|-------------|
| `initial` | The initial message(s) to display in the chat window |
| `title` | The title to display in the header |
| `placeholder` | The placeholder to display in the input |
| `stopGenerating` | The label to display on the stop button |
| `regenerateResponse` | The label to display on the regenerate button |

### Fully Headless UI
- Route: `/adk/custom-look-and-feel/headless-ui`
- Source: `docs/content/docs/integrations/adk/custom-look-and-feel/headless-ui.mdx`
- Description: Fully customize your Copilot's UI from the ground up using headless UI

```bash
    npx copilotkit@latest create
```
```bash
    open README.md
```
```tsx title="src/app/layout.tsx"
    <CopilotKit
      publicLicenseKey="your-free-public-license-key"
    >
      {children}
    </CopilotKit>
```
```tsx title="src/app/page.tsx"
    "use client";
    import { useState } from "react";
    import { useCopilotChatHeadless_c } from "@copilotkit/react-core"; // [!code highlight]

    export default function Home() {
      const { messages, sendMessage, isLoading } = useCopilotChatHeadless_c(); // [!code highlight]
      const [input, setInput] = useState("");

      const handleSend = () => {
        if (input.trim()) {
          // [!code highlight:5]
          sendMessage({
            id: Date.now().toString(),
            role: "user",
            content: input,
          });
          setInput("");
        }
      };

      return (
        <div>
          <h1>My Headless Chat</h1>

          {/* Messages */}
          <div>
            {/* [!code highlight:6] */}
            {messages.map((message) => (
              <div key={message.id}>
                <strong>{message.role === "user" ? "You" : "Assistant"}:</strong>
                <p>{message.content}</p>
              </div>
            ))}

            {/* [!code highlight:1] */}
            {isLoading && <p>Assistant is typing...</p>}
          </div>

          {/* Input */}
          <div>
            <input
              type="text"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              // [!code highlight:1]
              onKeyDown={(e) => e.key === "Enter" && handleSend()}
              placeholder="Type your message here..."
            />
            {/* [!code highlight:1] */}
            <button onClick={handleSend} disabled={isLoading}>
              Send
            </button>
          </div>
        </div>
      );
    }
```
```tsx title="src/app/components/chat.tsx"
import { useCopilotAction } from "@copilotkit/react-core";

export const Chat = () => {
  // ...

  // Define an action that will show a custom component
  useCopilotAction({
    name: "showCustomComponent",
    // Handle the tool on the frontend
    // [!code highlight:3]
    handler: () => {
      return "Foo, Bar, Baz";
    },
    // Render a custom component for the underlying data
    // [!code highlight:13]
    render: ({ result, args, status}) => {
      return <div style={{
        backgroundColor: "red",
        padding: "10px",
        borderRadius: "5px",
      }}>
        <p>Custom component</p>
        <p>Result: {result}</p>
        <p>Args: {JSON.stringify(args)}</p>
        <p>Status: {status}</p>
      </div>;
    }
  });

  // ...

  return <div>
    {messages.map((message) => (
      <p key={message.id}>
        {message.role === "user" ? "User: " : "Assistant: "}
        {message.content}
        {/* Render the generative UI if it exists */}
        {/* [!code highlight:1] */}
        {message.role === "assistant" && message.generativeUI?.()}
      </p>
    ))}
  </div>
};
```
```tsx title="src/app/components/chat.tsx"
export const Chat = () => {
  // ...

  return <div>
    {messages.map((message) => (
      <p key={message.id}>
        {/* Render the tool calls if they exist */}
        {/* [!code highlight:5] */}
        {message.role === "assistant" && message.toolCalls?.map((toolCall) => (
          <p key={toolCall.id}>
            {toolCall.function.name}: {toolCall.function.arguments}
          </p>
        ))}
      </p>
    ))}
  </div>
};
```
```tsx title="src/app/components/chat.tsx"
import { useCopilotChatHeadless_c, useCopilotChatSuggestions } from "@copilotkit/react-core"; // [!code highlight]

export const Chat = () => {
  // Specify what suggestions should be generated
  // [!code highlight:5]
  useCopilotChatSuggestions({
    instructions:
      "Suggest 5 interesting activities for programmers to do on their next vacation",
    maxSuggestions: 5,
  });

  // Grab relevant state from the headless hook
  const { suggestions, generateSuggestions, sendMessage } = useCopilotChatHeadless_c(); // [!code highlight]

  // Generate suggestions when the component mounts
  useEffect(() => {
    generateSuggestions(); // [!code highlight]
  }, []);

  // ...

  // [!code word:suggestion]
  return <div>
    {suggestions.map((suggestion, index) => (
      <button
        key={index}
        onClick={() => sendMessage({
          id: "123",
          role: "user",
          content: suggestion.message
        })}
      >
        {suggestion.title}
      </button>
    ))}
  </div>
};
```
```tsx title="src/app/components/chat.tsx"
import { useCopilotChatHeadless_c } from "@copilotkit/react-core";

export const Chat = () => {
  // Grab relevant state from the headless hook
  // [!code highlight:1]
  const { suggestions, setSuggestions } = useCopilotChatHeadless_c();

  // Set the suggestions when the component mounts
  // [!code highlight:6]
  useEffect(() => {
    setSuggestions([
      { title: "Suggestion 1", message: "The actual message for suggestion 1" },
      { title: "Suggestion 2", message: "The actual message for suggestion 2" },
    ]);
  }, []);

  // Change the suggestions on function call
  const changeSuggestions = () => {
    // [!code highlight:4]
    setSuggestions([
      { title: "Foo", message: "Bar" },
      { title: "Baz", message: "Bat" },
    ]);
  };

  // [!code word:suggestion]
  return (
    <div>
      {/* Change on button click */}
      <button onClick={changeSuggestions}>Change suggestions</button>

      {/* Render */}
      {suggestions.map((suggestion, index) => (
        <button
          key={index}
          onClick={() => sendMessage({
            id: "123",
            role: "user",
            content: suggestion.message
          })}
        >
          {suggestion.title}
        </button>
      ))}
    </div>
  );
};
```
```tsx title="src/app/components/chat.tsx"
import { useCopilotAction, useCopilotChatHeadless_c } from "@copilotkit/react-core";

export const Chat = () => {
  const { messages, sendMessage } = useCopilotChatHeadless_c();

  // Define an action that will wait for the user to enter their name
  useCopilotAction({
    name: "getName",
    renderAndWaitForResponse: ({ respond, args, status}) => {
      if (status === "complete") {
        return <div>
          <p>Name retrieved...</p>
        </div>;
      }

      return <div>
        <input
          type="text"
          value={args.name || ""}
          onChange={(e) => respond?.(e.target.value)}
          placeholder="Enter your name"
        />
        {/* Respond with the name */}
        {/* [!code highlight:1] */}
        <button onClick={() => respond?.(args.name)}>Submit</button>
      </div>;
    }
  });

  return (
    {messages.map((message) => (
      <p key={message.id}>
        {message.role === "user" ? "User: " : "Assistant: "}
        {message.content}
        {/* [!code highlight:2] */}
        {/* This will render the tool-based HITL if it exists */}
        {message.role === "assistant" && message.generativeUI?.()}
      </p>
    ))}
  )
};
```

### Markdown rendering
- Route: `/adk/custom-look-and-feel/markdown-rendering-adk_custom-look-and-feel`
- Source: `docs/content/docs/integrations/adk/custom-look-and-feel/markdown-rendering-adk_custom-look-and-feel.mdx`

```tsx
import { CopilotKit } from "@copilotkit/react-core";
import { CopilotSidebar, ComponentsMap } from "@copilotkit/react-ui";
import "@copilotkit/react-ui/styles.css";
// We will include the styles in a separate css file, for convenience
import "./styles.css";

function YourComponent() {
    const customMarkdownTagRenderers: ComponentsMap<{ "reference-chip": { href: string } }> = {
        // You can make up your own tags, or use existing, valid HTML ones!
        "reference-chip": ({ children, href }) => {
            return (
                <a
                href={href}
                target="_blank"
                rel="noopener noreferrer"
                className="w-fit border rounded-xl py-1 px-2 text-xs" // Classes list trimmed for brevity
                >
                    {children}
                    <LinkIcon className="w-3.5 h-3.5" />
                </a>
            );
        },
    };

    return (
        <CopilotKit>
          <CopilotSidebar
            // For demonstration, we'll force the LLM to return our reference chip in every message
            instructions={`
                You are a helpful assistant.
                End each message with a reference chip,
                like so: <reference-chip href={href}>{title}</reference-chip>
            `}
            markdownTagRenderers={customMarkdownTagRenderers}
          />
        </CopilotKit>
    )
}
```
```css
.reference-chip {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    background-color: #f0f1f2;
    color: #444;
    border-radius: 12px;
    padding: 2px 8px;
    font-size: 0.8rem;
    font-weight: 500;
    text-decoration: none;
    margin: 0 2px;
    border: 1px solid #e0e0e0;
    cursor: pointer;
    box-shadow: 0 1px 2px rgba(0,0,0,0.05);
}
```

### Markdown rendering
- Route: `/adk/custom-look-and-feel/markdown-rendering`
- Source: `docs/content/docs/integrations/adk/custom-look-and-feel/markdown-rendering.mdx`

```tsx
import { CopilotKit } from "@copilotkit/react-core";
import { CopilotSidebar, ComponentsMap } from "@copilotkit/react-ui";
import "@copilotkit/react-ui/styles.css";
// We will include the styles in a separate css file, for convenience
import "./styles.css";

function YourComponent() {
    const customMarkdownTagRenderers: ComponentsMap<{ "reference-chip": { href: string } }> = {
        // You can make up your own tags, or use existing, valid HTML ones!
        "reference-chip": ({ children, href }) => {
            return (
                <a
                href={href}
                target="_blank"
                rel="noopener noreferrer"
                className="w-fit border rounded-xl py-1 px-2 text-xs" // Classes list trimmed for brevity
                >
                    {children}
                    <LinkIcon className="w-3.5 h-3.5" />
                </a>
            );
        },
    };

    return (
        <CopilotKit>
          <CopilotSidebar
            // For demonstration, we'll force the LLM to return our reference chip in every message
            instructions={`
                You are a helpful assistant.
                End each message with a reference chip,
                like so: <reference-chip href={href}>{title}</reference-chip>
            `}
            markdownTagRenderers={customMarkdownTagRenderers}
          />
        </CopilotKit>
    )
}
```
```css
.reference-chip {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    background-color: #f0f1f2;
    color: #444;
    border-radius: 12px;
    padding: 2px 8px;
    font-size: 0.8rem;
    font-weight: 500;
    text-decoration: none;
    margin: 0 2px;
    border: 1px solid #e0e0e0;
    cursor: pointer;
    box-shadow: 0 1px 2px rgba(0,0,0,0.05);
}
```

### Frontend Tools
- Route: `/adk/frontend-actions`
- Source: `docs/content/docs/integrations/adk/frontend-actions.mdx`
- Description: Create frontend tools and use them within your ADK agent.

```tsx title="page.tsx"
        import { useFrontendTool } from "@copilotkit/react-core" // [!code highlight]

        export function Page() {
          // ...

          // [!code highlight:15]
          useFrontendTool({
            name: "sayHello",
            description: "Say hello to the user",
            parameters: [
              {
                name: "name",
                type: "string",
                description: "The name of the user to say hello to",
                required: true,
              },
            ],
            handler: async ({ name }) => {
              alert(`Hello, ${name}!`);
            },
          });

          // ...
        }
```

### Agent State
- Route: `/adk/generative-ui/agentic`
- Source: `docs/content/docs/integrations/adk/generative-ui/agentic.mdx`
- Description: Render the state of your agent with custom UI components.

```python title="agent.py"
    import json
    from typing import Dict
    from fastapi import FastAPI
    from pydantic import BaseModel
    from ag_ui_adk import ADKAgent, add_adk_fastapi_endpoint
    from google.adk.agents import LlmAgent
    from google.adk.tools import ToolContext

    class AgentState(BaseModel):
        """State for the agent."""
        language: str = "english"

    def set_language(tool_context: ToolContext, new_language: str) -> Dict[str, str]:
        """Sets the language preference for the user.

        Args:
            tool_context (ToolContext): The tool context for accessing state.
            new_language (str): The language to save in state.

        Returns:
            Dict[str, str]: A dictionary indicating success status and message.
        """
        tool_context.state["language"] = new_language
        return {"status": "success", "message": f"Language set to {new_language}"}

    agent = LlmAgent(
        name="my_agent",
        model="gemini-2.5-flash",
        instruction="You are a helpful assistant that can change language settings.",
        tools=[set_language],
    )

    adk_agent = ADKAgent(
        adk_agent=agent,
        app_name="demo_app",
        user_id="demo_user",
        session_timeout_seconds=3600,
        use_in_memory_services=True,
    )

    app = FastAPI()
    add_adk_fastapi_endpoint(app, adk_agent, path="/")

    if __name__ == "__main__":
        import uvicorn
        uvicorn.run(app, host="0.0.0.0", port=8000)
```
```tsx title="app/page.tsx"
    // ...
    import { useCoAgentStateRender } from "@copilotkit/react-core";
    // ...

    // Define the state of the agent, should match the state of your ADK Agent.
    type AgentState = {
      language: string;
    };

    function YourMainContent() {
      // ...

      // [!code highlight:13]
      // styles omitted for brevity
      useCoAgentStateRender<AgentState>({
        name: "my_agent", // MUST match the agent name in CopilotRuntime
        render: ({ state }) => (
          <div>
            Current language: {state.language || 'not set'}
          </div>
        ),
      });

      // ...

      return <div>...</div>;
    }
```
```tsx title="app/page.tsx"
    import { useCoAgent } from "@copilotkit/react-core"; // [!code highlight]
    // ...

    // Define the state of the agent, should match the state of your ADK Agent.
    type AgentState = {
      language: string;
    };

    function YourMainContent() {
      // ...

      // [!code highlight:3]
      const { state } = useCoAgent<AgentState>({
        name: "my_agent", // MUST match the agent name in CopilotRuntime
      })

      // ...

      return (
        <div>
          {/* ... */}
          <div className="flex flex-col gap-2 mt-4">
            {/* [!code highlight:1] */}
            Current language: {state.language || 'not set'}
          </div>
        </div>
      )
    }
```

### Backend Tools
- Route: `/adk/generative-ui/backend-tools`
- Source: `docs/content/docs/integrations/adk/generative-ui/backend-tools.mdx`
- Description: Render your agent's tool calls with custom UI components.

```python title="agent.py"
        from fastapi import FastAPI
        from ag_ui_adk import ADKAgent, add_adk_fastapi_endpoint
        from google.adk.agents import LlmAgent

        def get_weather(location: str = "the entire world") -> str:
            """Retrieves the current weather report for a specified location.

            Args:
                location (str): The name of the location to get the weather for.

            Returns:
                str: The weather report for the specified location.
            """
            return f"The weather in {location} is sunny."

        agent = LlmAgent(
            model="gemini-2.5-flash",
            name="my_agent",
            instruction="You are a helpful weather assistant.",
            tools=[get_weather],
        )

        adk_agent = ADKAgent(
            adk_agent=agent,
            app_name="weather_demo",
            user_id="demo_user"
        )

        app = FastAPI()
        add_adk_fastapi_endpoint(app, adk_agent, path="/")

        if __name__ == "__main__":
            import uvicorn
            uvicorn.run(app, host="0.0.0.0", port=8000)
```
```tsx title="app/page.tsx"
import { useRenderToolCall } from "@copilotkit/react-core"; // [!code highlight]
// ...

const YourMainContent = () => {
  // ...
  // [!code highlight:12]
  useRenderToolCall({
    name: "get_weather",
    render: ({status, args}) => {
      return (
        <p className="text-gray-500 mt-2">
          {status !== "complete" && "Calling weather API..."}
          {status === "complete" && `Called the weather API for ${args.location}.`}
        </p>
      );
    },
  });
  // ...
}
```

### Frontend Tools
- Route: `/adk/generative-ui/frontend-tools`
- Source: `docs/content/docs/integrations/adk/generative-ui/frontend-tools.mdx`
- Description: Create frontend tools and use them within your ADK agent.

```tsx title="page.tsx"
        import { useFrontendTool } from "@copilotkit/react-core" // [!code highlight]

        export function Page() {
          // ...

          // [!code highlight:25]
          useFrontendTool({
            name: "sayHello",
            description: "Say hello to the user",
            parameters: [
              {
                name: "name",
                type: "string",
                description: "The name of the user to say hello to",
                required: true,
              },
            ],
            handler({ name }) {
              // Handler returns the result of the tool call
              return { currentURLPath: window.location.href, userName: name };
            },
            render: ({ args }) => {
              // Renders UI based on the data of the tool call
              return (
                <div>
                  <h1>Hello, {args.name}!</h1>
                  <h1>You're currently on {window.location.href}</h1>
                </div>
              );
            },
          });

          // ...
        }
```

### Generative UI
- Route: `/adk/generative-ui`
- Source: `docs/content/docs/integrations/adk/generative-ui/index.mdx`
- Description: Render your agent's behavior with custom UI components.

This example shows our Research Canvas making use of Generative UI!

## What is Generative UI?

Generative UI lets you render your agent's state, progress, outputs, and tool calls with custom UI components in real-time. It bridges the gap between AI
agents and user interfaces. As your agent processes information and makes decisions, you can render custom UI components that:

- Show loading states and progress indicators
- Display structured data in tables, cards, or charts
- Create interactive elements for user input
- Animate transitions between different states

## How can I use this?

To get started, you first need to decide what is going to be backing your generative UI. There are three main variants of Generative UI with CopilotKit for ADK.

### Human-in-the-Loop
- Route: `/adk/human-in-the-loop`
- Source: `docs/content/docs/integrations/adk/human-in-the-loop.mdx`
- Description: Create frontend tools and use them within your ADK agent for human-in-the-loop interactions.

```tsx title="page.tsx"
        import { useHumanInTheLoop } from "@copilotkit/react-core" // [!code highlight]

        export function Page() {
          // ...

          useHumanInTheLoop({
            name: "offerOptions",
            description: "Give the user a choice between two options and have them select one.",
            parameters: [
              {
                name: "option_1",
                type: "string",
                description: "The first option",
                required: true,
              },
              {
                name: "option_2",
                type: "string",
                description: "The second option",
                required: true,
              },
            ],
            render: ({ args, respond }) => {
              if (!respond) return <></>;
              return (
                <div>
                  {/* [!code highlight:2] */}
                  <button onClick={() => respond(`${args.option_1} was selected`)}>{args.option_1}</button>
                  <button onClick={() => respond(`${args.option_2} was selected`)}>{args.option_2}</button>
                </div>
              );
            },
          });

          // ...
        }
```
```
        Can you show me two good options for a restaurant name?
```

### Fully Headless UI
- Route: `/adk/premium/headless-ui`
- Source: `docs/content/docs/integrations/adk/premium/headless-ui.mdx`
- Description: Fully customize your Copilot's UI from the ground up using headless UI

```bash
    npx copilotkit@latest create
```
```bash
    open README.md
```
```tsx title="src/app/layout.tsx"
    <CopilotKit
      publicLicenseKey="your-free-public-license-key"
    >
      {children}
    </CopilotKit>
```
```tsx title="src/app/page.tsx"
    "use client";
    import { useState } from "react";
    import { useCopilotChatHeadless_c } from "@copilotkit/react-core"; // [!code highlight]

    export default function Home() {
      const { messages, sendMessage, isLoading } = useCopilotChatHeadless_c(); // [!code highlight]
      const [input, setInput] = useState("");

      const handleSend = () => {
        if (input.trim()) {
          // [!code highlight:5]
          sendMessage({
            id: Date.now().toString(),
            role: "user",
            content: input,
          });
          setInput("");
        }
      };

      return (
        <div>
          <h1>My Headless Chat</h1>

          {/* Messages */}
          <div>
            {/* [!code highlight:6] */}
            {messages.map((message) => (
              <div key={message.id}>
                <strong>{message.role === "user" ? "You" : "Assistant"}:</strong>
                <p>{message.content}</p>
              </div>
            ))}

            {/* [!code highlight:1] */}
            {isLoading && <p>Assistant is typing...</p>}
          </div>

          {/* Input */}
          <div>
            <input
              type="text"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              // [!code highlight:1]
              onKeyDown={(e) => e.key === "Enter" && handleSend()}
              placeholder="Type your message here..."
            />
            {/* [!code highlight:1] */}
            <button onClick={handleSend} disabled={isLoading}>
              Send
            </button>
          </div>
        </div>
      );
    }
```
```tsx title="src/app/components/chat.tsx"
import { useCopilotAction } from "@copilotkit/react-core";

export const Chat = () => {
  // ...

  // Define an action that will show a custom component
  useCopilotAction({
    name: "showCustomComponent",
    // Handle the tool on the frontend
    // [!code highlight:3]
    handler: () => {
      return "Foo, Bar, Baz";
    },
    // Render a custom component for the underlying data
    // [!code highlight:13]
    render: ({ result, args, status}) => {
      return <div style={{
        backgroundColor: "red",
        padding: "10px",
        borderRadius: "5px",
      }}>
        <p>Custom component</p>
        <p>Result: {result}</p>
        <p>Args: {JSON.stringify(args)}</p>
        <p>Status: {status}</p>
      </div>;
    }
  });

  // ...

  return <div>
    {messages.map((message) => (
      <p key={message.id}>
        {message.role === "user" ? "User: " : "Assistant: "}
        {message.content}
        {/* Render the generative UI if it exists */}
        {/* [!code highlight:1] */}
        {message.role === "assistant" && message.generativeUI?.()}
      </p>
    ))}
  </div>
};
```
```tsx title="src/app/components/chat.tsx"
export const Chat = () => {
  // ...

  return <div>
    {messages.map((message) => (
      <p key={message.id}>
        {/* Render the tool calls if they exist */}
        {/* [!code highlight:5] */}
        {message.role === "assistant" && message.toolCalls?.map((toolCall) => (
          <p key={toolCall.id}>
            {toolCall.function.name}: {toolCall.function.arguments}
          </p>
        ))}
      </p>
    ))}
  </div>
};
```
```tsx title="src/app/components/chat.tsx"
import { useCopilotChatHeadless_c, useCopilotChatSuggestions } from "@copilotkit/react-core"; // [!code highlight]

export const Chat = () => {
  // Specify what suggestions should be generated
  // [!code highlight:5]
  useCopilotChatSuggestions({
    instructions:
      "Suggest 5 interesting activities for programmers to do on their next vacation",
    maxSuggestions: 5,
  });

  // Grab relevant state from the headless hook
  const { suggestions, generateSuggestions, sendMessage } = useCopilotChatHeadless_c(); // [!code highlight]

  // Generate suggestions when the component mounts
  useEffect(() => {
    generateSuggestions(); // [!code highlight]
  }, []);

  // ...

  // [!code word:suggestion]
  return <div>
    {suggestions.map((suggestion, index) => (
      <button
        key={index}
        onClick={() => sendMessage({
          id: "123",
          role: "user",
          content: suggestion.message
        })}
      >
        {suggestion.title}
      </button>
    ))}
  </div>
};
```
```tsx title="src/app/components/chat.tsx"
import { useCopilotChatHeadless_c } from "@copilotkit/react-core";

export const Chat = () => {
  // Grab relevant state from the headless hook
  // [!code highlight:1]
  const { suggestions, setSuggestions } = useCopilotChatHeadless_c();

  // Set the suggestions when the component mounts
  // [!code highlight:6]
  useEffect(() => {
    setSuggestions([
      { title: "Suggestion 1", message: "The actual message for suggestion 1" },
      { title: "Suggestion 2", message: "The actual message for suggestion 2" },
    ]);
  }, []);

  // Change the suggestions on function call
  const changeSuggestions = () => {
    // [!code highlight:4]
    setSuggestions([
      { title: "Foo", message: "Bar" },
      { title: "Baz", message: "Bat" },
    ]);
  };

  // [!code word:suggestion]
  return (
    <div>
      {/* Change on button click */}
      <button onClick={changeSuggestions}>Change suggestions</button>

      {/* Render */}
      {suggestions.map((suggestion, index) => (
        <button
          key={index}
          onClick={() => sendMessage({
            id: "123",
            role: "user",
            content: suggestion.message
          })}
        >
          {suggestion.title}
        </button>
      ))}
    </div>
  );
};
```
```tsx title="src/app/components/chat.tsx"
import { useCopilotAction, useCopilotChatHeadless_c } from "@copilotkit/react-core";

export const Chat = () => {
  const { messages, sendMessage } = useCopilotChatHeadless_c();

  // Define an action that will wait for the user to enter their name
  useCopilotAction({
    name: "getName",
    renderAndWaitForResponse: ({ respond, args, status}) => {
      if (status === "complete") {
        return <div>
          <p>Name retrieved...</p>
        </div>;
      }

      return <div>
        <input
          type="text"
          value={args.name || ""}
          onChange={(e) => respond?.(e.target.value)}
          placeholder="Enter your name"
        />
        {/* Respond with the name */}
        {/* [!code highlight:1] */}
        <button onClick={() => respond?.(args.name)}>Submit</button>
      </div>;
    }
  });

  return (
    {messages.map((message) => (
      <p key={message.id}>
        {message.role === "user" ? "User: " : "Assistant: "}
        {message.content}
        {/* [!code highlight:2] */}
        {/* This will render the tool-based HITL if it exists */}
        {message.role === "assistant" && message.generativeUI?.()}
      </p>
    ))}
  )
};
```

### Inspector
- Route: `/adk/premium/inspector`
- Source: `docs/content/docs/integrations/adk/premium/inspector.mdx`
- Description: Inspector for debugging actions, readables, agent status, messages, and context.

The Copilot Inspector is a debugging aid, accessible from a copilotkit button overlaid on your app, which allows you to see the information, state and conversation between them and you (the user).

  The Inspector is available to CopilotKit Premium users. Get a free public
  license key on [Copilot Cloud](https://cloud.copilotkit.ai) or read more about{" "}

## What it shows

- Actions: Registered actions and parameter schemas
- Readables: Context/readables available to the agent
- Agent Status: Coagent states and running/completion info
- Messages: Conversation history
- Context: Document context fed into the model

## Requirements

- Provide `publicLicenseKey` to `` to enable premium features:

```tsx
<CopilotKit publicLicenseKey={process.env.NEXT_PUBLIC_COPILOTKIT_LICENSE_KEY}>
  {children}
</CopilotKit>
```

## How to open

A draggable circular trigger is rendered in-app. Click to open the Inspector.
If no license key is configured, you’ll see a "Get License Key" prompt.

### Observability
- Route: `/adk/premium/observability`
- Source: `docs/content/docs/integrations/adk/premium/observability.mdx`
- Description: Monitor your CopilotKit application with comprehensive observability hooks. Understand user interactions, chat events, and system errors.

Monitor CopilotKit with first‑class observability hooks that emit structured signals for chat events, user interactions, and runtime errors. Send these signals straight to your existing stack, including Sentry, Datadog, New Relic, and OpenTelemetry, or route them to your analytics pipeline. The hooks expose stable schemas and IDs so you can join agent events with app telemetry, trace sessions end to end, and alert on failures in real time. Works with Copilot Cloud via `publicApiKey`, or self‑hosted via `publicLicenseKey`.
## Quick Start

  All observability hooks require a `publicLicenseKey` or `publicAPIkey` - Get yours free at
  [https://cloud.copilotkit.ai](https://cloud.copilotkit.ai)

### Chat Observability Hooks

Track user interactions and chat events with comprehensive observability hooks:

```tsx
import { CopilotChat } from "@copilotkit/react-ui";
import { CopilotKit } from "@copilotkit/react-core";

export default function App() {
  return (
    <CopilotKit
      publicApiKey="ck_pub_your_key" // [!code highlight] - Use publicApiKey for Copilot Cloud
      // OR
      publicLicenseKey="ck_pub_your_key" // [!code highlight] - Use publicLicenseKey for self-hosted
    >
      <CopilotChat
        observabilityHooks={{
          // [!code highlight]
          onMessageSent: (message) => {
            // [!code highlight]
            console.log("Message sent:", message);
            analytics.track("chat_message_sent", { message });
          }, // [!code highlight]
          onChatExpanded: () => {
            // [!code highlight]
            console.log("Chat opened");
            analytics.track("chat_expanded");
          }, // [!code highlight]
          onChatMinimized: () => {
            // [!code highlight]
            console.log("Chat closed");
            analytics.track("chat_minimized");
          }, // [!code highlight]
          onFeedbackGiven: (messageId, type) => {
            // [!code highlight]
            console.log("Feedback:", type, messageId);
            analytics.track("chat_feedback", { messageId, type });
          }, // [!code highlight]
        }} // [!code highlight]
      />
    </CopilotKit>
  );
}
```

### Error Observability

Monitor system errors and performance with error observability hooks:

```tsx
import { CopilotKit } from "@copilotkit/react-core";

export default function App() {
  return (
    <CopilotKit
      publicApiKey="ck_pub_your_key" // [!code highlight] - Use publicApiKey for Copilot Cloud
      // OR
      publicLicenseKey="ck_pub_your_key" // [!code highlight] - Use publicLicenseKey for self-hosted
      onError={(errorEvent) => {
        // [!code highlight]
        // Send errors to monitoring service
        console.error("CopilotKit Error:", errorEvent);

        // Example: Send to analytics
        analytics.track("copilotkit_error", {
          type: errorEvent.type,
          source: errorEvent.context.source,
          timestamp: errorEvent.timestamp,
        });
      }} // [!code highlight]
      showDevConsole={false} // Hide dev console in production
    >
      {/* Your app */}
    </CopilotKit>
  );
}
```

## Observability Features

### CopilotChat Observability Hooks

Track user interactions, chat behavior and errors with comprehensive observability hooks (requires a `publicLicenseKey` if self-hosted or `publicAPIkey` if using CopilotCloud):

```tsx
import { CopilotChat } from "@copilotkit/react-ui";

<CopilotChat
  observabilityHooks={{
    onMessageSent: (message) => {
      console.log("Message sent:", message);
      // Track message analytics
      analytics.track("chat_message_sent", { message });
    },
    onChatExpanded: () => {
      console.log("Chat opened");
      // Track engagement
      analytics.track("chat_expanded");
    },
    onChatMinimized: () => {
      console.log("Chat closed");
      // Track user behavior
      analytics.track("chat_minimized");
    },
    onMessageRegenerated: (messageId) => {
      console.log("Message regenerated:", messageId);
      // Track regeneration requests
      analytics.track("chat_message_regenerated", { messageId });
    },
    onMessageCopied: (content) => {
      console.log("Message copied:", content);
      // Track content sharing
      analytics.track("chat_message_copied", { contentLength: content.length });
    },
    onFeedbackGiven: (messageId, type) => {
      console.log("Feedback given:", messageId, type);
      // Track user feedback
      analytics.track("chat_feedback_given", { messageId, type });
    },
    onChatStarted: () => {
      console.log("Chat generation started");
      // Track when AI starts responding
      analytics.track("chat_generation_started");
    },
    onChatStopped: () => {
      console.log("Chat generation stopped");
      // Track when AI stops responding
      analytics.track("chat_generation_stopped");
    },
    onError: (errorEvent) => {
      console.log("Error occurred", errorEvent);
      // Log error
      analytics.track("error_event", errorEvent);
    },
  }}
/>;
```

**Available Observability Hooks:**

- `onMessageSent(message)` - User sends a message
- `onChatExpanded()` - Chat is opened/expanded
- `onChatMinimized()` - Chat is closed/minimized
- `onMessageRegenerated(messageId)` - Message is regenerated
- `onMessageCopied(content)` - Message is copied
- `onFeedbackGiven(messageId, type)` - Thumbs up/down feedback given
- `onChatStarted()` - Chat generation starts
- `onChatStopped()` - Chat generation stops
- `onError(errorEvent)` - Error events and system monitoring

**Requirements:**

- ✅ Requires a `publicLicenseKey` (when self-hosting) or `publicApiKey` from [Copilot Cloud](https://cloud.copilotkit.ai)
- ✅ Works with `CopilotChat`, `CopilotPopup`, `CopilotSidebar`, and all pre-built components

  **Important:** Observability hooks will **not trigger** without a valid
  key. This is a security feature to ensure observability hooks only
  work in authorized applications.

## Error Event Structure

The `onError` handler receives detailed error events with rich context:

```typescript
interface CopilotErrorEvent {
  type:
    | "error"
    | "request"
    | "response"
    | "agent_state"
    | "action"
    | "message"
    | "performance";
  timestamp: number;
  context: {
    source: "ui" | "runtime" | "agent";
    request?: {
      operation: string;
      method?: string;
      url?: string;
      startTime: number;
    };
    response?: {
      endTime: number;
      latency: number;
    };
    agent?: {
      name: string;
      nodeName?: string;
    };
    messages?: {
      input: any[];
      messageCount: number;
    };
    technical?: {
      environment: string;
      stackTrace?: string;
    };
  };
  error?: any; // Present for error events
}
```

## Common Observability Patterns

### Chat Event Tracking

```tsx
<CopilotChat
  observabilityHooks={{
    onMessageSent: (message) => {
      // Track message analytics
      analytics.track("chat_message_sent", {
        messageLength: message.length,
        timestamp: Date.now(),
        userId: getCurrentUserId(),
      });
    },
    onChatExpanded: () => {
      // Track user engagement
      analytics.track("chat_expanded", {
        timestamp: Date.now(),
        userId: getCurrentUserId(),
      });
    },
    onFeedbackGiven: (messageId, type) => {
      // Track feedback for AI improvement
      analytics.track("chat_feedback", {
        messageId,
        feedbackType: type,
        timestamp: Date.now(),
      });
    },
  }}
/>
```

### Combined Event and Error Tracking

```tsx
<CopilotKit
  publicApiKey="ck_pub_your_key" // [!code highlight] - Use publicApiKey for Copilot Cloud
  // OR
  publicLicenseKey="ck_pub_your_key" // [!code highlight] - Use publicLicenseKey for self-hosted
  onError={(errorEvent) => {
    // Error observability
    if (errorEvent.type === "error") {
      console.error("CopilotKit Error:", errorEvent);
      analytics.track("copilotkit_error", {
        error: errorEvent.error?.message,
        context: errorEvent.context,
      });
    }
  }}
>
  <CopilotChat
    observabilityHooks={{
      onMessageSent: (message) => {
        // Event tracking
        analytics.track("chat_message_sent", { message });
      },
      onChatExpanded: () => {
        analytics.track("chat_expanded");
      },
    }}
  />
</CopilotKit>
```

## Error Observability Patterns

### Basic Error Logging

```tsx
<CopilotKit
  publicApiKey="ck_pub_your_key" // [!code highlight] - Use publicApiKey for Copilot Cloud
  // OR
  publicLicenseKey="ck_pub_your_key" // [!code highlight] - Use publicLicenseKey for self-hosted
  onError={(errorEvent) => {
    console.error("[CopilotKit Error]", {
      type: errorEvent.type,
      timestamp: new Date(errorEvent.timestamp).toISOString(),
      context: errorEvent.context,
      error: errorEvent.error,
    });
  }}
>
  {/* Your app */}
</CopilotKit>
```

### Integration with Monitoring Services

```tsx
// Example with Sentry
import * as Sentry from "@sentry/react";

<CopilotKit
  publicApiKey="ck_pub_your_key" // [!code highlight] - Use publicApiKey for Copilot Cloud
  // OR
  publicLicenseKey="ck_pub_your_key" // [!code highlight] - Use publicLicenseKey for self-hosted
  onError={(errorEvent) => {
    if (errorEvent.type === "error") {
      Sentry.captureException(errorEvent.error, {
        tags: {
          source: errorEvent.context.source,
          operation: errorEvent.context.request?.operation,
        },
        extra: {
          context: errorEvent.context,
          timestamp: errorEvent.timestamp,
        },
      });
    }
  }}
>
  {/* Your app */}
</CopilotKit>;
```

### Custom Error Analytics

```tsx
<CopilotKit
  publicApiKey="ck_pub_your_key" // [!code highlight] - Use publicApiKey for Copilot Cloud
  // OR
  publicLicenseKey="ck_pub_your_key" // [!code highlight] - Use publicLicenseKey for self-hosted
  onError={(errorEvent) => {
    // Track different error types
    analytics.track("copilotkit_event", {
      event_type: errorEvent.type,
      source: errorEvent.context.source,
      agent_name: errorEvent.context.agent?.name,
      latency: errorEvent.context.response?.latency,
      error_message: errorEvent.error?.message,
      timestamp: errorEvent.timestamp,
    });
  }}
>
  {/* Your app */}
</CopilotKit>
```

## Development vs Production Setup

### Development Environment

```tsx
<CopilotKit
  runtimeUrl="http://localhost:3000/api/copilotkit"
  publicLicenseKey={process.env.NEXT_PUBLIC_COPILOTKIT_LICENSE_KEY} // Self-hosted
  // OR
  publicApiKey={process.env.NEXT_PUBLIC_COPILOTKIT_API_KEY} // Using Copilot Cloud
  showDevConsole={true} // Show visual errors
  onError={(errorEvent) => {
    // Simple console logging for development
    console.log("CopilotKit Event:", errorEvent);
  }}
>
  <CopilotChat
    observabilityHooks={{
      onMessageSent: (message) => {
        console.log("Message sent:", message);
      },
      onChatExpanded: () => {
        console.log("Chat expanded");
      },
    }}
  />
</CopilotKit>
```

### Production Environment

```tsx
<CopilotKit
  runtimeUrl="https://your-app.com/api/copilotkit"
  publicLicenseKey={process.env.NEXT_PUBLIC_COPILOTKIT_LICENSE_KEY} // [!code highlight]
  // OR
  publicApiKey={process.env.NEXT_PUBLIC_COPILOTKIT_API_KEY} // [!code highlight]
  showDevConsole={false} // Hide from users
  onError={(errorEvent) => {
    // Production error observability
    if (errorEvent.type === "error") {
      // Log critical errors
      logger.error("CopilotKit Error", {
        error: errorEvent.error,
        context: errorEvent.context,
        timestamp: errorEvent.timestamp,
      });

      // Send to monitoring service
      monitoring.captureError(errorEvent.error, {
        extra: errorEvent.context,
      });
    }
  }}
>
  <CopilotChat
    observabilityHooks={{
      onMessageSent: (message) => {
        // Track production analytics
        analytics.track("chat_message_sent", {
          messageLength: message.length,
          userId: getCurrentUserId(),
        });
      },
      onChatExpanded: () => {
        analytics.track("chat_expanded");
      },
      onFeedbackGiven: (messageId, type) => {
        // Track feedback for AI improvement
        analytics.track("chat_feedback", { messageId, type });
      },
    }}
  />
</CopilotKit>
```

## Getting Started with CopilotKit Premium

To use observability hooks (event hooks and error observability), you'll need a CopilotKit Premium account:

1. **Sign up for free** at [https://cloud.copilotkit.ai](https://cloud.copilotkit.ai)
2. **Get your public license key (for self-hosting), or public API key** from the dashboard
3. **Add it to your environment variables**:
```bash
   NEXT_PUBLIC_COPILOTKIT_LICENSE_KEY=ck_pub_your_key_here
   # OR
   NEXT_PUBLIC_COPILOTKIT_API_KEY=ck_pub_your_key_here
```
4. **Use it in your CopilotKit provider**:
```tsx
   <CopilotKit 
      publicLicenseKey={process.env.NEXT_PUBLIC_COPILOTKIT_LICENSE_KEY}
      // OR
      publicApiKey={process.env.NEXT_PUBLIC_COPILOTKIT_API_KEY}
      >
     <CopilotChat
       observabilityHooks={{
         onMessageSent: (message) => console.log("Message:", message),
         onChatExpanded: () => console.log("Chat opened"),
       }}
     />
   </CopilotKit>
```

  CopilotKit Premium is free to get started and provides production-ready
  infrastructure for your AI copilots, including comprehensive observability
  capabilities for tracking user behavior and monitoring system health.

### CopilotKit Premium
- Route: `/adk/premium/overview`
- Source: `docs/content/docs/integrations/adk/premium/overview.mdx`
- Description: Premium features for CopilotKit.

## What is CopilotKit Premium?
CopilotKit Premium plans deliver:
- A commercial license for premium extensions to the open source CopilotKit framework (self-hosted or using Copilot Cloud)
- Access to the Copilot Cloud hosted service.

CopilotKit Premium is designed for teams building production-grade, agent-powered applications with CopilotKit.
Premium extension features — such as Fully Headless UI and debugging tools — can be used in both self-hosted and cloud-hosted deployments.

The Developer tier of CopilotKit Premium is always free.

## Premium Plans
- Developer – Free forever, includes early-stage access and limited cloud usage
- Pro – For growing teams building in production
- Enterprise – For organizations with advanced scalability, security, and support needs
## Early Access
Certain features—like the Headless UI—will initially be available only to Premium subscribers before becoming part of the open-source core as the framework matures.
All CopilotKit Premium subscribers get early access to new features, tooling, and integrations as they are released.

## Current Premium Features
- [Fully Headless Chat UI](headless-ui) - Early Access
- [Observability Hooks](observability)
- [Copilot Cloud](https://cloud.copilotkit.ai)

## FAQs

### How do I get access to premium features?

#### Option 1:  Use Copilot Cloud!
All CopilotKit Premium features are included in Copilot Cloud.

#### Option 2:  Self-host with a license key.
Access to premium features requires a public license key. To get yours, follow the steps below.

    #### Sign up

    Create a *free* account on [Copilot Cloud](https://cloud.copilotkit.ai).

    This does not require a credit card or use of Copilot Cloud.
    #### Get your public license key

    Once you've signed up, you'll be able to get your public license key from the left nav.
    #### Use the public license key

    Once you've signed up, you'll be able to use the public license key in your CopilotKit instance.

```tsx title="layout.tsx"
    <CopilotKit publicLicenseKey="your-public-license-key" />
```

### Can I still self-host with a public license key?

Yes, you can still self-host with a public license key. It is only required if you want to use premium features,
for access to Copilot Cloud a public API key is utilized.

### What is the difference between a public license key and a public API key?

A public API key is a key that you use to connect your app to Copilot Cloud. Public license keys are used to access premium features
and do not require a connection to Copilot Cloud.

### Quickstart
- Route: `/adk/quickstart`
- Source: `docs/content/docs/integrations/adk/quickstart.mdx`
- Description: Turn your ADK Agents into an agent-native application in 10 minutes.

## Prerequisites

Before you begin, you'll need the following:

- A Google Gemini API key
- Node.js 20+
- Python 3.9+
- Your favorite package manager

## Getting started

                    You can either start fresh with our starter template or integrate CopilotKit into your existing ADK agent.
                ### Run our CLI

```bash
                npx copilotkit@latest create -f adk
```
                ### Install dependencies

```npm
                npm install
```
                ### Configure your environment

                Create a `.env` file in your agent directory and add your Google API key:

```plaintext title="agent/.env"
                GOOGLE_API_KEY=your_google_api_key
```

                  The starter template is configured to use Google's Gemini by default, but you can modify it to use any language model supported by ADK.
                ### Start the development server

```bash
                        npm run dev
```
```bash
                        pnpm dev
```
```bash
                        yarn dev
```
```bash
                        bun dev
```

                This will start both the UI and agent servers concurrently.
                ### 🎉 Start chatting!

                Your AI agent is now ready to use! Navigate to `localhost:3000` and start prompting it:

```
                Set the theme to orange
```

```
                Write a proverb about AI
```

```
                Get the weather in SF
```

                        - If you're having connection issues, try using `0.0.0.0` or `127.0.0.1` instead of `localhost`
                        - Make sure your agent is running on port 8000
                        - Check that your Google API key is correctly set

                ### Initialize your agent project

                If you don't already have a Python project set up, create one using `uv`:

```bash
                uv init my-agent
                cd my-agent
```
                ### Install ADK with AG-UI

                Add ADK with AG-UI support and uvicorn to your project:

```bash
                uv add ag-ui-adk google-adk uvicorn fastapi
```

                  AG-UI is an open protocol for frontend-agent communication. The `ag-ui-adk` package provides ADK integration that CopilotKit can connect to.
                ### Configure your environment

                Set your Google API key as an environment variable:

```bash
                export GOOGLE_API_KEY=your_google_api_key
```

                  This example uses Gemini 2.5 Flash, but you can modify it to use any language model supported by ADK.
                ### Expose your agent via AG-UI

                Update your agent file to expose it as an AG-UI ASGI application:

```python title="main.py"
                from fastapi import FastAPI
                from ag_ui_adk import ADKAgent, add_adk_fastapi_endpoint
                from google.adk.agents import LlmAgent

                agent = LlmAgent(
                    name="assistant",
                    model="gemini-2.5-flash",
                    instruction="Be helpful and fun!"
                )

                adk_agent = ADKAgent(
                    adk_agent=agent,
                    app_name="demo_app",
                    user_id="demo_user",
                    session_timeout_seconds=3600,
                    use_in_memory_services=True
                )

                app = FastAPI()
                add_adk_fastapi_endpoint(app, adk_agent, path="/")

                if __name__ == "__main__":
                    import uvicorn
                    uvicorn.run(app, host="localhost", port=8000)
```
                ### Create your frontend

                CopilotKit works with any React-based frontend. We'll use Next.js for this example.

```bash
                npx create-next-app@latest my-copilot-app
                cd my-copilot-app
```
                ### Install CopilotKit packages

```npm
                npm install @copilotkit/react-ui @copilotkit/react-core @copilotkit/runtime @ag-ui/client
```
                ### Setup Copilot Runtime

                Create an API route to connect CopilotKit to your ADK agent:

```tsx title="app/api/copilotkit/route.ts"
                import {
                  CopilotRuntime,
                  ExperimentalEmptyAdapter,
                  copilotRuntimeNextJSAppRouterEndpoint,
                } from "@copilotkit/runtime";
                import { HttpAgent } from "@ag-ui/client";
                import { NextRequest } from "next/server";

                const serviceAdapter = new ExperimentalEmptyAdapter();

                const runtime = new CopilotRuntime({
                  agents: {
                    my_agent: new HttpAgent({ url: "http://localhost:8000/" }),
                  }
                });

                export const POST = async (req: NextRequest) => {
                  const { handleRequest } = copilotRuntimeNextJSAppRouterEndpoint({
                    runtime,
                    serviceAdapter,
                    endpoint: "/api/copilotkit",
                  });

                  return handleRequest(req);
                };
```
                ### Configure CopilotKit Provider

                Wrap your application with the CopilotKit provider:

```tsx title="app/layout.tsx"
                import { CopilotKit } from "@copilotkit/react-core"; // [!code highlight]
                import "@copilotkit/react-ui/styles.css";

                // ...

                export default function RootLayout({ children }: {children: React.ReactNode}) {
                  return (
                    <html lang="en">
                      <body>
                        {/* [!code highlight:3] */}
                        <CopilotKit runtimeUrl="/api/copilotkit" agent="my_agent">
                          {children}
                        </CopilotKit>
                      </body>
                    </html>
                  );
                }
```
              ### Add the chat interface

              Add the CopilotSidebar component to your page:

```tsx title="app/page.tsx"
              import { CopilotSidebar } from "@copilotkit/react-ui"; // [!code highlight:1]

              export default function Page() {
                return (
                  <main>
                    <h1>Your App</h1>
                    {/* [!code highlight:1] */}
                    <CopilotSidebar />
                  </main>
                );
              }
```
                ### Start your agent

                From your agent directory, start the agent server:

```bash
                uv run main.py
```

                Your agent will be available at `http://localhost:8000`.
                ### Start your UI

                In a separate terminal, navigate to your frontend directory and start the development server:

```bash
                        cd my-copilot-app
                        npm run dev
```
```bash
                        cd my-copilot-app
                        pnpm dev
```
```bash
                        cd my-copilot-app
                        yarn dev
```
```bash
                        cd my-copilot-app
                        bun dev
```
                ### 🎉 Start chatting!

                Your AI agent is now ready to use! Navigate to `localhost:3000` and try asking it some questions:

```
                Can you tell me a joke?
```

```
                Can you help me understand AI?
```

```
                What do you think about React?
```

                        - If you're having connection issues, try using `0.0.0.0` or `127.0.0.1` instead of `localhost`
                        - Make sure your agent is running on port 8000
                        - Check that your Google API key is correctly set
                        - Verify that the `@ag-ui/client` package is installed in your frontend

## What's next?

Now that you have your basic agent setup, explore these advanced features:

### Reading agent state
- Route: `/adk/shared-state/in-app-agent-read`
- Source: `docs/content/docs/integrations/adk/shared-state/in-app-agent-read.mdx`
- Description: Read the realtime agent state in your native application.

```python title="agent.py"
    from typing import Dict
    from fastapi import FastAPI
    from pydantic import BaseModel
    from ag_ui_adk import ADKAgent, add_adk_fastapi_endpoint
    from google.adk.agents import LlmAgent
    from google.adk.tools import ToolContext

    class AgentState(BaseModel):
        """State for the agent."""
        language: str = "english"

    def set_language(tool_context: ToolContext, new_language: str) -> Dict[str, str]:
        """Sets the language preference for the user.

        Args:
            tool_context (ToolContext): The tool context for accessing state.
            new_language (str): The language to save in state.

        Returns:
            Dict[str, str]: A dictionary indicating success status and message.
        """
        tool_context.state["language"] = new_language
        return {"status": "success", "message": f"Language set to {new_language}"}

    agent = LlmAgent(
        name="my_agent",
        model="gemini-2.5-flash",
        instruction="""
        You are a helpful assistant. Help users by answering their questions.
        Please use the language specified in state when responding to the user.
        You can set the language in state by using the set_language tool.
        """,
        tools=[set_language],
    )

    adk_agent = ADKAgent(
        adk_agent=agent,
        app_name="demo_app",
        user_id="demo_user",
        session_timeout_seconds=3600,
        use_in_memory_services=True,
    )

    app = FastAPI()
    add_adk_fastapi_endpoint(app, adk_agent, path="/")

    if __name__ == "__main__":
        import uvicorn
        uvicorn.run(app, host="0.0.0.0", port=8000)
```
```tsx title="ui/app/page.tsx"
    import { useCoAgent } from "@copilotkit/react-core"; // [!code highlight]

    // Define the agent state type, should match the actual state of your agent
    type AgentState = {
      language: "english" | "spanish";
    }

    function YourMainContent() {
      // [!code highlight:4]
      const { state } = useCoAgent<AgentState>({
        name: "my_agent", // MUST match the agent name in CopilotRuntime
        initialState: { language: "english" }  // optionally provide an initial state
      });

      // ...

      return (
        // style excluded for brevity
        <div>
          <h1>Your main content</h1>
          {/* [!code highlight:1] */}
          <p>Language: {state.language}</p>
        </div>
      );
    }
```
```tsx title="ui/app/page.tsx"
import { useCoAgentStateRender } from "@copilotkit/react-core"; // [!code highlight]

// Define the agent state type, should match the actual state of your agent
type AgentState = {
  language: "english" | "spanish";
};

function YourMainContent() {
  // ...
  // [!code highlight:7]
  useCoAgentStateRender({
    name: "my_agent", // MUST match the agent name in CopilotRuntime
    render: ({ state }) => {
      if (!state.language) return null;
      return <div>Language: {state.language}</div>;
    },
  });
  // ...
}
```

### Writing agent state
- Route: `/adk/shared-state/in-app-agent-write`
- Source: `docs/content/docs/integrations/adk/shared-state/in-app-agent-write.mdx`
- Description: Write to agent's state from your application.

```python title="agent.py"
    from typing import Dict
    from fastapi import FastAPI
    from pydantic import BaseModel
    from ag_ui_adk import ADKAgent, add_adk_fastapi_endpoint
    from google.adk.agents import LlmAgent
    from google.adk.tools import ToolContext

    class AgentState(BaseModel):
        """State for the agent."""
        language: str = "english"

    def set_language(tool_context: ToolContext, new_language: str) -> Dict[str, str]:
        """Sets the language preference for the user.

        Args:
            tool_context (ToolContext): The tool context for accessing state.
            new_language (str): The language to save in state.

        Returns:
            Dict[str, str]: A dictionary indicating success status and message.
        """
        tool_context.state["language"] = new_language
        return {"status": "success", "message": f"Language set to {new_language}"}

    agent = LlmAgent(
        name="my_agent",
        model="gemini-2.5-flash",
        instruction="""
        You are a helpful assistant. Help users by answering their questions.
        Please use the language specified in state when responding to the user.
        You can set the language in state by using the set_language tool.
        """,
        tools=[set_language],
    )

    adk_agent = ADKAgent(
        adk_agent=agent,
        app_name="demo_app",
        user_id="demo_user",
        session_timeout_seconds=3600,
        use_in_memory_services=True,
    )

    app = FastAPI()
    add_adk_fastapi_endpoint(app, adk_agent, path="/")

    if __name__ == "__main__":
        import uvicorn
        uvicorn.run(app, host="0.0.0.0", port=8000)
```
```tsx title="ui/app/page.tsx"
    import { useCoAgent } from "@copilotkit/react-core"; // [!code highlight]

    // Define the agent state type, should match the actual state of your agent
    type AgentState = {
      language: "english" | "spanish";
    }

    // Example usage in a pseudo React component
    function YourMainContent() {
      const { state, setState } = useCoAgent<AgentState>({ // [!code highlight]
        name: "my_agent", // MUST match the agent name in CopilotRuntime
        initialState: { language: "english" }  // optionally provide an initial state
      });

      // ...

      const toggleLanguage = () => {
        setState({ language: state.language === "english" ? "spanish" : "english" }); // [!code highlight]
      };

      // ...

      return (
        // style excluded for brevity
        <div>
          <h1>Your main content</h1>
          {/* [!code highlight:2] */}
          <p>Language: {state.language}</p>
          <button onClick={toggleLanguage}>Toggle Language</button>
        </div>
      );
    }
```
```tsx title="ui/app/page.tsx"
import { useCoAgent } from "@copilotkit/react-core";
import { TextMessage, MessageRole } from "@copilotkit/runtime-client-gql";  // [!code highlight]

// ...

function YourMainContent() {
  // [!code word:run:1]
  const { state, setState, run } = useCoAgent<AgentState>({
    name: "my_agent", // MUST match the agent name in CopilotRuntime
    initialState: { language: "english" }  // optionally provide an initial state
  });

  // setup to be called when some event in the app occurs
  const toggleLanguage = () => {
    const newLanguage = state.language === "english" ? "spanish" : "english";
    setState({ language: newLanguage });

    // re-run the agent and provide a hint about what's changed
    // [!code highlight:6]
    run(({ previousState, currentState }) => {
      return new TextMessage({
        role: MessageRole.User,
        content: `the language has been updated to ${currentState.language}`,
      });
    });
  };

  return (
    // ...
  );
}
```

### Shared State
- Route: `/adk/shared-state`
- Source: `docs/content/docs/integrations/adk/shared-state/index.mdx`
- Description: Create a two-way connection between your UI and agent state.

## What is shared state?

CoAgents maintain a shared state that seamlessly connects your UI with the agent's execution. This shared state system allows you to:

- Display the agent's current progress and intermediate results
- Update the agent's state through UI interactions
- React to state changes in real-time across your application

The foundation of this system is built on ADK's stateful architecture.

## When should I use this?

State streaming is perfect when you want to facilitate collaboration between your agent and the user. Any state that your ADK Agent
persists will be automatically shared by the UI. Similarly, any state that the user updates in the UI will be automatically reflected

This allows for a consistent experience where both the agent and the user are on the same page.

### Predictive state updates
- Route: `/adk/shared-state/predictive-state-updates`
- Source: `docs/content/docs/integrations/adk/shared-state/predictive-state-updates.mdx`
- Description: Stream in-progress agent state updates to the frontend.

{/* <IframeSwitcher

  This example demonstrates predictive state updates in the [CopilotKit Feature Viewer](https://feature-viewer.copilotkit.ai/adk-middleware/feature/predictive_state_updates).

## What is this?

An ADK agent's state updates discontinuously; only when state changes are explicitly made.
But even a _single operation_ often takes many seconds to run and contains sub-steps of interest to the user.

**Agent-native applications** reflect to the end-user what the agent is doing **as continuously as possible.**

CopilotKit enables this through its concept of **_predictive state updates_**.

## When should I use this?

Use predictive state updates when you want to:
- **Keep users engaged** by avoiding long loading indicators
- **Build trust** by demonstrating what the agent is working on
- Enable **agent steering** - allowing users to course-correct the agent if needed

## Important Note

When your agent finishes executing, **its final state becomes the single source of truth**. While intermediate state updates are great for real-time feedback, any changes you want to persist must be explicitly included in the final state. Otherwise, they will be overwritten when the operation completes.

## Implementation

    ### Define the state
    We'll be defining an `observed_steps` field in the state, which will be updated as the agent performs different steps of a task.

```python title="agent.py"
    from typing import Dict, List
    from fastapi import FastAPI
    from pydantic import BaseModel
    from ag_ui_adk import ADKAgent, add_adk_fastapi_endpoint
    from google.adk.agents import LlmAgent
    from google.adk.tools import ToolContext

    class AgentState(BaseModel):
        """State for the agent."""
        observed_steps: List[str] = []
```
    ### Emit the intermediate state

                    You can either manually emit state updates or configure specific tool calls to emit updates.
            For long-running tasks, you can create a tool that updates state and emits it to the frontend. In this example, we'll create a step progress tool that the LLM calls to report its progress.

```python title="agent.py"
            from typing import Dict, List
            from fastapi import FastAPI
            from pydantic import BaseModel
            from ag_ui_adk import ADKAgent, add_adk_fastapi_endpoint
            from google.adk.agents import LlmAgent
            from google.adk.tools import ToolContext

            class AgentState(BaseModel):
                """State for the agent."""
                observed_steps: List[str] = []

            def step_progress(tool_context: ToolContext, steps: List[str]) -> Dict[str, str]:
                """Reports the current progress steps.

                Args:
                    tool_context (ToolContext): The tool context for accessing state.
                    steps (List[str]): The list of steps completed so far.

                Returns:
                    Dict[str, str]: A dictionary indicating the progress was received.
                """
                tool_context.state["observed_steps"] = steps
                return {"status": "success", "message": "Progress received."}

            agent = LlmAgent(
                name="my_agent",
                model="gemini-2.5-flash",
                instruction="""
                You are a task performer. When given a task, break it down into steps
                and report your progress using the step_progress tool after completing each step.
                """,
                tools=[step_progress],
            )

            adk_agent = ADKAgent(
                adk_agent=agent,
                app_name="demo_app",
                user_id="demo_user",
                session_timeout_seconds=3600,
                use_in_memory_services=True,
            )

            app = FastAPI()
            add_adk_fastapi_endpoint(app, adk_agent, path="/")

            if __name__ == "__main__":
                import uvicorn
                uvicorn.run(app, host="0.0.0.0", port=8000)
```

              With this configuration, the agent emits state updates each time it calls the `step_progress` tool, giving the frontend real-time visibility into progress.
    ### Observe the predictions
    These predictions will be emitted as the agent runs, allowing you to track its progress before the final state is determined.

```tsx title="ui/app/page.tsx"
    "use client";

    import { useCoAgent, useCoAgentStateRender } from '@copilotkit/react-core';

    // ...
    type AgentState = {
        observed_steps: string[];
    };

    const YourMainContent = () => {
        // Get access to both predicted and final states
        const { state } = useCoAgent<AgentState>({ name: "my_agent" });

        // Add a state renderer to observe predictions
        useCoAgentStateRender({
            name: "my_agent",
            render: ({ state }) => {
                if (!state.observed_steps?.length) return null;
                return (
                    <div>
                        <h3>Current Progress:</h3>
                        <ul>
                            {state.observed_steps.map((step, i) => (
                                <li key={i}>{step}</li>
                            ))}
                        </ul>
                    </div>
                );
            },
        });

        return (
            <div>
                <h1>Agent Progress</h1>
                {state.observed_steps?.length > 0 && (
                    <div>
                        <h3>Final Steps:</h3>
                        <ul>
                            {state.observed_steps.map((step, i) => (
                                <li key={i}>{step}</li>
                            ))}
                        </ul>
                    </div>
                )}
            </div>
        )
    }
```

      The `name` parameter must exactly match the agent name you defined in your CopilotRuntime configuration (e.g., `my_agent` from the quickstart).
    ### Give it a try!
    Now you'll notice that the state predictions are emitted as the agent makes progress, giving you insight into its work before the final state is determined.
    You can apply this pattern to any long-running task in your agent.

### Workflow Execution
- Route: `/adk/shared-state/state-inputs-outputs`
- Source: `docs/content/docs/integrations/adk/shared-state/state-inputs-outputs.mdx`
- Description: Decide which state properties are received and returned to the frontend.

## What is this?

Not all state properties are relevant for frontend-backend sharing.
This guide shows how to ensure only the right portion of state is communicated back and forth.

## When should I use this?

Depending on your implementation, some properties are meant to be processed internally, while some others are the way for the UI to communicate user input.
In addition, some state properties contain a lot of information. Syncing them back and forth between the agent and UI can be costly, while it might not have any practical benefit.

## Implementation

    ### Examine your state structure
    ADK agents are stateful. As you execute tools and callbacks, that state is updated and available throughout the session. For this example,
    let's assume that the state our agent should be using can be described like this:

```python title="agent.py"
    from typing import Dict, List
    from pydantic import BaseModel

    class AgentState(BaseModel):
        """Full state for the agent."""
        question: str = ""       # Input from user
        answer: str = ""         # Output to user
        resources: List[str] = []  # Internal use only
```
    ### Organize state by purpose
    Our example case lists several state properties, each with its own purpose:
      - The **question** is being asked by the user, expecting the LLM to answer
      - The **answer** is what the LLM returns
      - The **resources** list will be used by the LLM to answer the question, and should not be communicated to the user, or set by them

    Here's a complete example showing how to structure your agent with these considerations:

```python title="agent.py"
    from typing import Dict, List
    from fastapi import FastAPI
    from pydantic import BaseModel
    from ag_ui_adk import ADKAgent, add_adk_fastapi_endpoint
    from google.adk.agents import LlmAgent
    from google.adk.tools import ToolContext

    class AgentState(BaseModel):
        """State for the agent."""
        question: str = ""       # Input: received from frontend
        answer: str = ""         # Output: sent to frontend
        resources: List[str] = []  # Internal: not shared with frontend

    def answer_question(tool_context: ToolContext, answer: str) -> Dict[str, str]:
        """Stores the answer to the user's question.

        Args:
            tool_context (ToolContext): The tool context for accessing state.
            answer (str): The answer to store in state.

        Returns:
            Dict[str, str]: A dictionary indicating success status.
        """
        tool_context.state["answer"] = answer
        return {"status": "success", "message": "Answer stored."}

    def add_resource(tool_context: ToolContext, resource: str) -> Dict[str, str]:
        """Adds a resource to the internal resources list.

        Args:
            tool_context (ToolContext): The tool context for accessing state.
            resource (str): The resource URL or reference to add.

        Returns:
            Dict[str, str]: A dictionary indicating success status.
        """
        resources = tool_context.state.get("resources", [])
        resources.append(resource)
        tool_context.state["resources"] = resources
        return {"status": "success", "message": "Resource added."}

    agent = LlmAgent(
        name="my_agent",
        model="gemini-2.5-flash",
        instruction="""
        You are a helpful assistant. When answering questions:
        1. Use add_resource to track any sources you reference (internal use)
        2. Use answer_question to provide your final answer to the user

        The question from the user is available in state as 'question'.
        """,
        tools=[answer_question, add_resource],
    )

    adk_agent = ADKAgent(
        adk_agent=agent,
        app_name="demo_app",
        user_id="demo_user",
        session_timeout_seconds=3600,
        use_in_memory_services=True,
    )

    app = FastAPI()
    add_adk_fastapi_endpoint(app, adk_agent, path="/")

    if __name__ == "__main__":
        import uvicorn
        uvicorn.run(app, host="0.0.0.0", port=8000)
```
    ### Use the state in your frontend
    Now that we know which state properties our agent uses, we can work with them in the UI:
    - **question**: Set by the UI to ask the agent something
    - **answer**: Read from the agent's response
    - **resources**: Not accessible to the UI (internal agent use only)

```tsx title="ui/app/page.tsx"
    "use client";

    import { useCoAgent } from "@copilotkit/react-core";

    // Only define the types for state you'll interact with
    type AgentState = {
      question: string;
      answer: string;
      // Note: 'resources' is intentionally omitted - it's internal to the agent
    }

    function YourMainContent() {
      const { state, setState } = useCoAgent<AgentState>({
        name: "my_agent",
        initialState: {
          question: "How's the weather in SF?",
          answer: "",
        }
      });

      const askQuestion = (newQuestion: string) => {
        setState({ ...state, question: newQuestion });
      };

      return (
        <div>
          <h1>Q&A Assistant</h1>
          <p><strong>Question:</strong> {state.question}</p>
          <p><strong>Answer:</strong> {state.answer || "Waiting for response..."}</p>
          <button onClick={() => askQuestion("What's the capital of France?")}>
            Ask New Question
          </button>
        </div>
      );
    }
```

      The `name` parameter must exactly match the agent name you defined in your CopilotRuntime configuration (e.g., `my_agent` from the quickstart).
    ### Give it a try!
    Now that we've organized state by purpose:
    - The UI can set `question` and read `answer`
    - The agent uses `resources` internally without exposing it to the frontend
    - State updates flow efficiently between frontend and backend

### Workflow Execution
- Route: `/adk/shared-state/workflow-execution`
- Source: `docs/content/docs/integrations/adk/shared-state/workflow-execution.mdx`
- Description: Decide which state properties are received and returned to the frontend.

## What is this?

Not all state properties are relevant for frontend-backend sharing.
This guide shows how to ensure only the right portion of state is communicated back and forth.

## When should I use this?

Depending on your implementation, some properties are meant to be processed internally, while some others are the way for the UI to communicate user input.
In addition, some state properties contain a lot of information. Syncing them back and forth between the agent and UI can be costly, while it might not have any practical benefit.

## Implementation

    ### Examine your state structure
    ADK agents are stateful. As you execute tools and callbacks, that state is updated and available throughout the session. For this example,
    let's assume that the state our agent should be using can be described like this:

```python title="agent.py"
    from typing import Dict, List
    from pydantic import BaseModel

    class AgentState(BaseModel):
        """Full state for the agent."""
        question: str = ""       # Input from user
        answer: str = ""         # Output to user
        resources: List[str] = []  # Internal use only
```
    ### Organize state by purpose
    Our example case lists several state properties, each with its own purpose:
      - The **question** is being asked by the user, expecting the LLM to answer
      - The **answer** is what the LLM returns
      - The **resources** list will be used by the LLM to answer the question, and should not be communicated to the user, or set by them

    Here's a complete example showing how to structure your agent with these considerations:

```python title="agent.py"
    from typing import Dict, List
    from fastapi import FastAPI
    from pydantic import BaseModel
    from ag_ui_adk import ADKAgent, add_adk_fastapi_endpoint
    from google.adk.agents import LlmAgent
    from google.adk.tools import ToolContext

    class AgentState(BaseModel):
        """State for the agent."""
        question: str = ""       # Input: received from frontend
        answer: str = ""         # Output: sent to frontend
        resources: List[str] = []  # Internal: not shared with frontend

    def answer_question(tool_context: ToolContext, answer: str) -> Dict[str, str]:
        """Stores the answer to the user's question.

        Args:
            tool_context (ToolContext): The tool context for accessing state.
            answer (str): The answer to store in state.

        Returns:
            Dict[str, str]: A dictionary indicating success status.
        """
        tool_context.state["answer"] = answer
        return {"status": "success", "message": "Answer stored."}

    def add_resource(tool_context: ToolContext, resource: str) -> Dict[str, str]:
        """Adds a resource to the internal resources list.

        Args:
            tool_context (ToolContext): The tool context for accessing state.
            resource (str): The resource URL or reference to add.

        Returns:
            Dict[str, str]: A dictionary indicating success status.
        """
        resources = tool_context.state.get("resources", [])
        resources.append(resource)
        tool_context.state["resources"] = resources
        return {"status": "success", "message": "Resource added."}

    agent = LlmAgent(
        name="my_agent",
        model="gemini-2.5-flash",
        instruction="""
        You are a helpful assistant. When answering questions:
        1. Use add_resource to track any sources you reference (internal use)
        2. Use answer_question to provide your final answer to the user

        The question from the user is available in state as 'question'.
        """,
        tools=[answer_question, add_resource],
    )

    adk_agent = ADKAgent(
        adk_agent=agent,
        app_name="demo_app",
        user_id="demo_user",
        session_timeout_seconds=3600,
        use_in_memory_services=True,
    )

    app = FastAPI()
    add_adk_fastapi_endpoint(app, adk_agent, path="/")

    if __name__ == "__main__":
        import uvicorn
        uvicorn.run(app, host="0.0.0.0", port=8000)
```
    ### Use the state in your frontend
    Now that we know which state properties our agent uses, we can work with them in the UI:
    - **question**: Set by the UI to ask the agent something
    - **answer**: Read from the agent's response
    - **resources**: Not accessible to the UI (internal agent use only)

```tsx title="ui/app/page.tsx"
    "use client";

    import { useCoAgent } from "@copilotkit/react-core";

    // Only define the types for state you'll interact with
    type AgentState = {
      question: string;
      answer: string;
      // Note: 'resources' is intentionally omitted - it's internal to the agent
    }

    function YourMainContent() {
      const { state, setState } = useCoAgent<AgentState>({
        name: "my_agent",
        initialState: {
          question: "How's the weather in SF?",
          answer: "",
        }
      });

      const askQuestion = (newQuestion: string) => {
        setState({ ...state, question: newQuestion });
      };

      return (
        <div>
          <h1>Q&A Assistant</h1>
          <p><strong>Question:</strong> {state.question}</p>
          <p><strong>Answer:</strong> {state.answer || "Waiting for response..."}</p>
          <button onClick={() => askQuestion("What's the capital of France?")}>
            Ask New Question
          </button>
        </div>
      );
    }
```

      The `name` parameter must exactly match the agent name you defined in your CopilotRuntime configuration (e.g., `my_agent` from the quickstart).
    ### Give it a try!
    Now that we've organized state by purpose:
    - The UI can set `question` and read `answer`
    - The agent uses `resources` internally without exposing it to the frontend
    - State updates flow efficiently between frontend and backend

### Common Copilot Issues
- Route: `/adk/troubleshooting/common-issues`
- Source: `docs/content/docs/integrations/adk/troubleshooting/common-issues.mdx`
- Description: Common issues you may encounter when using Copilots.

Welcome to the CopilotKit Troubleshooting Guide! Here, you can find answers to common issues

    Have an issue not listed here? Open a ticket on [GitHub](https://github.com/CopilotKit/CopilotKit/issues) or reach out on [Discord](https://discord.com/invite/6dffbvGU3D)
    and we'll be happy to help.

    We also highly encourage any open source contributors that want to add their own troubleshooting issues to [Github as a pull request](https://github.com/CopilotKit/CopilotKit/blob/main/CONTRIBUTING.md).

## I am getting network errors / API not found error

If you're encountering network or API errors, here's how to troubleshoot:

        Verify your endpoint configuration in your CopilotKit setup:

```tsx
        <CopilotKit
          runtimeUrl="/api/copilotkit"
        >
          {/* Your app */}
        </CopilotKit>
```

        or, if using CopilotCloud
```tsx
        <CopilotKit
            publicApiKey="<your-copilot-cloud-public-api-key>"
        >
            {/* Your app */}
        </CopilotKit>
```

        Common issues:
        - Missing leading slash in endpoint path
        - Incorrect path relative to your app's base URL, or, if using absolute paths, incorrect full URL
        - Typos in the endpoint path
        - If using CopilotCloud, make sure to omit the `runtimeUrl` property and provide a valid API key
        If you're running locally and getting connection errors, try using `127.0.0.1` instead of `localhost`:

```bash
        # If this doesn't work:
        http://localhost:3000/api/copilotkit

        # Try this instead:
        http://127.0.0.1:3000/api/copilotkit
```

        This is often due to local DNS resolution issues in `/etc/hosts` or network configuration.
        Make sure your backend server is:
        - Running on the expected port
        - Accessible from your frontend
        - Not blocked by CORS or firewalls

        Check the [quickstart](/quickstart) to see how to set it up

## I am getting "CopilotKit's Remote Endpoint" not found error

If you're getting a "CopilotKit's Remote Endpoint not found" error, it usually means the server serving `/info` endpoint isn't accessible. Here's how to fix it:

        Refer to [Remote Python Endpoint](/guides/backend-actions/remote-backend-endpoint) to see how to set it up
        The `/info` endpoint should return agent or action information. Test it directly:

```bash
        curl -v -d '{}' http://localhost:8000/copilotkit/info
```
        The response looks something like this:
```bash
        * Host localhost:8000 was resolved.
        * IPv6: ::1
        * IPv4: 127.0.0.1
        *   Trying [::1]:8000...
        * connect to ::1 port 8000 from ::1 port 55049 failed: Connection refused
        *   Trying 127.0.0.1:8000...
        * Connected to localhost (127.0.0.1) port 8000
        > POST /copilotkit/info HTTP/1.1
        > Host: localhost:8000
        > User-Agent: curl/8.7.1
        > Accept: */*
        > Content-Length: 2
        > Content-Type: application/x-www-form-urlencoded
        >
        * upload completely sent off: 2 bytes
        < HTTP/1.1 200 OK
        < date: Thu, 16 Jan 2025 17:45:05 GMT
        < server: uvicorn
        < content-length: 214
        < content-type: application/json
        <
        * Connection #0 to host localhost left intact
        {"actions":[],"agents":[{"name":"my_agent","description":"A helpful agent.","type":"langgraph"},],"sdkVersion":"0.1.32"}%
```

        As you can see, it's a JSON response with your registered agents and actions, as well as the `200 OK` HTTP response status.
        If you see a different response, check your FastAPI logs for errors.

## Connection issues with tunnel creation

If you notice the tunnel creation process spinning indefinitely, your router or ISP might be blocking the connection to CopilotKit's tunnel service.

        To verify connectivity to the tunnel service, try these commands:

```bash
        ping tunnels.devcopilotkit.com
        curl -I https://tunnels.devcopilotkit.com
        telnet tunnels.devcopilotkit.com 443
```

        If these fail, your router's security features or ISP might be blocking the connection. Common solutions:
        - Check router security settings
        - Contact your ISP to verify if they're blocking the connection
        - Try a different network to confirm the issue

### Error Debugging & Observability
- Route: `/adk/troubleshooting/error-debugging`
- Source: `docs/content/docs/integrations/adk/troubleshooting/error-debugging.mdx`
- Description: Learn how to debug errors in CopilotKit with dev console and set up error observability for monitoring services.

# How to Debug Errors

CopilotKit provides visual error display for local development and debugging. This feature is completely free and requires no API keys.

## Quick Setup

```tsx
import { CopilotKit } from "@copilotkit/react-core";

export default function App() {
  return (
    <CopilotKit
      runtimeUrl="<your-runtime-url>"
      showDevConsole={true} // [!code highlight]
    >
      {/* Your app */}
    </CopilotKit>
  );
}
```

  Avoid showing the dev console in production as it exposes internal error details to end users.

## When to Use Development Debugging

- **Local development** - See errors immediately in your UI
- **Quick debugging** - No setup required, works out of the box
- **Testing** - Verify error handling during development

## Troubleshooting

### Development Debugging Issues

- **Dev console not showing:**
  - Confirm `showDevConsole={true}`
  - Check for JavaScript errors in the browser console
  - Ensure no CSS is hiding the error banner

### Migrate to 1.10.X
- Route: `/adk/troubleshooting/migrate-to-1.10.X`
- Source: `docs/content/docs/integrations/adk/troubleshooting/migrate-to-1.10.X.mdx`
- Description: Migration guide for CopilotKit 1.10.X

## Overview

CopilotKit 1.10.X introduces a new headless UI system and simplified message formats. Most existing code will continue to work, but you may need to update custom message handling.

**What you need to know:**
- Message format has changed from classes to plain objects
- New headless UI hook available for advanced use cases
- Backwards compatibility maintained for most features

## Key Improvements & Changes

### Enhanced Message Format

Messages now use plain objects instead of classes for better performance and simpler handling.

#### Before
```tsx
const message = new TextMessage({
  role: MessageRole.Assistant,
  content: "Hello, how are you?",
})
```

#### After
```tsx
const message = { 
  role: "assistant", 
  content: "Hello, how are you?" 
}
```

### Simplified Message Type Checking

Message type checking has been streamlined for better developer experience. Instead of using the previous
`isTextMessage` or adjacent methods, you can now check the `role` property of the message.

#### Before
```tsx
if (message.isTextMessage()) {
  if (message.role === "assistant") {
    console.log(message.content)
  }
  if (message.role === "user") {
    console.log(message.content)
  }
}

if (message.isImageMessage()) {
  console.log(message.image)
}

if (message.isActionExecutionMessage()) {
  console.log(message.toolCalls)
}

// etc...
```

#### After
```tsx
if (message.role === "assistant") {
  console.log(
    message.content,
    message.toolCalls,
    message.image,
  )
}

if (message.role === "user") {
  console.log(
    message.content,
    message.image,
  )
}
```

### Custom Assistant Messages
Previously, you had to use the `subComponent` property to render custom assistant messages. Now you can use the `generativeUI` property instead.

**Important!** Both will continue to work.

#### Before

```tsx
import { AssistantMessageProps } from "@copilotkit/react-ui";

export const AssistantMessage = (props: AssistantMessageProps) => {
  const { message, subComponent } = props;

  return (
    <div style={{ marginBottom: "0.5rem" }}>{subComponent}</div>
  );
};
```

#### After

```tsx
import { AssistantMessageProps } from "@copilotkit/react-ui";

export const AssistantMessage = (props: AssistantMessageProps) => {
  const { message } = props;

  return (
    <div style={{ marginBottom: "0.5rem" }}>{message.generativeUI}</div>
  );
};
```

#### Backwards Compatibility

- Custom sub-components remain fully supported
- Both `subComponent` (legacy) and `generativeUI` (new) properties work
- Existing `useCopilotChat` code continues to function

## New Features

### Advanced Headless UI Hook

New `useCopilotChatHeadless_c` hook provides complete control over chat UI:

**Features:**
- Complete control over chat UI rendering
- Built-in generative UI support
- Advanced suggestions management
- Interrupt handling for human-in-the-loop workflows

An example of how you might use the new Headless UI hook:

```tsx
const { messages, suggestions, interrupt } = useCopilotChatHeadless_c();

return (
  <div>
    {suggestions.map((suggestion) => (
      <div key={suggestion.id}>{suggestion.title}</div>
    ))}

    {interrupt}

    {messages.map((message) => {
      switch (message.role) {
        case "assistant":
          if (message.generativeUI) return message.generativeUI
          return <div key={message.id}>{message.content}</div>
        case "user":
          return <div key={message.id}>{message.content}</div>
      }
    })}
  </div>
)
```

[Read more about the new headless UI hook and get started](/premium/headless-ui).

## What about `useCopilotChat`?

With the introduction of the new headless UI hook, we are starting the deprecation of `useCopilotChat`. While it will remain supported for several months in maintenance mode, all new headless UI features will be added to `useCopilotChatHeadless_c`.

We recommend migrating to the new hook for new projects. However, please feel free to continue using `useCopilotChat` until you are ready to migrate.

### When to Migrate

**Continue using `useCopilotChat` if:**
- Your current implementation works well
- You don't need advanced headless features
- You prefer gradual migration

**Migrate to `useCopilotChatHeadless_c` if:**
- Starting a new project
- Building new headless UI implementations
- Need generative UI capabilities
- Want access to advanced suggestions and interrupts
- Building fully custom chat experiences

### Migrate to 1.8.2
- Route: `/adk/troubleshooting/migrate-to-1.8.2`
- Source: `docs/content/docs/integrations/adk/troubleshooting/migrate-to-1.8.2.mdx`
- Description: Migration guide for CopilotKit 1.8.2

## What's changed?

### New Look and Feel

CopilotKit 1.8.2 introduces a new default look and feel. This includes new use of theming variables, new components, and generally a fresh look.

**Click the button in the bottom right to see the new look and feel in action!**

### Thumbs Up/Down Handlers

The chat components now have `onThumbsUp` and `onThumbsDown` handlers. Specifying these will add icons to each message
on hover allowing the user to provide feedback.

```tsx
<CopilotChat 
  onThumbsUp={(message) => console.log(message)} 
  onThumbsDown={(message) => console.log(message)}     
/>
```

This was previously achievable in our framework, but we're making it first class now! You can use this to help fine-tune your model through CopilotKit
or just generally track user feedback.

### ResponseButton prop removed

The `ResponseButton` prop has been removed. This was a prop that was used to customize the button that appears after a response was generated
in the chat.

In its place, we now place buttons below each message for:
- Thumbs up
- Thumbs down
- Copy
- Regenerate

The behvior, icons and styling for each of these buttons can be customized. Checkout our [look and feel guides](/custom-look-and-feel) for more details.

### Out-of-the-box dark mode support

CopilotKit now has out-of-the-box dark mode support. This is controlled by the `.dark` class (Tailwind) as well as the
`color-scheme` CSS selector.

If you would like to make a custom theme, you can do so by checking out the [custom look and feel](/custom-look-and-feel) guides.
