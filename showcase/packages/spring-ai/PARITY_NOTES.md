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

- **gen-ui-interrupt** — Spring AI has no `interrupt` primitive. The
  `SpringAIAgent` runs a single `ChatClient` call to completion on each
  HTTP request; there is no graph-level pause/resume API to carry client
  input across suspensions. LangGraph-specific.

- **interrupt-headless** — Same missing primitive as `gen-ui-interrupt`.
  No way to pause a `SpringAIAgent` run and resume it from client-supplied
  state.

- **subagents** — No multi-agent orchestration primitive in the current
  `SpringAIAgent` builder. The bean wraps a single `ChatClient`; there is
  no nested-agent / graph-as-node construct equivalent to LangGraph's
  `Send` / subgraph-as-node pattern. A tool-composition approximation would
  not match the canonical demo's semantics (step-state events + per-agent
  interrupt points), so the existing stub is left in place.

### `ag-ui:spring-ai` adapter gaps

- **shared-state-streaming** — Spring AI's `ChatClient.stream()` emits
  token deltas, but the `ag-ui:spring-ai` adapter does not expose a
  mid-stream state-delta emission API comparable to LangGraph's
  `copilotkit_emit_state`. Per-token state patches cannot be forwarded
  through the AG-UI channel with the current integration.

- **byoc-json-render** — Relies on a streaming structured-output primitive
  (LangGraph's `with_structured_output` + incremental JSON streaming that
  yields partial objects matching a Zod schema across the stream). Spring
  AI has `BeanOutputConverter` / `ParameterizedTypeReference` structured
  output, but it resolves on the FINAL response only — it does not emit
  partial schema-conformant objects during the stream. The BYOC renderer
  needs per-token JSON to progressively paint the UI.

- **byoc-hashbrown** — Same missing primitive as `byoc-json-render`.
  Hashbrown's catalog-driven renderer expects per-token JSON deltas
  shaped against a strict schema.

### Command-only

- **cli-start** — Not a runnable demo cell; it's a command-line starter
  snippet (`npx degit …`). Not applicable here.

## Notes on ported-but-adapter-limited demos

A few ported demos depend on AG-UI events that the current `ag-ui:spring-ai`
adapter does not always emit:

- **agentic-chat-reasoning**, **reasoning-default-render**,
  **tool-rendering-reasoning-chain** — the frontend code is wired for
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
(+ async), hitl-in-chat, hitl-in-app, prebuilt-sidebar / popup, chat-slots,
chat-customization-css, headless-simple, headless-complete, beautiful-chat,
auth, readonly-state-agent-context, open-gen-ui (+ advanced), voice,
agent-config, a2ui-fixed-schema, declarative-gen-ui, multimodal, and the
three reasoning variants.
