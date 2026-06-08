# Agentic Chat: Reasoning (built-in-agent)

Visible chain-of-thought during normal conversation. Built on the
`/api/copilotkit-reasoning` route, whose factory uses a reasoning-capable
OpenAI model (`gpt-5.2`) with `reasoning_effort: "low"` so the upstream
adapter emits reasoning deltas. The runtime's tanstack converter
translates those into AG-UI `REASONING_START` / `REASONING_MESSAGE_CONTENT`
/ `REASONING_END` events and CopilotKit renders them via the
`reasoningMessage` slot.

This page overrides that slot with a custom `<ReasoningBlock />` so the
thinking chain is rendered as a visually prominent amber-tagged banner
rather than the default collapsible card.

- Dedicated route: `/api/copilotkit-reasoning`
- Single-route mode, registered under agent ID `agentic-chat-reasoning`
- Key files: `page.tsx`, `reasoning-block.tsx`,
  `../../api/copilotkit-reasoning/route.ts`,
  `../../../lib/factory/reasoning-factory.ts`
