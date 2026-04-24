# Langroid showcase — parity notes

Tracks demos from the canonical `showcase/packages/langgraph-python/manifest.yaml`
that are either deliberately skipped or deferred for the Langroid integration.

Canonical list: 36 demos (excluding `cli-start`).

## Ported in this pass (batch B4)

### Pre-existing

- agentic-chat
- hitl-in-chat (route: `/demos/hitl`)
- tool-rendering
- gen-ui-tool-based
- gen-ui-agent
- shared-state-read-write
- shared-state-streaming
- subagents

### Added in this pass

- chat-customization-css
- prebuilt-sidebar
- prebuilt-popup
- chat-slots
- headless-simple
- frontend-tools
- frontend-tools-async
- hitl-in-app
- agentic-chat-reasoning
- reasoning-default-render
- readonly-state-agent-context

## Skipped — Langroid does not currently support

- **gen-ui-interrupt** — the canonical implementation uses
  `useLangGraphInterrupt` + LangGraph's interrupt lifecycle (`interrupt()`
  node, resume with `Command(resume=...)`). Langroid has no equivalent
  interrupt primitive in its `ChatAgent` / `Task` model; the AG-UI adapter
  here does not emit interrupt events.
- **interrupt-headless** — same reasoning as `gen-ui-interrupt`; this is the
  headless variant of the same LangGraph-specific primitive.

## Deferred — portable in principle, requires additional backend or BYOC work

These demos are portable to Langroid but were not implemented in this batch
due to scope. Each requires either a dedicated route and renderer or a
bespoke backend tool beyond the unified agent.

- **tool-rendering-default-catchall** — backend tool surface exists via
  the agent's existing tools; requires the default-catchall variant of the
  tool-rendering page.
- **tool-rendering-custom-catchall** — same, with `useDefaultRenderTool`.
- **tool-rendering-reasoning-chain** — requires sequential tool-call + reasoning
  emission from the Langroid adapter.
- **declarative-gen-ui** — A2UI dynamic schema already has a planner in
  `agent.py` (`GenerateA2UITool`); needs the frontend catalog + renderers page.
- **a2ui-fixed-schema** — needs a dedicated agent and schema JSON.
- **mcp-apps** — Langroid does expose MCP support, but the canonical demo is
  tightly coupled to LangGraph activity-message emission; deferred.
- **byoc-json-render** — requires a dedicated BYOC route + json-render catalog.
- **byoc-hashbrown** — requires a dedicated BYOC route + hashbrown structured-output pipeline.
- **beautiful-chat** — requires a dedicated combined runtime (openGenerativeUI + a2ui + mcpApps).
- **multimodal** — requires a vision-capable agent pipeline + dedicated route.
- **auth** — requires a dedicated auth-gated runtime route.
- **voice** — requires the voice-enabled runtime route + sample audio asset.
- **open-gen-ui / open-gen-ui-advanced** — require a dedicated OGUI runtime route.
- **agent-config** — requires typed-config forwarding to the agent's system prompt.
- **headless-complete** — depends on the mcp-apps runtime + Excalidraw MCP.
