# OpenClaw Parity Notes

Status of the OpenClaw showcase demos relative to the langgraph-python
canonical set.

OpenClaw ships a **curated subset** of the canonical demos rather than the
full set. OpenClaw is a self-hosted, multi-channel AI gateway; the showcase
reaches it through the clawg-ui AG-UI channel plugin, which exposes the AG-UI
protocol at the gateway's operator route. The frontend talks only to
`/api/copilotkit` on the same origin; that Next.js route proxies via an
`HttpAgent` to the clawg-ui operator route, keeping the gateway token
server-side. Every demo agent name maps to the same underlying OpenClaw agent —
the demos differ in frontend presentation and in the agent capabilities they
exercise. Per-demo steering, where a demo needs it, is delivered as AG-UI
`context[]` (via `useAgentContext`), which clawg-ui appends to the agent prompt.

## Ported

The nine ported demos are exactly the frontend-presentation and
agent-capability features that map cleanly onto OpenClaw today.

### Frontend-presentation variants (same event stream)

- `agentic-chat` — plain streaming `<CopilotChat />`
- `prebuilt-sidebar` — docked `<CopilotSidebar />`
- `prebuilt-popup` — floating `<CopilotPopup />`
- `chat-customization-css` — scoped CSS theming of built-in classes

### Agent-capability demos

- `agentic-chat-reasoning` — OpenClaw's reasoning "stream" mode; `REASONING_*`
  events render as a built-in reasoning panel (no custom slot)
- `tool-rendering` — server-side tool calls painted by a single
  `useDefaultRenderTool` wildcard card (OpenClaw exposes generic server tools,
  not a fixed set)
- `frontend-tools` — `useFrontendTool` (`change_background`), forwarded over
  AG-UI as an OpenClaw client tool, executed in the browser
- `hitl-in-chat` — `useHumanInTheLoop` (`book_call`) in-chat time picker; uses
  `useAgentContext` steering
- `hitl-in-app` — async `useFrontendTool` (`request_user_approval`) with an
  app-level modal; uses `useAgentContext` steering

## Not ported (yet)

These are intentional omissions, not bugs. High-level rationale:

- **shared-state / predictive-state** — OpenClaw has no native UI-shared,
  typed-state slot to bind to, so bidirectional shared state and predictive
  state updates have no clean mapping today.
- **native LangGraph-style interrupts** (`gen-ui-interrupt`,
  `interrupt-headless`) — OpenClaw is a gateway, not a graph engine; it has no
  resumable `interrupt()` that round-trips a persisted checkpoint. HITL is done
  tool-based instead (see `hitl-in-chat` / `hitl-in-app`), steered via
  `useAgentContext`.
- **generative-UI / A2UI variants** — the backend-owned generative-UI and A2UI
  tool surfaces from the canonical set are not wired into the clawg-ui bridge.

The curated set stays honest to what OpenClaw actually supports rather than
stubbing features the gateway can't back.
