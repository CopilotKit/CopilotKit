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

- **reasoning-custom**, **reasoning-default**,
  **tool-rendering-reasoning-chain** — frontend code is wired for
  `REASONING_MESSAGE_*` events, but the Spring AI handler CANNOT emit
  them. This is a genuine SDK limitation in Spring AI 1.0.1, not an
  adapter or wiring gap. Details below.

  **What the demo needs.** The reasoning UI mounts only when the backend
  emits AG-UI `REASONING_MESSAGE_START` / `_CONTENT` / `_END` events
  (role `"reasoning"`). The canonical `langgraph-python` agent produces
  these by routing the OpenAI model's reasoning summary through the
  **OpenAI Responses API** (`reasoning={"effort": "medium", "summary":
"detailed"}`). The aimock fixtures for these spring-ai cells
  (`d6/spring-ai/reasoning.json`,
  `d6/spring-ai/tool-rendering-reasoning-chain.json`, copied from
  langgraph-python) carry the reasoning text in a dedicated
  `response.reasoning` field, which aimock renders over the OpenAI
  **chat-completions** wire as streaming `delta.reasoning_content`
  chunks (see `@copilotkit/aimock` `buildTextChunks` —
  `delta: { reasoning_content: slice }`).

  **Why Spring AI 1.0.1 cannot surface it.** The spring-ai integration
  speaks OpenAI chat-completions (`spring-ai-starter-model-openai`,
  `/v1/chat/completions`). In `spring-ai-openai:1.0.1` the streaming
  delta is bound to the record `OpenAiApi.ChatCompletionMessage`, whose
  components are exactly `rawContent, role, name, toolCallId, toolCalls,
refusal, audioOutput, annotations` — there is **no `reasoning_content`
  / `reasoning` field**, no metadata map, and no `@JsonAnySetter`
  catch-all. The record is annotated `@JsonIgnoreProperties`, so the
  inbound `reasoning_content` JSON property is **silently discarded at
  deserialization**. It never reaches `ChatResponse` /
  `Generation.getOutput()`, so the Java handler has no API to read it.
  The reasoning-summary channel of the OpenAI **Responses API** is also
  unavailable: `spring-ai-openai:1.0.1` ships no Responses-API client
  (only `OpenAiApi` chat-completions classes exist), so the
  langgraph-python parity path cannot be reproduced either.

  **Why the inline-`<reasoning>`-tag workaround does not apply.** The
  proven `claude-sdk-python` agent PRIMARILY maps Anthropic's native
  extended-thinking channel: it enables `thinking={"type": "enabled", ...}`
  on the Messages API, receives `thinking_delta` blocks, and re-routes
  them to `REASONING_MESSAGE_*`. Only when no native thinking channel is
  present does it FALL BACK to prompting the model to wrap its plan in
  literal `<reasoning>...</reasoning>` text tags inside normal output and
  parsing those tags out of the text stream. The inline-tag fallback IS
  expressible in Spring AI (the handler already streams
  `getOutput().getText()`). But neither claude-sdk path fits these cells:
  the spring-ai aimock fixtures emit reasoning through the dedicated
  `reasoning` field (→ `reasoning_content`), NOT via an Anthropic native
  thinking channel and NOT as inline `<reasoning>` tags in `content`.
  Rewriting the fixtures to embed inline tags — or hand-fabricating a
  reasoning block in the handler — would be a demo-weakening fixture hack
  that misrepresents the integration's real capability, so it is
  deliberately not done.

  **What a real fix requires (upstream / out of scope here).** Either
  (a) Spring AI adds a `reasoning_content` (or reasoning-summary) field
  to its chat-completions delta record and exposes it on
  `Generation`/output metadata; or (b) Spring AI ships an OpenAI
  Responses-API client that surfaces the reasoning summary; or (c) a
  custom `WebClient`-level interceptor parses the raw chat-completions
  SSE for `delta.reasoning_content` BEFORE Spring AI's binding drops it,
  bypassing `ChatClient` entirely (a substantial custom-parser effort
  that re-implements the streaming pipeline). None of these is a
  showcase-side change. Until one lands, these cells ship as frontend
  code (so the pattern is documented end-to-end) and the chat behaves as
  a regular chat with no reasoning block.

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
