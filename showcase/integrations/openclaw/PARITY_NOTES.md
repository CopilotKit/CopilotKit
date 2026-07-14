# OpenClaw Parity Notes

Status of the OpenClaw showcase demos relative to the claude-sdk-typescript /
langgraph-python canonical set.

## Architecture

OpenClaw is a self-hosted, multi-channel AI gateway. The showcase reaches it
through the **ag-ui** AG-UI channel plugin, which exposes the AG-UI protocol
at the gateway's operator route (`POST /v1/ag-ui/operator`, gateway-token
auth). Each demo's Next.js route proxies to that route via an `OpenClawAgent`
(a thin `HttpAgent` subclass; see `src/lib/openclaw-agent.ts`), keeping the
gateway token server-side. Every demo agent name maps to the same underlying
OpenClaw agent — a **single stateless endpoint** — so per-demo behaviour comes
from the frontend + runtime middleware + the ag-ui gateway capabilities, not
from per-demo backend graphs. This mirrors the claude-sdk-typescript topology
(the frontend is adopted from it) with one difference: OpenClaw has no per-demo
backend, so demo-specific tools are **frontend-forwarded** (`useFrontendTool`),
reaching the model through OpenClaw's caller-provided `clientTools` path (the
only tool list the gateway exposes to the model).

The demo frontend is the full claude-sdk-typescript set; support is provided by
three layers:

1. **Pass-through + runtime middleware** — chat, generative UI, open-gen-ui,
   A2UI (the runtime's `render_a2ui` tool is injected and relayed by the
   gateway), MCP-apps. Behaviour lives in the frontend + CopilotKit runtime;
   the gateway forwards tools and relays events.
2. **ag-ui gateway capabilities** (in the fork, frontend-agnostic) — token
   streaming, `REASONING_*` events, frontend/client tools, bidirectional
   **shared state** (declared via `forwardedProps.stateWriterTools` →
   `STATE_SNAPSHOT` + a narrated confirmation), and **multimodal** image input
   (AG-UI image blocks → the vision model).
3. **Config** — reasoning stream mode, image-capable model input, workspace
   identity seeding (see `gateway/setup.sh`).

## Supported

The showcase ships the full demo set. Support by category:

- **Chat / presentation** — agentic-chat, prebuilt-sidebar, prebuilt-popup,
  chat-slots, chat-customization-css, beautiful-chat, headless-simple.
- **Reasoning** — reasoning-default, reasoning-custom (ag-ui emits
  `REASONING_*` in stream mode; renders in the built-in reasoning panel, above
  the answer). Note the reasoning panel appears only when the model actually
  produces a summary — see "reasoning is intermittent" under Known gaps.
- **Tools & generative UI** — frontend-tools, frontend-tools-async,
  gen-ui-agent, gen-ui-tool-based, tool-rendering (+ default/custom catch-all),
  open-gen-ui, open-gen-ui-advanced. Demo tools are frontend-forwarded.
- **HITL** — hitl, hitl-in-chat, hitl-in-chat-booking, hitl-in-app
  (tool-based, promise/`respond()` — the fleet's `promise-based` pattern).
- **State / context** — readonly-state-agent-context and agent-config (via
  `useAgentContext` → AG-UI `context[]`, injected into the prompt);
  shared-state-read and shared-state-read-write (via the ag-ui state-writer
  capability, `STATE_SNAPSHOT`).
- **A2UI** — declarative-gen-ui and a2ui-fixed-schema. These use the **generic
  fleet path**, not anything OpenClaw-specific: the runtime `render_a2ui` tool is
  forwarded to the model, its calls are relayed through AG-UI, and the frontend
  `@copilotkit/a2ui-renderer` catalog renders the surface — exactly how every
  other integration does A2UI. Note: OpenClaw _also_ has a **native** A2UI system
  (its own `a2ui_push` / `a2ui_reset` tools + hosted `/__openclaw__/a2ui` canvas),
  which the showcase demos do **not** use. Wiring that native surface through
  ag-ui is a possible future differentiator (OpenClaw would drive A2UI
  server-side), but it is out of scope for parity and not required — the generic
  path already covers the demos.
- **Multimodal** — image attachments reach a vision-capable model (ag-ui
  extracts AG-UI image blocks and passes them to the run; the model input is
  configured with `image` support in `gateway/setup.sh`).
- **Auth** — runtime `onRequest` bearer gate (frontend/runtime, no gateway
  dependency).
- **Voice** — transcription via the runtime's transcription service.

Verified end-to-end at the gateway level (real backend): agentic-chat,
frontend-tools, shared-state-read-write (with narration), the `render_a2ui`
relay, reasoning emission, and multimodal (a solid-red image → "red").
Per-demo behavioural e2e coverage (aimock fixtures + Playwright specs) is being
brought up to fleet parity; until then, demos not in the verified list rely on
the same proven mechanisms but have not each been individually e2e-checked.

## Known gaps

- **byoc-hashbrown / declarative-json-render** — these depend on a rendering
  system prompt (the `{ ui: [...] }` / json-render envelope instruction) that
  the claude-sdk reference held in its backend. The gateway is a pass-through,
  so reliable output needs that instruction delivered to the model (frontend
  `instructions` or gateway prompt injection). Not yet wired.
- **subagents** — the supervisor → sub-agent orchestration + live delegation
  state has no backing on the thin gateway yet.
- **Reasoning is intermittent (vs langgraph's always-on)** — the reasoning
  panel lights up for prompts the model deems worth summarizing (e.g. "write a
  sonnet") but stays hidden for simple factual ones (e.g. "why is the sky
  blue"). Root cause is upstream of ag-ui: OpenClaw's `openai-responses`
  provider requests the reasoning summary with `summary: "auto"` (hardcoded —
  it resolves `reasoningEffort` but never sets `reasoningSummary`, so
  `applyCommonResponsesParams` falls through to `|| "auto"`; see OpenClaw
  `src/llm/providers/openai-responses.ts` + `openai-responses-shared.ts`). With
  `"auto"` the model itself decides whether to emit a summary. The
  langgraph-python reference instead forces `reasoning={"effort":"medium",
"summary":"detailed"}` in its agent (`src/agents/reasoning_agent.py`), so its
  panel appears on every turn. Matching that would mean changing the summary
  mode **inside OpenClaw core** — the decision is made before ag-ui sees any
  event, and we edit only ag-ui here, so it's out of scope. `"auto"` is a
  defensible default (reasoning surfaces when it's substantive rather than
  padding every answer); it is simply less eager than the LangGraph reference.
  A clean upstream fix would be for OpenClaw to expose `reasoningSummary` as a
  per-model config knob.

## Not supported (intentional, fleet-normal)

Listed in `manifest.yaml` `not_supported_features` — matching how the fleet
(including langgraph-python and hermes) marks them:

- **gen-ui-interrupt**, **interrupt-headless** — LangGraph-native resumable
  `interrupt()` semantics; quarantined even in the LangGraph references (a
  `@copilotkit/react-core` resume-path issue). OpenClaw is a gateway, not a
  graph engine; HITL is done tool-based instead (hitl-in-chat / hitl-in-app).
- **shared-state-streaming** — per-token predictive state; LangGraph-mostly
  (only langgraph-python + google-adk ship it).

The set stays honest to what OpenClaw actually backs rather than stubbing
features the gateway can't support.
