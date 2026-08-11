# QA: Frontend Tools — Async (OpenClaw)

Demo source: `src/app/demos/frontend-tools-async/page.tsx`
Route: `/demos/frontend-tools-async` · Agent: `frontend-tools-async`

## What it exercises

A frontend tool (`query_notes`) defined in React with `useFrontendTool`, whose
handler is **async** — it awaits a simulated client-side DB round-trip (500ms
`sleep`) before returning matching notes. The schema is forwarded over AG-UI in
`RunAgentInput.tools`; the ag-ui adapter hands it to OpenClaw as a
caller-provided **client tool** (via `runtime.agent.runEmbeddedAgent({ clientTools })`),
the only tool list the gateway exposes to the model. When the model calls it,
the run stops with a pending tool call, ag-ui emits `TOOL_CALL_START/ARGS/END`,
and the page handler runs locally — searching the in-browser `NOTES_DB` — then
feeds the awaited result back so the agent can summarize what it found. No
backend tool is involved; the query runs entirely in the browser.

The tool has a custom `render` (`NotesCard`, `data-testid="notes-card"`) that
shows a loading state while the async handler is in flight, then the matching
notes.

## Manual steps

1. Open the demo. Confirm the chat composer renders and the suggestion chips
   appear ("Find project-planning notes", "Search for 'auth'", etc.).
2. Ask: **"Find my notes about project planning."** (or click the first chip).
3. Expect: the agent calls `query_notes`, the `NotesCard` appears showing
   **"Querying local notes DB..."** (the loading state), and after ~500ms it
   fills in with the matching notes (Q2 kickoff, retrospective, career planning,
   etc.).
4. Confirm the agent's chat reply **summarizes the notes it found** — the
   awaited result was fed back into the run coherently.
5. Empty case: ask **"Search my notes for xyzabcnonsense."** Confirm the card
   renders with **"No notes matched."** and the agent says nothing was found.

## Assertion bar

- The `NotesCard` shows the loading state first, then the results — proving the
  agent waited on the async handler before replying.
- Exactly one tool-call sequence per request (no duplicate render).
- The reply after the tool result references the actual notes returned (not a
  hallucinated list).
- The empty-keyword case renders "No notes matched." rather than fabricating
  notes.

## Protocol-level check (no browser)

Inside the running container, POST a `RunAgentInput` carrying a `query_notes`
tool to `http://127.0.0.1:8000/v1/ag-ui/operator` (Bearer gateway token,
`Accept: text/event-stream`) and confirm the SSE contains a single
`TOOL_CALL_START` for `query_notes` with the expected `keyword` arg, then
`RUN_FINISHED`. The handler executes client-side, so the gateway only emits the
tool call — it does not run the search itself.

## Notes

- Supported (frontend-forwarded tool); see `PARITY_NOTES.md`. The async path is
  identical to `frontend-tools` except the handler awaits before returning.
- `NOTES_DB` is a deterministic in-browser fixture (`fake-notes-db.ts`), so
  results are reproducible for screenshots and specs.
