# Frontend Tools (In-App Actions)

## What This Demo Shows

Frontend tools (a.k.a. "in-app actions") let the agent call functions that live in your React app. The agent reasons about when to invoke them based on natural conversation — the handler runs entirely client-side.

## How to Interact

Try asking:

- "Change the background to a blue-to-purple gradient"
- "Make the background a sunset theme"
- "Set the background to black"

## Technical Details

A frontend tool is registered with `useFrontendTool`:

```tsx
useFrontendTool({
  name: "change_background",
  description: "...",
  parameters: z.object({ background: z.string() }),
  handler: async ({ background }) => {
    setBackground(background);
    return { status: "success" };
  },
});
```

CopilotKit forwards the tool schema to the Microsoft Agent Framework agent via the AG-UI protocol. The agent decides when to call it based on the conversation, and the handler runs in the browser — no backend implementation required.
