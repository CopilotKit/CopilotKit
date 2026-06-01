# QA: Sub-Agents — Built-in Agent (TanStack AI)

## Prerequisites

- Set `OPENAI_API_KEY` in `.env.local` (or environment).
- Run `npm install --legacy-peer-deps && npm run dev` from the `built-in-agent/` package directory.
- Demo URL: `http://localhost:3000/demos/subagents`

## Page load

- [ ] Page heading "Sub-Agents" is visible.
- [ ] Hint text referencing `delegate_to_planner` / `delegate_to_researcher` tool names is visible.
- [ ] Chat input is visible.

## Happy path interaction

- [ ] Send: "Plan a 2-day trip to Tokyo with key sights." Verify that one or more delegation cards appear inline in the chat. Each card shows the subagent role ("planner" or "researcher"), a task description, and a "running…" status while in progress.
- [ ] After the agent finishes, verify the delegation card(s) transition to "· done" status and display the subagent's output text.

## Edge cases worth checking

- [ ] Send a message that does not require delegation (e.g. "What is 3 × 7?"). Verify the agent replies without rendering any delegation cards.
- [ ] Send a request that triggers both planner and researcher subagents. Verify two separate delegation cards render, one per subagent.
