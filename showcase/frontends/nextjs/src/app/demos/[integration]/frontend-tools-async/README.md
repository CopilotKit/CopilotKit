# Frontend Tools (Async Handlers)

## What This Demo Shows

Some data that the agent needs lives only in the browser, for example a local cache or IndexedDB. A frontend tool with an `async` handler lets the agent read that data and wait for the answer.

- **Async frontend tool**: the page registers `query_notes`. Its handler waits 500 ms, then searches a local notes store.
- **Tool UI**: a `render` function shows a Notes DB card. The card shows a loading state, then the matching notes.
- **Suggestions**: three search prompts show as chips below the chat input.

## How to Interact

Click a suggestion, or type your own prompt. For example:

- "Find my notes about project planning"
- "Search my notes for anything related to auth"
- "Do I have any notes tagged reading?"

The agent calls `query_notes`, and a Notes DB card shows the notes that match.

## Technical Details

The handler is `async`. The agent waits until its Promise resolves, then uses the result in its answer:

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

- `fake-notes-db.ts` holds seven fixed notes, so the results are the same on each run.
- The tool runs only in the browser. The agent server has no code for it.
