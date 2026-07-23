# Tool Rendering

## What This Demo Shows

Backend agent tools rendered as UI components

## How to Interact

Try asking your Copilot to:

- "What's the weather like in San Francisco?"
- "Check the weather in Tokyo and New York"
- "Can you look up the current conditions in London?"

## Technical Details

What's happening technically:

- **Backend tools** are defined in the agent (e.g., `get_weather`) and called by the LLM when the user's query matches
- **`useRenderTool`** on the frontend registers a React component that renders whenever the agent calls that tool
- The render function receives `args` (input parameters), `result` (tool output), and `status` ("executing" or "complete") so the UI can show loading states
- The tool result is displayed as a rich UI card instead of plain text — demonstrating how agent actions can produce structured, visual output

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
