# Spring AI Showcase — Parity Notes

This document tracks demos from the canonical `langgraph-python` showcase
manifest that are **not ported** to the Spring AI showcase, along with the
specific Spring AI / `ag-ui:spring-ai` primitive that is missing.

Spring AI is a Java framework with a narrower primitive set than LangGraph
for a handful of specific use-cases — especially streaming structured
output, multi-agent orchestration, and graph-level interrupts. The demos
below are the ones where those primitives are genuinely unavailable.

## Skipped demos

### LangGraph graph-control primitives (no Spring AI equivalent)

- **subagents** — Ported using the tool-composition pattern (each
  sub-agent is a separate `ChatClient` call wired as a supervisor tool;
  see `SubagentsController`). This deviates from LangGraph's
  graph-as-node construct: there is no per-sub-agent interrupt point, and
  step-started/step-finished events are not emitted. The user-visible
  semantics — supervisor delegates work, each delegation is logged in
  shared state, the UI renders a live timeline — match the canonical
  demo. STATE_SNAPSHOT is emitted after every delegation so the
  delegation log updates incrementally.

### `ag-ui:spring-ai` adapter gaps

- **shared-state-streaming** — Spring AI's `ChatClient.stream()` emits
  token deltas, but the `ag-ui:spring-ai` adapter does not expose a
  mid-stream state-delta emission API comparable to LangGraph's
  `copilotkit_emit_state`. Per-token state patches cannot be forwarded
  through the AG-UI channel with the current integration. The demo cell
  is shipped as a stub frontend (`src/app/demos/shared-state-streaming/`)
  so the UI lights up when the adapter exposes mid-stream emission.

- **byoc-json-render** — Relies on a streaming structured-output primitive
  (LangGraph's `with_structured_output` + incremental JSON streaming that
  yields partial objects matching a Zod schema across the stream). Spring
  AI has `BeanOutputConverter` / `ParameterizedTypeReference` structured
  output, but it resolves on the FINAL response only — it does not emit
  partial schema-conformant objects during the stream. The BYOC renderer
  needs per-token JSON to progressively paint the UI. Additionally,
  `@json-render/core` and `@json-render/react` are not currently
  dependencies of the Spring AI showcase package.

## Ported with caveats

- **gen-ui-interrupt** — Ported using **Strategy B** (the same approach
  used by MS Agent Python). Spring AI has no `interrupt()` primitive, so
  the backend agent (`InterruptAgentController`) provides a scheduling
  system prompt with NO backend tool callbacks. The `schedule_meeting`
  tool is registered entirely on the frontend via `useFrontendTool` with
  an async handler that renders a `TimePickerCard` and blocks until the
  user picks a slot or cancels. The UX is identical to the LangGraph
  version.

- **interrupt-headless** — Same Strategy B adaptation as
  `gen-ui-interrupt`, but the time-picker popup renders in the app
  surface (outside the chat) instead of inline. Both demos share the
  same backend agent (`InterruptAgentController`).

- **byoc-hashbrown** — Ported. The hashbrown UI kit
  (`@hashbrownai/react@0.5.0-beta.4`) consumes streaming text and uses
  `useJsonParser` to progressively assemble UI from partial JSON. Spring
  AI's `ChatClient.stream()` streams text tokens, so the hashbrown
  parser tolerates the per-token feed. Final-shape correctness depends on
  the model following the example prompt — there is no guarantee like
  LangGraph's `with_structured_output`.

- **gen-ui-tool-based** — Ported using `useComponent` per-tool renderers
  bound to `render_bar_chart` / `render_pie_chart` tools. Args stream as
  partial JSON; the Zod schemas accept partials so the chart components
  can render once enough fields are present.

- **agentic-chat-reasoning**, **reasoning-default-render**,
  **tool-rendering-reasoning-chain** — frontend code is wired for
  `REASONING_MESSAGE_*` events; when the adapter begins forwarding OpenAI
  reasoning content (and/or a reasoning-capable model is wired through),
  the reasoning UI lights up automatically. Until then the chat behaves
  as a regular chat. Shipped as frontend code so the pattern is documented
  end-to-end.

- **multimodal** — the frontend sends image + PDF attachments through
  CopilotChat's `AttachmentsConfig`. Whether the adapter forwards them
  into Spring AI's `UserMessage.media()` surface is
  integration-dependent; the Spring-AI model (`gpt-4.1`) is vision-capable
  on the provider side.

- **mcp-apps** — the runtime wires the MCP Apps middleware with the public
  Excalidraw MCP server. The middleware injects MCP tools into the AG-UI
  request so the Spring-AI ChatClient sees them, and intercepts tool calls
  to emit activity events. Whether the `ag-ui:spring-ai` adapter forwards
  runtime-injected tools into Spring AI's tool-calling surface is
  integration-dependent; the demo wiring is in place so the cell lights up
  when the adapter supports it.

## Ported demos

The full ported list lives in `manifest.yaml`. Highlights include:
agentic-chat, tool-rendering (default + custom + catchall), frontend-tools
(+ async), hitl-in-chat (+ booking variant), hitl-in-app, prebuilt-sidebar
/ popup, chat-slots, chat-customization-css, headless-simple,
headless-complete, beautiful-chat, auth, readonly-state-agent-context,
open-gen-ui (+ advanced), voice, agent-config, a2ui-fixed-schema,
declarative-gen-ui, multimodal, gen-ui-tool-based, mcp-apps,
byoc-hashbrown, and the three reasoning variants.
