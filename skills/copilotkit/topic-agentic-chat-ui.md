# Agentic Chat UI

Chat UI integration patterns, prebuilt components, and customization entry points.

## Guidance
### Chat Components
- Route: `/agentic-chat-ui`
- Source: `docs/content/docs/(root)/agentic-chat-ui.mdx`
- Description: Customizable, drop-in components for building AI-powered chat interfaces

## Pre-built components for agentic chat

CopilotKit's chat components give you a fully functional, customizable AI chat interface out of the box.
They handle streaming, generative UI, and deep customization — so you can focus on your agent's behavior, not UI plumbing.

## Get started by choosing your AI backend

The chat components work with any AI backend. Pick your integration to get started.

### Prebuilt Components
- Route: `/prebuilt-components`
- Source: `docs/content/docs/(root)/prebuilt-components.mdx`
- Description: Customizable, drop-in components for building AI-powered chat interfaces

## Pre-built components for agentic chat

CopilotKit's chat components give you a fully functional, customizable AI chat interface out of the box.
They handle streaming, generative UI, and deep customization — so you can focus on your agent's behavior, not UI plumbing.

## Get started by choosing your AI backend

### Programmatic Control
- Route: `/programmatic-control`
- Source: `docs/content/docs/(root)/programmatic-control.mdx`
- Description: Build non-chat agent experiences with full programmatic control.

## What is this?

Programmatic control lets you run agents outside of a chat UI — trigger agent runs, access results, and manage state entirely from code. Build agent-powered features that don't require a chat window.

```tsx
  import { useAgent, useCopilotKit } from "@copilotkit/react-core/v2";

  export function AgentButton() {
    const { agent } = useAgent();
    const { copilotkit } = useCopilotKit();

    const handleClick = async () => {
      await copilotkit.runAgent("Analyze the current data");
    };

    return (
      <button onClick={handleClick} disabled={agent.isRunning}>
        {agent.isRunning ? "Analyzing..." : "Run Analysis"}
      </button>
    );
  }
```

## When should I use this?

Use programmatic control when you want to:
- Trigger agent runs from buttons, forms, or other UI elements
- Build agent features without a chat window
- Access agent state and results programmatically
- Create fully custom agent-driven workflows

## Get started by choosing your AI backend

### Fully Headless UI
- Route: `/custom-look-and-feel/headless-ui`
- Source: `docs/content/docs/(root)/custom-look-and-feel/headless-ui.mdx`
- Description: Fully customize your Copilot's UI from the ground up using headless UI

## What is this?

A headless UI gives you full control over the chat experience — you bring your own components, layout, and styling while CopilotKit handles agent communication, message management, and streaming.

## When should I use this?

Use headless UI when the [slot system](/custom-look-and-feel/slots) isn't enough — for example, when you need a completely different layout, want to embed the chat into an existing UI, or are building a non-chat interface that still communicates with an agent.

## Get started by choosing your AI backend

### Slots
- Route: `/custom-look-and-feel/slots`
- Source: `docs/content/docs/(root)/custom-look-and-feel/slots.mdx`
- Description: Customize CopilotKit's built-in UI components using the slot system.

## What is this?

Slots let you customize CopilotKit's pre-built chat components without building everything from scratch. Override specific parts of the UI — message bubbles, input areas, headers — while keeping the rest of the default behavior.

## When should I use this?

Use slots when you want to:
- Customize specific parts of the chat UI (e.g. message rendering, input area)
- Match your app's design system without building a fully custom chat
- Add custom elements like typing indicators, avatars, or action buttons

## Get started by choosing your AI backend
