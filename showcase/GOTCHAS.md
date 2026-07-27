# Showcase GOTCHAS — Framework & Integration Edge Cases

Tagline: framework-specific traps, aimock matcher / fixture-authoring edge
cases, and `--isolate` operational gotchas. Load when a fixture, framework, or
`--isolate` slot is misbehaving in ways the CLI output alone won't explain.

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

**`sequenceIndex` counters are scoped per X-Test-Id.** aimock tracks match counts in `fixtureMatchCountsByTestId` (src/journal.ts), keyed by the request's `X-Test-Id` header — `DEFAULT_TEST_ID` when no header is sent, so manual/staging traffic effectively shares one counter set for the process lifetime (subject to the `fixtureCountsMaxTestIds` FIFO eviction cap). The D6 harness mints per-run unique ids via `buildE2eTestId`, so CI runs are isolated from each other. Three caveats: (1) the sibling co-increment grouping (`matchCriteriaEqual`) ignores `context`, so identical fixtures mirrored across integrations form ONE co-increment group — a match on any integration consumes a slot for all; (2) the grouping is exact-equality over the other match criteria, so adding `turnIndex`/`hasToolResult`/`predicate` to sequenceIndex variants — with per-variant values, or to some siblings but not others (predicates compare by function reference, so even identical ones differ) — silently un-groups the siblings, and click 2 falls to the fallback instead of the sequenceIndex 1 variant; (3) under shared/default test ids the counters never reset within a map entry's lifetime — but the `DEFAULT_TEST_ID` entry can itself be FIFO-evicted once the per-test-id map exceeds `fixtureCountsMaxTestIds` (default 500), which silently resets its counters to zero. The sanctioned pattern for repeat-invocation fixtures is sequenceIndex variants with a non-sequenced fallback ordered AFTER them, so strict mode never 503s and shared-test-id traffic gracefully degrades to the fallback id — see the beautiful-chat calculator fixtures. `hasToolResult` remains the stateless alternative, but it is thread-global (a shape predicate over the whole conversation) and breaks interleaved pills, so it is not a universal substitute.

**Tool-rendering fixtures need `toolName` in match criteria.** If the request doesn't include tool definitions, the fixture falls through to text-only. Spring-ai omitted tools; mastra's shorthand keys produced wrong function names.

**PDF turn is fragile.** Two-turn multimodal probe: if turn 2's message doesn't match the PDF fixture, the image fixture matches instead. The PDF fixture must be the most specific match.

---

## Fixture Authoring Gotchas

**`context` field is required for D4/D6 fixtures.** Context routing (aimock `--context-field`) uses `match.context` to isolate fixtures per integration. Omitting `context` means the fixture matches globally -- every integration hits it, and the first match wins regardless of which integration made the request. Always set `match.context` for any fixture loaded through per-integration routing.

**`match.context` must equal the integration slug.** The slug is the directory name under `showcase/integrations/` (e.g., `langgraph-python`, `mastra`, `spring-ai`). A mismatch between the context value and the slug silently drops the fixture from that integration's match pool -- aimock falls through to the next fixture or returns an unmatched response.

**Never combine `content` and `toolCalls` in a single fixture.** A fixture must return either text (`content`) or tool calls (`toolCalls`), not both. Combining them produces undefined behavior: some providers stream the text, others stream the tool call, and the order is non-deterministic. Split into two fixtures with `sequenceIndex` if you need text followed by a tool call (or vice versa).

**`hasToolResult` is a request-match predicate over the WHOLE thread, not response-side conversation tracking.** It gates matching on whether ANY `role: "tool"` message exists anywhere in the incoming request's messages (aimock src/router.ts). Omitting it applies NO gate -- there is no `true` default. `hasToolResult: false` on a leg-1 fixture means it stops matching as soon as any tool result appears in the thread -- and because the check is thread-global, a tool result from a DIFFERENT pill earlier in the conversation also disqualifies it, breaking interleaved multi-pill flows (see the sequenceIndex caveats above). The sanctioned pattern is to pair each leg-1 fixture with a `toolCallId`-anchored follow-up entry ordered BEFORE it, as the beautiful-chat calculator fixtures do.

**MIRROR the canonical (langgraph-python) fixtures — never re-record per-integration.** D6 fixtures must be authored by copying the canonical `aimock/d6/langgraph-python/<cell>.json` (and `langgraph-typescript/`) and re-keying `match.context` to the integration slug. Do NOT run `aimock --record` against an integration to capture its live traffic: the matcher keys mainly on `userMessage` + `context` and does not gate on the system prompt or tool schema, so a recording bakes in whatever (possibly buggy) request the integration sent and replays it green forever. Recording launders request-side bugs; mirroring forces every integration onto one shared contract. (See "What Was Green But Still Wrong" #7.)

**Common fix classes when mirroring (from LGP/LGT/ms-agent-dotnet):** `toolCallId` (2nd-leg) matcher must precede `toolName` (1st-leg); `chunkSize: 9999` for tool args that must JSON-parse in one chunk; inline narration `content` on tool-call fixtures for render/settle races; tighten over-broad d4 catch-alls (e.g. `"summarize"` → `"Summarize the"`); strip spurious `turnIndex: 0` (canonical fixtures have no turnIndex so any turn matches).

---

## `--isolate` & aimock operational edge cases

**aimock caches fixtures at container startup.** aimock reads fixtures from disk
exactly once at boot and serves matches from an in-memory map. Editing a
fixture in a live stack has no effect until the container restarts. Within an
`--isolate` slot:

- **Fresh slot** (cold-start) — aimock loads fixtures from the volume mount on
  startup, so the first run after a fixture edit picks up the change for free.
- **Warm slot** (reusing a kept stack) — fixture edits require an explicit
  `docker restart showcase-iso<N>-aimock` before the next test run, or you'll
  see the pre-edit behavior with no log indication of why.

This is the most-recurring "why isn't my fixture fix working?" trap during
iterative cell debugging.

**`--isolate` slot collisions with foreign Docker projects.** The slot registry
under `~/.local/state/copilotkit/showcase/slots/` only tracks `showcase-*`
compose projects. If a sibling project (e.g. `ag2mm-*`, or another tool's
docker stack) owns the same host ports for an auto-picked slot, health checks
cross-resolve to the foreign containers and results misroute silently — the
isolated stack appears red even though its own containers are healthy. Two
remediations:

- **Pre-reserve the conflicting slot:** `mkdir
~/.local/state/copilotkit/showcase/slots/<N>` for each slot whose port range
  collides with the foreign stack. The CLI skips reserved slots when picking.
- **Tear down the foreign stack first:** `docker compose -p <foreign-project> down`
  before launching `--isolate`. Cleanest, but requires knowing which project
  is the culprit.

## Running D6 in Parallel (`--isolate`)

**The shared aimock is NOT a serialization bottleneck.** aimock matching is stateless per-request and context-keyed (`x-aimock-context: <slug>` per request); the only cross-request state is the per-X-Test-Id sequence counters (see the `sequenceIndex` gotcha above), which D6's per-run unique test ids (`buildE2eTestId`) keep isolated. So one instance serves many integrations concurrently with zero cross-talk for D6 traffic. Many integrations can run D6 at once.

**Use `--isolate <name>` for concurrent fixture-triage runs.** Each isolated stack gets its OWN aimock + pocketbase + dashboard + integration container on offset ports (`(slot+1)*200`, slot auto-claimed 0..45). The key benefit during triage: aimock has no hot-reload, so picking up edited fixtures requires a restart — and restarting a _shared_ aimock would nuke every concurrent run. A per-stack aimock means each run restarts only its own. Template: `bin/showcase test <slug>:<cell> --d6 --isolate iso-<slug>-w1 --verbose`. `<name>` must be lowercase `[a-z0-9_-]+`.

**Stagger concurrent launches 15-20s.** `stageSharedModules`/`restoreSymlinks` mutate `integrations/*/tools` symlinks in-place and `git checkout` them globally — simultaneous harness instances race there. Until per-isolation source-tree copies exist, stagger starts and keep concurrency modest (5-wide is comfortable; 10 is the theoretical ceiling at ~40 containers / 6-8GB).

**Pre-warm `:local` images before fanning out.** The Docker daemon serializes layered builds, so uncached integrations queue and stall the wave. Build (or pull `ghcr.io/copilotkit/showcase-<slug>:latest` and retag) ahead of time.

---

## What Was "Green" But Still Wrong

1. **18 copies of identical frontend code** — every fix was a blitz. One missed integration = one regression.
2. **V1/V2 imports inconsistent** — some pages used V1 provider with V2 hooks and happened to work because the feature didn't exercise the broken path.
3. **Most integrations still on V1 runtime API** — `copilotRuntimeNextJSAppRouterEndpoint` + `ExperimentalEmptyAdapter` instead of V2's `createCopilotRuntimeHandler` + `InMemoryAgentRunner`. Only `built-in-agent` fully uses V2. The V1 API has the per-request race condition (hoisting to module scope was a band-aid, not a migration).
4. **Agent name mismatches masked by default fallback** — features passed because the runtime fell back to `"default"`, not because the correct agent was wired.
5. **Missing testids on custom renderers** — probe assertions were weak enough to pass via fallback selectors.
6. **`onRunInitialized` shim applied where unnecessary** — worked by coincidence because legacy format round-tripped correctly.
7. **Re-recorded fixtures launder request-side bugs into green.** Because the aimock matcher keys on `userMessage` + `context` (not the system prompt or tool schema), capturing an integration's live traffic produces a fixture that matches that integration's exact (possibly malformed) request forever — a buggy system prompt or wrong tool name still replays green. The fix is to MIRROR the canonical langgraph-python fixtures, not record per-integration. _Mitigating fact:_ D6 assertions ARE canonical — `bin/showcase test <slug> --d6` runs only the shared `d6-all-pills.ts` driver against one global script registry (`harness/src/probes/scripts/d5-*.ts`) with strict `data-testid` checks; the per-integration `tests/e2e/*.spec.ts` are a separate surface `--d6` never invokes. So "pass D6" means "renders identical to the LGP contract," and a divergent integration (e.g. mastra emitting `custom-catchall-card` vs canonical `custom-wildcard-card`) genuinely fails — it cannot be papered green at the assertion layer, only at the fixture/request layer (hence rule #7).
