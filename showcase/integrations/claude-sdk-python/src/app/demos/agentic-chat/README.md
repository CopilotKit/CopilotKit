# Agentic Chat

## What This Demo Shows

Natural conversation with frontend tool execution

## How to Interact

Try asking your Copilot to:

- "Can you change the background color to something more vibrant?"
- "Make the background a blue to purple gradient"
- "What's the weather like in San Francisco?"
- "Set the background to a sunset-themed gradient"

You can also chat about other topics — the agent will respond conversationally while having the ability to use your UI tools when appropriate.

## Technical Details

**Frontend tools** are registered using `useFrontendTool`:

- `change_background` — accepts a CSS background value and applies it to the chat container
- CopilotKit automatically exposes this function to the agent
- The agent determines when to call the tool based on the user's request

**Backend tool rendering** uses `useRenderTool`:

- `get_weather` — a backend tool that the agent calls; the frontend renders the result as a weather card
- The render function receives `args`, `result`, and `status` for loading/complete states

**Agent context** is provided via `useAgentContext`:

- Sends the user's name to the agent so it can personalize responses

**Suggestions** are configured with `useConfigureSuggestions`:

- Static suggestions shown as quick-action buttons below the chat

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
