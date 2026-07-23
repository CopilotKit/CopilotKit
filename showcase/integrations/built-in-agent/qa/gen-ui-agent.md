# QA: Agentic Generative UI — Built-in Agent (TanStack AI)

## Prerequisites

- Set `OPENAI_API_KEY` in `.env.local` (or environment).
- Run `npm install --legacy-peer-deps && npm run dev` from the `built-in-agent/` package directory.
- Demo URL: `http://localhost:3000/demos/gen-ui-agent`

## Page load

- [ ] Page heading "Agentic Generative UI" is visible in the left column.
- [ ] Left panel shows the placeholder "No plan yet. The agent will fill this panel as it works." in the bordered box.
- [ ] Chat input is visible in the right column.

## Happy path interaction

- [ ] Send: "Plan a 4-step morning routine and execute it; emit the plan to state." Verify that a "Plan" panel appears in the left column listing numbered steps.
- [ ] While the agent is responding, verify that steps with status `in_progress` show a bullet (•) and steps marked `done` show a checkmark (✓) with strikethrough text.
- [ ] After the agent finishes, verify all steps show ✓ and the panel title "Plan" remains visible.

## Edge cases worth checking

- [ ] Send a plain conversational message (e.g. "What is the capital of France?"). Verify the agent replies in chat and the left panel remains unchanged.
- [ ] Send a second planning request. Verify the left panel replaces the previous plan with the new one.
