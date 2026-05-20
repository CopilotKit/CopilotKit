# Showcase GOTCHAS — Framework & Integration Edge Cases

What we learned from getting all 18 integrations to D5 green. Many of these are things that were "green" but still wrong — passing probes while the underlying wiring was fragile, framework-specific, or relying on coincidence. This document exists so we don't re-learn these when rebuilding.

---

## Cross-Framework Patterns

**V1 vs V2 CopilotKit imports cause silent failures.** V1 is `@copilotkit/react-core`, V2 is `@copilotkit/react-core/v2`. Mixing V1 provider with V2 hooks (e.g., `useRenderTool`) silently fails — the tool rendering pipeline never wires up. Agent discovery also breaks: V2 runtime needs V2 provider. Found on: ms-agent-dotnet (auth), built-in-agent (interrupts), spring-ai (tool-rendering).

**Custom `assistantMessage` slot renderers must carry `data-testid="copilot-assistant-message"`.** The byoc-hashbrown demo overrides the slot with a HashBrown renderer. Without the testid, the probe (and any external consumer) sees 0 assistant messages. Every integration's hashbrown-renderer.tsx needed this fix independently. This is the #1 argument for a shared frontend.

**`copilotRuntimeNextJSAppRouterEndpoint()` must be hoisted to module scope.** Calling it inside the POST handler (per-request) causes `handleServiceAdapter` to repeatedly re-wrap `runtime.agents` in Promise layers. Under concurrent requests (/info + agent/run), this creates a race condition where the agents list is stale. Found on: google-adk (all 6 dedicated routes).

**Agent names must match exactly between frontend and backend.** `useAgent("agentic-chat-reasoning")` must match the backend registration. Dashes vs underscores, trailing hyphens, typos — all cause silent "Agent not found" errors that crash the page via React error boundary.

**`onRunInitialized` multimodal shim is framework-dependent.** langgraph-python NEEDS it (the `@ag-ui/langgraph` converter only understands legacy `binary` parts). langroid does NOT need it (speaks AG-UI directly — adding the shim causes double-encoding). Per-framework boolean, not a universal.

**Content parts from AG-UI arrive as Pydantic model instances, not dicts.** `isinstance(part, dict)` silently drops them. Must check `hasattr(part, "model_dump")` and call `model_dump(by_alias=True)`. Affected: langroid, ms-agent-python, pydantic-ai.

**`from __future__ import annotations` breaks Pydantic tool schemas.** PEP 563 makes all annotations strings. When LlamaIndex `AGUIChatWorkflow` passes `backend_tools` to Pydantic for schema generation, `Annotated[str, "..."]` is a raw string instead of a resolved type. Affected: llamaindex, crewai-crews, pydantic-ai, ag2. Fix: remove the import from files defining tools.

---

## Per-Framework Edge Cases

### langgraph-python (Reference — always compare against this)

- `a2ui_dynamic` graph owns `generate_a2ui` tool — runtime MUST NOT auto-inject (`injectA2UITool: false`). Double-injection confuses the LLM.
- `server.mjs` must register ALL graphs from `langgraph.json`. We found it registering 5 of 25 — every unregistered graph returned 404.
- Health probe uses `/ok` (langgraph-cli convention), not `/health`.
- Version pinning: `langchain>=1.2.0` imports from `langgraph.runtime.ExecutionInfo` which doesn't exist in `langgraph==1.0.5`.

### langgraph-typescript

- Same server.mjs graph registration issue as langgraph-python.
- Trailing slash on `deploymentUrl` matters for dedicated API routes. Missing it causes 404.
- esbuild architecture mismatch on ARM Mac Docker builds. Passes in CI (Depot x86), fails locally on Apple Silicon.

### agno

- `reasoning=True` does multi-call chain-of-thought which breaks aimock (only first call matches). Disable for aimock-backed tests.
- Agno's stock AGUI handler emits `STEP_STARTED`/`STEP_FINISHED` for reasoning — CopilotKit ignores these. The `reasoningMessage` slot requires `REASONING_MESSAGE_*` events. We built a custom handler, then reverted to stock AGUI.
- Internal tool execution creates infinite fixture loops (same pattern as AG2).

### spring-ai

- **Java backend** — Maven build, fundamentally different toolchain.
- `StreamingToolAgent.streamFirstTurn()` must include `toolCallbacks` with `internalToolExecutionEnabled=false`. Without this, aimock can't match `toolName: "get_weather"` — falls through to text-only fixture, weather card never renders.
- AG-UI Java SDK not on Maven Central. Must clone and `mvn install` in Dockerfile.

### mastra

- **JS object shorthand key trap:** `{ weatherTool }` expands to function name `"weatherTool"`, not `"get_weather"`. Must use explicit keys: `{ get_weather: weatherTool }`.
- `byocHashbrownAgent` needs its own dedicated agent with the hashbrown system prompt. The `weatherAgent` produces plain text → `useJsonParser` returns null → empty dashboard → timeout.
- ~280s cold start (V8 JIT + Mastra boot). Watchdog can kill it before ready.

### ms-agent-python

- `AgentFrameworkAgent.run()` expects `input_data: dict`. The `_MultimodalAgent` override used `*args/**kwargs` → `TypeError` at runtime.
- The override must `yield` events (async generator), not `return` (coroutine).
- OpenAI `store=True` breaks aimock fixture matching. Set `store=False`.

### ms-agent-dotnet

- C# / .NET backend.
- Auth page had V1 `CopilotKit` import → agent discovery failed → "Agent not found".

### built-in-agent

- **No Python backend.** TanStack AI `BuiltInAgent` runs in-process in Next.js.
- `type: "tanstack"` with `convertTanStackStream` has a `runFinished` flag that blocks ALL events after first `RUN_FINISHED`. For byoc, must use `type: "custom"`.
- OpenAI Responses API does NOT support `response_format: { type: "json_object" }` through TanStack adapter. The call silently fails — aimock never receives a request.

### crewai-crews

- `from __future__ import annotations` breaks `InterruptScheduling` import stubs in tests.
- Backend tool execution doesn't cycle back to aimock for text follow-up. Known adapter limitation.

### pydantic-ai

- `_classify_binary_part()` has the `isinstance(part, dict)` bug. Pydantic models from AG-UI need `model_dump()`.
- `starlette>=1.0.0` removes `on_startup`. Pin `starlette<1.0.0`.

### llamaindex

- `from __future__ import annotations` breaks Pydantic tool schema validation specifically when `backend_tools` are present but the response is text-only.

### langroid

- Custom AGUI handler (hand-written SSE, not a framework adapter).
- `_normalize_part()` must handle Pydantic model instances via `model_dump(by_alias=True)`.
- Does NOT need `onRunInitialized` multimodal shim.

### AG2

- `AGUIStream` requires plain string content. Multipart arrays cause 400 errors. `ContentFlattenerShim` handles conversion.
- Internal tool execution + aimock = infinite loop. Fix: `max_consecutive_auto_reply` or `hasToolResult` in fixtures.

### google-adk

- **Underscores required for ALL agent names.** Every other framework uses dashes.
- All 6 dedicated route files called `copilotRuntimeNextJSAppRouterEndpoint()` per-request → race condition. Fixed by hoisting to module scope.

### claude-sdk-python

- Transient "empty assistant text" flaps (fc=1, self-healing, not reproducible locally). Suspected SSE stream interruption on Railway.

---

## Aimock & Fixture Edge Cases

**Check fixtures FIRST.** When an agent misbehaves through aimock, the fixture determines behavior — the real LLM is never consulted.

**`sequenceIndex` counters are global.** They persist across all test runs within the same aimock process. Use `hasToolResult` (stateless) instead for fixtures shared across integrations.

**Tool-rendering fixtures need `toolName` in match criteria.** If the request doesn't include tool definitions, the fixture falls through to text-only. Spring-ai omitted tools; mastra's shorthand keys produced wrong function names.

**PDF turn is fragile.** Two-turn multimodal probe: if turn 2's message doesn't match the PDF fixture, the image fixture matches instead. The PDF fixture must be the most specific match.

---

## What Was "Green" But Still Wrong

1. **18 copies of identical frontend code** — every fix was a blitz. One missed integration = one regression.
2. **V1/V2 imports inconsistent** — some pages used V1 provider with V2 hooks and happened to work because the feature didn't exercise the broken path.
3. **Most integrations still on V1 runtime API** — `copilotRuntimeNextJSAppRouterEndpoint` + `ExperimentalEmptyAdapter` instead of V2's `createCopilotRuntimeHandler` + `InMemoryAgentRunner`. Only `built-in-agent` fully uses V2. The V1 API has the per-request race condition (hoisting to module scope was a band-aid, not a migration).
4. **Agent name mismatches masked by default fallback** — features passed because the runtime fell back to `"default"`, not because the correct agent was wired.
5. **Missing testids on custom renderers** — probe assertions were weak enough to pass via fallback selectors.
6. **`onRunInitialized` shim applied where unnecessary** — worked by coincidence because legacy format round-tripped correctly.
