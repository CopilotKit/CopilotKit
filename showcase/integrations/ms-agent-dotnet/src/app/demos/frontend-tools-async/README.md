# Frontend Tools (Async Handlers)

## What This Demo Shows

The `useFrontendTool` handler can be `async`. This demo simulates a client-side data store (a fake "notes DB") and the agent queries it through a tool whose handler `await`s a round-trip before returning a result.

## How to Interact

Try asking:

- "Find my notes about project planning"
- "Search my notes for anything related to auth"
- "Do I have any notes tagged reading?"

## Technical Details

The tool's handler awaits a simulated delay and then filters a local in-memory array. The agent waits for the Promise to resolve before continuing.

```tsx
useFrontendTool({
  name: "query_notes",
  parameters: z.object({ keyword: z.string() }),
  handler: async ({ keyword }) => {
    await sleep(500);
    return { keyword, count, notes };
  },
  render: ({ args, result, status }) => (
    <NotesCard loading={status !== "complete"} ... />
  ),
});
```

The `render` function drives a loading UI while the async handler is in-flight, then renders the returned notes. No backend code is involved — the tool executes entirely in the browser.
