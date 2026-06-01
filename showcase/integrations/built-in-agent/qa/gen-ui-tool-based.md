# QA: Tool-Based Generative UI — Built-in Agent (TanStack AI)

## Prerequisites

- Set `OPENAI_API_KEY` in `.env.local` (or environment).
- Run `npm install --legacy-peer-deps && npm run dev` from the `built-in-agent/` package directory.
- Demo URL: `http://localhost:3000/demos/gen-ui-tool-based`

## Page load

- [ ] Page heading "Tool-Based Generative UI" is visible.
- [ ] Hint text 'Try: "Write me a haiku about morning dew."' is visible.
- [ ] Chat input is visible.

## Happy path interaction

- [ ] Send: "Write me a haiku about morning dew." While the agent is composing, verify a "Composing haiku about morning dew…" in-progress card appears inline in the chat.
- [ ] After the agent finishes, verify the card changes to an amber-background card titled "Haiku — morning dew" containing three lines of text in serif italic style.

## Edge cases worth checking

- [ ] Request a second haiku on a different topic. Verify a new haiku card is rendered in the chat without replacing the first.
- [ ] Send a message that does not request a haiku (e.g. "Tell me a joke"). Verify the agent replies in chat without rendering a haiku card.
