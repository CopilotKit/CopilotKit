# Frontend Tools (In-App Actions)

## What This Demo Shows

Frontend tools (a.k.a. "in-app actions") let the agent call functions that live in your React app. The agent reasons about when to invoke them based on natural conversation.

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

CopilotKit automatically advertises the tool to the agent. The agent decides when to call it based on the conversation, and the handler runs client-side.
