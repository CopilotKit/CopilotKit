# Spring AI Showcase — Parity Notes

This document tracks demos from the canonical `langgraph-python` showcase manifest that
are **not ported** to the Spring AI showcase, along with the reason. Spring AI is a
Java framework with a narrower primitive set than LangGraph — several of the canonical
demos require primitives that Spring AI or the `ag-ui` Spring AI integration
(`com.ag-ui.community:spring-ai`) does not currently expose.

## Skipped demos

- **gen-ui-interrupt** — Spring AI has no `interrupt` primitive. The `SpringAIAgent`
  runs to completion on each HTTP request; there is no way to pause a graph and
  resume it from client-supplied data. LangGraph-specific.

- **interrupt-headless** — Same reason as `gen-ui-interrupt`. No interrupt
  primitive in Spring AI; this demo is LangGraph-specific.

- **mcp-apps** — The `ag-ui` Spring AI integration does not currently expose an
  MCP client surface for the runtime to render MCP-driven activities. Spring AI
  itself ships `spring-ai-mcp` but wiring it through `SpringAIAgent` + AG-UI
  events is out of scope for this blitz.

- **subagents** — No multi-agent orchestration primitive in the current
  `SpringAIAgent` builder. Sub-agent delegation would require a custom runner
  plus AG-UI step-state events; the existing `SpringAIAgent` wraps a single
  `ChatClient` call. Left as a stub page.

- **shared-state-streaming** — Spring AI's `ChatClient` streams tokens but does
  not expose a per-token state-delta emission API comparable to LangGraph's
  `copilotkit_emit_state`. The `ag-ui` Spring adapter forwards text chunks, not
  structured state patches.

- **tool-rendering-reasoning-chain**, **agentic-chat-reasoning**,
  **reasoning-default-render** — Spring AI's OpenAI client does not surface
  reasoning / thinking tokens as a distinct stream channel in the `ag-ui`
  integration. The chat model emits content and tool calls only.

- **byoc-hashbrown**, **byoc-json-render** — Both BYOC renderers rely on a
  streaming structured-output primitive (LangGraph's `with_structured_output` +
  incremental JSON streaming) that the `SpringAIAgent` builder does not
  currently expose. Spring AI has a `BeanOutputConverter` but it operates on
  the final response, not on a streaming partial.

- **voice** — No voice / speech-to-text primitive in Spring AI. OpenAI Whisper
  could be called directly but that is a new Spring integration, out of scope.

- **multimodal** — The current `SpringAIAgent` setup uses `gpt-4.1` which is
  vision-capable, but the `ag-ui` Spring adapter does not forward multipart
  attachments from `CopilotChat` into Spring AI's `UserMessage.media` list.
  Plumbing this requires a new `AgUiService` override; out of scope for this
  blitz.

- **open-gen-ui-advanced** — Requires the sandbox-frontend-function-calling
  mechanism proven in the Python package; skipped in favor of the simpler
  `open-gen-ui` variant.

- **agent-config** — Requires a dynamic system prompt rebuilt per request
  based on a typed config object forwarded from the frontend. The current
  `SpringAIAgent` bean is built once at startup with a fixed system prompt.
  Left as a stub.

- **cli-start** — Not a runnable demo; command-only.

- **a2ui-fixed-schema** — The current `generate_a2ui` tool produces dynamic
  A2UI via a secondary LLM call; it does not constrain output against a
  fixed client-supplied schema. Left unported rather than shipping a
  half-working variant.

- **headless-complete** — The full headless experience (with `use-rendered-
  messages`, custom markdown rendering, interrupt handling) tracks features
  skipped above; we ship `headless-simple` instead.

- **beautiful-chat** — Polished starter chat with generative-UI chart cards
  and elaborate suggestion chips. Depends on the same structured-streaming
  primitives used by the BYOC demos and is skipped together with them.

## Ported demos

The following demos are implemented in this package. See `manifest.yaml` for
the full list and `highlight` paths for each demo's Java and TypeScript
entry points.
