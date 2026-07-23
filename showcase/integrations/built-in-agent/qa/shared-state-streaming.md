# QA: State Streaming — Built-in Agent (TanStack AI)

## Prerequisites

- Set `OPENAI_API_KEY` in `.env.local` (or environment).
- Run `npm install --legacy-peer-deps && npm run dev` from the `built-in-agent/` package directory.
- Demo URL: `http://localhost:3000/demos/shared-state-streaming`

## Page load

- [ ] Page heading "State Streaming" is visible in the left column.
- [ ] Left panel shows the italic placeholder "The agent will fill this panel as it streams updates." inside a bordered pre block.
- [ ] Chat input is visible in the right column.

## Happy path interaction

- [ ] Send: "Write a short essay about small habits, and stream the document to state as you go." Verify that text begins appearing in the left panel incrementally while the agent is still responding (not only after it finishes). This requires the agent to call `AGUISendStateDelta` with `{ op: "replace", path: "/document", value: <partial text> }` on each chunk.
- [ ] After the agent finishes, verify the full essay text is displayed in the left panel.

## Edge cases worth checking

- [ ] Send a message that does not ask for document streaming (e.g. "What time is it?"). Verify the agent replies in chat and the left document panel remains unchanged.
- [ ] Send a second streaming request. Verify the left panel is replaced with the new document rather than appending to the previous one.
