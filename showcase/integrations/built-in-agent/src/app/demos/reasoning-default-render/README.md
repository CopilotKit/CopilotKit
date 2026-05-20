# Reasoning Default Render (built-in-agent)

Zero-config rendering of the agent's reasoning chain. Same backend as
`agentic-chat-reasoning` (`/api/copilotkit-reasoning`, reasoning-capable
OpenAI model with `reasoning_effort: "low"`) — but the page passes no
custom `reasoningMessage` slot, so CopilotKit's built-in
`CopilotChatReasoningMessage` handles the render: a collapsible card with
"Thinking…" / "Thought for X" header.

The point of the demo is "you get this for free" — drop a reasoning
model into the factory and reasoning UI appears with no extra frontend
work.

- Dedicated route: `/api/copilotkit-reasoning`
- Single-route mode, registered under agent ID `reasoning-default-render`
- Key files: `page.tsx`,
  `../../api/copilotkit-reasoning/route.ts`,
  `../../../lib/factory/reasoning-factory.ts`
