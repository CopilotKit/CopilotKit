# Langroid showcase — parity notes

Tracks demos from the canonical `showcase/packages/langgraph-python/manifest.yaml`
that are either deliberately skipped or deferred for the Langroid integration.

Canonical list: 36 demos (excluding `cli-start`).

## Ported

### Wave 1 (initial scaffold)

- agentic-chat
- hitl-in-chat (route: `/demos/hitl`)
- tool-rendering
- gen-ui-tool-based
- gen-ui-agent
- shared-state-read-write
- shared-state-streaming
- subagents

### Wave 2 (chat chrome + reasoning)

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

### Wave 3 (batch B4 second pass)

- tool-rendering-default-catchall
- tool-rendering-custom-catchall
- declarative-gen-ui (A2UI dynamic schema — reuses agent's `generate_a2ui` tool)
- auth (dedicated `/api/copilotkit-auth` route with `onRequest` hook)
- headless-complete (frontend-only, reuses unified runtime)
- agent-config (frontend + dedicated route + backend wired end-to-end;
  `forwardedProps.config.configurable.properties` steers the agent's
  system prompt per run)

## Skipped — Langroid lacks the framework primitive

- **gen-ui-interrupt** — uses `useLangGraphInterrupt` + LangGraph's
  `interrupt()` node + `Command(resume=...)` lifecycle. Langroid has no
  equivalent interrupt primitive and the current AG-UI adapter emits no
  interrupt events.
- **interrupt-headless** — same reason as `gen-ui-interrupt`.

## Deferred — portable in principle, requires additional agent or runtime work

Each of these is achievable but needs a dedicated Langroid agent tool / module
that we did not take on in this pass. They are tracked so a follow-up can
pick them up without re-litigating scope.

- **tool-rendering-reasoning-chain** — needs the Langroid AG-UI adapter to
  emit reasoning events; the current adapter only emits text + tool deltas.
- **a2ui-fixed-schema** — needs a dedicated agent that loads JSON schemas
  at startup and exposes a `display_flight`-shaped tool backed by the same
  A2UI middleware path.
- **byoc-json-render** — needs a Langroid agent that streams structured
  JSON matching the `@json-render/react` Zod catalog, plus a dedicated BYOC
  runtime route.
- **byoc-hashbrown** — needs a Langroid agent that streams structured
  output matching the hashbrown schema, plus a dedicated BYOC runtime route.
- **beautiful-chat** — polished starter chat. Large frontend (example-layout,
  example-canvas, generative-ui charts, hooks). Requires combining
  openGenerativeUI + a2ui on one dedicated runtime route.
- **multimodal** — needs a Langroid agent configured with a vision-capable
  LLM and a dedicated runtime that accepts CopilotChat attachments
  (images + PDFs).
- **voice** — needs the `@copilotkit/voice` plumbing plus a dedicated voice
  runtime route and sample audio assets.
- **open-gen-ui** — needs a Langroid agent that emits a `generateSandboxedUi`
  tool call; the runtime `openGenerativeUI` middleware converts that stream
  into activity events.
- **open-gen-ui-advanced** — same agent surface as `open-gen-ui` plus
  host-side `sandboxFunctions` wiring on the frontend.
- **mcp-apps** — Langroid does ship an MCP client surface, but the canonical
  demo is tightly coupled to the LangGraph activity-message emission path.
  A Langroid port needs a custom AG-UI adapter path that emits the
  MCP-apps activity events.

## Known limitations

(none currently tracked — previous agent-config backend gap was closed by
propagating upstream PR #4271's forwardedProps repack + backend system-
prompt wiring.)
