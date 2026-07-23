# QA: Agentic Chat — Built-in Agent (TanStack AI)

## Prerequisites

- Set `OPENAI_API_KEY` in `.env.local` (or environment).
- Run `npm install --legacy-peer-deps && npm run dev` from the `built-in-agent/` package directory.
- Demo URL: `http://localhost:3000/demos/agentic-chat`

## Page load

- [ ] Page heading "Agentic Chat" is visible.
- [ ] Hint text 'Try: "Set the background to a sunset gradient."' is visible below the heading.
- [ ] Chat input is visible and accepting text.

## Happy path interaction

- [ ] Type "Set the background to a sunset gradient" and send. Verify the page background changes from the default to a gradient (not the same flat color it started with).
- [ ] Type "Make it a solid dark navy background" and send. Verify the background updates again to a dark solid color.

## Edge cases worth checking

- [ ] After a background change, send an unrelated message (e.g. "Hello"). Verify the agent replies in chat and the background stays unchanged.
- [ ] Reload the page. Verify the background resets to the default theme color (background state is not persisted across page loads).
