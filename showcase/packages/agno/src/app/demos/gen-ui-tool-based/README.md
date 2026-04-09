# Tool-Based Generative UI

## What This Demo Shows

Agent uses tools to trigger UI generation

## How to Interact

Try asking your Copilot to:

- "What's the weather forecast for this week in San Francisco?"
- "Show me the weather in Paris"
- "Compare the weather in Tokyo and London"

The agent generates structured data via tools, and the frontend renders it as rich UI components.

## Technical Details

What's happening technically:

- **Generative UI** means the agent's tool calls produce structured data that the frontend renders as custom React components
- Unlike plain text responses, the agent returns tool results with typed parameters (city, temperature, conditions)
- `useRenderTool` maps each tool name to a React component, so `get_weather` renders a weather card with icons, temperature displays, and forecast details
- The agent decides when to call the tool based on context — it can mix tool-based UI generation with regular text responses
- This pattern enables agents to create dynamic, data-driven interfaces on demand

## Building With This

If you're extending this demo or building something similar, here are key things to know:

### Styling Inside the Chat

Content rendered inside CopilotKit's chat area (via `useRenderTool`, `useHumanInTheLoop`, `useFrontendTool`) runs inside CopilotKit's component tree. Standard Tailwind classes may not work here because Tailwind v4 can't statically detect them.

**Use inline styles** for any UI rendered inside the chat:

```tsx
// Do this
<div style={{ padding: "24px", borderRadius: "12px", background: "#fff" }}>

// Not this — Tailwind may purge these classes
<div className="p-6 rounded-xl bg-white">
```

### Chat Layout

Wrap `CopilotChat` in a constraining div for proper spacing:

```tsx
<div className="flex justify-center items-center h-screen w-full">
  <div className="h-full w-full md:w-4/5 md:h-4/5 rounded-lg">
    <CopilotChat className="h-full rounded-2xl max-w-6xl mx-auto" />
  </div>
</div>
```

### Overriding CopilotKit Styles

CopilotKit uses `cpk:` prefixed classes internally. To override them, create a **separate CSS file** (not in globals.css — Tailwind purges it):

```css
/* copilotkit-overrides.css */
.copilotKitInput {
  border-radius: 0.75rem;
  border: 1px solid var(--copilot-kit-separator-color) !important;
}
```

Import it in `layout.tsx` after `globals.css`.

### Images and Icons

- Don't reference local image files from agent-generated content (they won't exist). Add `onError` fallbacks.
- Use emoji instead of SVG icons inside chat messages (`fill="currentColor"` renders unpredictably in the chat context).

See the full [Styling Guide](https://github.com/CopilotKit/CopilotKit/blob/main/showcase/STYLING-GUIDE.md) for more details.
