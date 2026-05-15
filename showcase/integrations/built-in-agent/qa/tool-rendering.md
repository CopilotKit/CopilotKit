# QA: Tool Rendering — Built-in Agent (TanStack AI)

## Prerequisites

- Set `OPENAI_API_KEY` in `.env.local` (or environment).
- Run `npm install --legacy-peer-deps && npm run dev` from the `built-in-agent/` package directory.
- Demo URL: `http://localhost:3000/demos/tool-rendering`

## Page load

- [ ] Page heading "Tool Rendering" is visible.
- [ ] Hint text 'Try: "What\'s the weather in Tokyo?"' is visible.
- [ ] Chat input is visible.

## Happy path interaction

- [ ] Send: "What's the weather in Tokyo?" While the tool runs, verify a "Fetching weather…" in-progress card appears inline in the chat.
- [ ] After the agent finishes, verify the card shows: city name, temperature (°F), condition text, and humidity percentage.
- [ ] Ask about weather in a second city (e.g. "And what about London?"). Verify a second weather card renders without disturbing the first.

## Edge cases worth checking

- [ ] Send a message that triggers a tool other than `weather` (e.g. "Tell me today's date"). Verify the generic tool card renders showing the tool name, status, and JSON payload — not a custom weather card.
- [ ] Send a plain conversational message (e.g. "Hi there"). Verify the agent replies normally with no tool cards rendered.
