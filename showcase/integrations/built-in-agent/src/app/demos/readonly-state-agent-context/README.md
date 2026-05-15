# Readonly Agent Context (built-in-agent)

Frontend publishes structured read-only context via `useAgentContext`. The
runtime appends each entry to `systemPrompts` (see
`convertInputToTanStackAI`), so the in-process built-in-agent has access to
the user's name, timezone, and recent activity on every turn — no agent
changes required.

- Frontend pattern only — uses default `/api/copilotkit`
- Key file: `page.tsx`
