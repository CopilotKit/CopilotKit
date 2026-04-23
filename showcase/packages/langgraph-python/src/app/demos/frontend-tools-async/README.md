# Frontend Tools (Async)

## What This Demo Shows

A frontend tool with an `async` handler — the agent calls a browser-side function, which awaits a simulated local "notes DB" query and returns matching notes for the agent to summarize.

- **Async frontend handler**: the tool awaits a 500ms simulated DB round-trip before returning results
- **Client-owned data**: the "notes database" lives entirely in the browser, never touching the backend
- **Live render state**: a `NotesCard` shows a "Querying local notes DB..." loading state while the handler is in flight, then swaps to the matched notes

## How to Interact

Click a suggestion chip, or try asking:

- "Find my notes about project planning."
- "Search my notes for anything related to auth."
- "Do I have any notes tagged reading?"

The agent extracts a keyword, calls `query_notes` in the browser, and summarizes what came back.

## Technical Details

```tsx
useFrontendTool({
  name: "query_notes",
  parameters: z.object({ keyword: z.string() }),
  handler: async ({ keyword }) => {
    await sleep(500);
    const matches = NOTES_DB.filter(/* case-insensitive match */).slice(0, 5);
    return { keyword, count: matches.length, notes: matches };
  },
  render: ({ args, result, status }) => (
    <NotesCard loading={status !== "complete"} keyword={args?.keyword} notes={parse(result).notes} />
  ),
});
```

CopilotKit forwards the tool's schema to the agent at runtime, so the Python `frontend_tools_async` graph registers no tools of its own. The `render` prop ties the card's loading state to `status` so the full async path is visible end-to-end.
