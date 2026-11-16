# Frontend Tools (In-App Actions)

## What This Demo Shows

Some actions belong in the browser, not on the agent server: a change to the page, a read of local state, a dialog. A frontend tool lets the agent call a function that lives in your React app.

- **Frontend tool**: the page registers `change_background`. The agent calls it to change the page background.
- **Sidebar chat**: `CopilotSidebar` opens next to the page.
- **Suggestions**: three theme prompts show as chips in the chat.

## How to Interact

Click a theme suggestion, or type your own prompt. For example:

- "Change the background to a blue-to-purple gradient"
- "Make the background a sunset theme"
- "Set the background to black"

The background changes when the agent calls the tool.

## Technical Details

`useFrontendTool` registers the tool with a name, a description, a Zod schema for its parameters, and a handler:

```tsx
useFrontendTool({
  name: "change_background",
  description: "...",
  parameters: z.object({ background: z.string() }),
  handler: async ({ background }) => {
    setPageBackground(background);
    return { status: "success" };
  },
});
```

- CopilotKit sends the name, the description and the schema of the tool to the agent on each run.
- The agent decides when to call the tool. The handler runs in the browser.
- The return value of the handler goes back to the agent as the tool result.
- `useDemoRuntimeUrl("frontend-tools")` makes the runtime URL, `/api/<integration>/frontend-tools`.
