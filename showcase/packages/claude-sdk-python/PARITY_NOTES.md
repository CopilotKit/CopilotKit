# Parity Notes

Baseline: `showcase/packages/langgraph-python/`.

This package currently ports the frontend-only demos whose agent behavior is fully satisfied by the shared default Claude backend in `src/agents/agent.py`. The demos below are deliberately out of scope for this pass and left for a follow-up.

## Ported in this pass

- `cli-start` — manifest-only entry with the framework-slug init command.
- `prebuilt-sidebar` — default `<CopilotSidebar />` against the shared agent.
- `prebuilt-popup` — default `<CopilotPopup />` against the shared agent.
- `chat-slots` — custom `welcomeScreen`, `input.disclaimer`, `messageView.assistantMessage` slots.
- `chat-customization-css` — scoped CSS variable and class overrides.
- `headless-simple` — `useAgent` + `useComponent` minimal custom chat surface.

## Skipped demos

### Require langgraph-specific primitives (no Claude Agent SDK equivalent)

- `gen-ui-interrupt` — relies on langgraph's `interrupt()` primitive that pauses the graph and resumes on a client-side response. Claude Agent SDK does not expose an equivalent graph-interrupt API.
- `interrupt-headless` — same reason; this is a headless surface for resolving a langgraph interrupt.

### Require infrastructure not yet present in this package

- `beautiful-chat` — 28 supporting files (layout, canvas, generative UI charts, hooks, theme CSS, showcase config, A2UI catalog). Porting requires significant surface-area review that did not fit this pass. Skeleton to be added in a follow-up.
- `mcp-apps` — MCP client driving UI via activity renderers. Claude Agent SDK supports MCP clients, but the langgraph-python demo relies on the CopilotKit runtime wiring through a dedicated `/api/copilotkit-mcp-apps/route.ts` plus agent-side MCP client glue that did not fit this pass.
- `agentic-chat-reasoning`, `reasoning-default-render`, `tool-rendering-reasoning-chain` — require streaming Claude extended-thinking (reasoning) blocks as distinct AG-UI message parts. The current `src/agents/agent.py` AG-UI bridge does not translate Anthropic `thinking` content blocks; adding it correctly requires new event types and a thinking-aware message buffer. Follow-up.
- `declarative-gen-ui` — A2UI BYOC catalog wired via `a2ui.catalog` on the provider plus agent-side `render_a2ui` tool injection. Possible on this package but pulls in the full A2UI renderer stack and multi-file catalog/definitions/renderers — deferred to the A2UI follow-up.
- `a2ui-fixed-schema` — fixed-schema A2UI with two JSON schemas (flights + booked) and a per-demo catalog. Same A2UI follow-up as above.
- `frontend-tools`, `frontend-tools-async` — each needs a dedicated demo agent and supporting frontend surface (notes-card etc.). The default agent already exposes `change_background` as a frontend tool but the standalone demos were not ported to keep the pass focused.
- `hitl-in-app` — needs an app-level approval modal plus an async `useFrontendTool` handler that awaits the modal's resolution. Supporting component (approval-dialog.tsx) plus wiring was deferred.
- `readonly-state-agent-context` — frontend provides read-only context to the agent via `useAgentContext`. Trivial on the frontend, but the reference uses a dedicated agent and a dedicated support component; deferred.
- `open-gen-ui`, `open-gen-ui-advanced` — open-ended generative UI with sandbox iframe and an OGUI route. Multi-file surface deferred.
- `tool-rendering-default-catchall`, `tool-rendering-custom-catchall` — focused variants on top of the existing tool-rendering demo. The default agent already exposes backend tools; adding these would only cost a new `page.tsx` and a custom renderer each, but they are deferred to a follow-up that also touches `tool-rendering-reasoning-chain`.
- `headless-complete` — full-from-scratch chat (message-list, use-rendered-messages, etc.). Multi-file frontend; deferred.

Follow-ups should pick these up in groups: (1) reasoning/thinking plumbing in `agent.py`, (2) A2UI catalog demos, (3) tool-rendering variants, (4) frontend-tools + HITL-in-app, (5) mcp-apps, (6) beautiful-chat, (7) headless-complete.
