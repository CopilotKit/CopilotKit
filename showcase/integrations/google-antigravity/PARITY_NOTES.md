# Parity Notes — Google Antigravity

Baseline: `showcase/integrations/langgraph-python/`.

Google Antigravity now has an `examples/integrations/` Dojo counterpart:
`examples/integrations/antigravity` (the CLI starter, framework id
`antigravity`), added 2026-09-10. The showcase package still pins the same
adapter commit as the starter. It is unusual among the Python integrations:
instead of a graph or agent framework you author per-demo logic in, it drives
Google Antigravity's SDK — a Go harness subprocess with real file and shell
access — through the `ag-ui-antigravity` adapter from `ag-ui-protocol/ag-ui`. This
document records where this
integration deliberately diverges from the canonical langgraph-python pattern
and why, following the same format as the Hermes integration's parity notes.

## Backend model

The backend is a FastAPI process (`src/agent_server.py`)
built with the adapter's `create_antigravity_app({name: agent, ...})`, hosting
one AG-UI endpoint per demo. `requirements.txt` pins the adapter,
`ag-ui-antigravity==0.1.0`, alongside `google-antigravity==0.1.9`, the package
that bundles the Go `localharness` binary (manylinux x86_64 and aarch64
wheels).

Every demo name is backed by an `AntigravityAgent` built in
`src/agents/registry.py`. Several demo names share the _same_ agent instance
(e.g. every neutral chat-UI cell shares one `neutral_agent()`), which is safe
because Antigravity sessions are keyed by `thread_id` inside the agent and all
instances share one `HarnessPool` — one Go harness process for the whole
server, not one per agent, which matters because each harness process costs
roughly 95 MB. The Go harness itself makes the model call for every turn; the
Python process only builds the per-turn AG-UI events around it.

## LLM path

Every model call goes to Gemini over the SDK's native path. Showcase compose
sets `GOOGLE_GEMINI_BASE_URL=http://aimock:4010` for the whole fleet, and
`agents/_common.py` turns it into the adapter's `endpoint=`: a
`GeminiAPIEndpoint` pointed at aimock. With no base URL set, the same code
calls Google's API with `GEMINI_API_KEY` (or the fleet's `GOOGLE_API_KEY`).

The endpoint also carries a **static** `X-AIMock-Context: google-antigravity`
header, because the harness — not this Python process — makes the model call.
Python's usual per-request `ContextVar` header-forwarding hook
(`_header_forwarding.py`, copied from google-adk for CVDIAG parity) can attach
headers to the _agent_ hop, but those headers cannot cross into the Go
subprocess's own HTTP call to aimock. Concretely this means:

- Per-request `X-AIMock-Strict` and `x-test-id` headers stop at the agent hop
  and never reach the LLM hop. A fixture miss on the LLM hop therefore proxies
  through to the real upstream provider instead of hard-failing the way strict
  mode does elsewhere in showcase.
- CVDIAG has no LLM-hop rows for this integration — only agent-hop rows —
  since the LLM call itself is invisible to the Python-side middleware.

This is a deliberate, documented trade-off rather than an oversight; revisit
if cells start flapping because of it.

## Tool execution

The `tool-rendering`, `tool-rendering-default-catchall`,
`tool-rendering-custom-catchall` and `headless-complete` demos use tools (`get_weather`, `search_flights`,
`get_stock_price`, `roll_d20`, plus `headless-complete`'s own
`get_weather`/`get_stock_price`/`get_revenue_chart`) that run **server-side**,
1:1 with langgraph-python at the mechanism level: they are passed straight to
`AntigravityAgent(tools=[...])`, the adapter's SDK introspects their Python
signatures for the schema, and it dispatches each call and emits its
`TOOL_CALL_RESULT` itself — the aimock fixture only needs to make the model
_emit_ the tool call and narrate; the result comes from the real handler, not
the fixture. `deduplicate_tool_calls` stays on, so frontend tools are
dispatched at most once per turn.

## HITL

`hitl-in-chat` and `hitl-in-app` stay legitimately client-executed, as in the
reference: the agent calls a **frontend-provided** tool
(`book_call` / `request_user_approval`) via `useFrontendTool`/
`useHumanInTheLoop`, and that call parks as an awaited coroutine on the Python
side until the frontend resolves it. The SDK's built-in `ask_question`
built-in tool is disabled (`CapabilitiesConfig(enabled_tools=[BuiltinTools.FINISH])`)
so that nothing ever parks on an interrupt none of these demos know how to
answer.

Server tools can also raise AG-UI interrupts of their own with the adapter's
experimental `experimental_interrupt()` (reason, message, metadata and extra fields of their choosing;
the resume payload comes back unchanged). No showcase cell needs it: the two
interrupt cells, `gen-ui-interrupt` and `interrupt-headless`, stay quarantined
upstream for every integration.

## Sub-agents

`subagents` does not use Antigravity's native sub-agent capability (disabled
via `enable_subagents=False`, for the same reason `ask_question` is disabled —
avoiding an interrupt this showcase cannot drive). Instead, `research_agent`,
`writing_agent`, and `critique_agent` are implemented as ordinary server-side
tools that each make one additional Gemini `generateContent` call, against
the same endpoint as the harness, and return prose. The per-tool cards render from the resulting `TOOL_CALL_*`
events, and each tool also appends a `delegations` entry to shared state with
the adapter's `experimental_get_state()` / `experimental_set_state()`. The
adapter streams a `STATE_SNAPSHOT` as each tool finishes, so the reference's
live delegation log fills in while the supervisor runs, as it does on
langgraph-python.

## Reasoning

**Supported.** aimock replays a fixture's `reasoning` field as Gemini thought
parts, the harness turns them into `THINKING` steps, and the adapter emits
`REASONING_START`, `REASONING_MESSAGE_START`/`CONTENT`/`END` and
`REASONING_END`. `reasoning-default` and `reasoning-custom` share
`reasoning_agent()` and `aimock/d6/google-antigravity/reasoning.json`, both
prompts at turnIndex 0. `tool-rendering-reasoning-chain` has its own agent
(`agents/tool_rendering_reasoning_chain.py`, which adds the `roll_dice` tool the
dice pill needs) and fixtures. Every tool leg carries `reasoning`, so each turn
mounts at least one reasoning block. Leg k of a chain sits at base+2k and the
narration at base+4; the probe and the sequential e2e test run stocks, dice and
flights in one thread, so the dice and flights ladders repeat at offsets 5 and 10. Measured: a tool leg that also carries `content` and/or `reasoning` still
advances aimock's assistant count by exactly 2. The harness streams a thought
part concurrently with the tool call, so a `TOOL_CALL_*` group can arrive while
a reasoning message is still open; `@ag-ui/client`'s `verifyEvents` accepts
this.

## Shared state and agent context

Antigravity fixes an agent's instructions when the harness session starts, and
the adapter forwards only user messages, so the reference's pattern of folding
`RunAgentInput.state` or `.context` into the system prompt every turn
(`PreferencesInjectorMiddleware`, `CopilotKitMiddleware`) is not available.
Instead the adapter offers two silent built-in tools, both experimental and
off by default: `get_shared_state()` (`experimental_app_state=True`) returns
the thread's shared state, including `agent.setState` edits, and
`get_app_context()` (`experimental_app_context=True`) returns the run's
`useAgentContext` entries as `[{description, value}]`. They emit no TOOL_CALL
events, so no card appears in the chat. `shared-state-read`,
`shared-state-read-write`, `readonly-state-agent-context`, `agent-config` and
both open-gen-UI cells opt in, and tell the model in their instructions to call
the relevant tool before answering; `agent-config` keeps the reference's rulebook as static instructions
and has the model re-read the values every turn. The write side of
`shared-state-read-write` is a `set_notes` server tool using
`experimental_get_state()`/`experimental_set_state()`. The trade-off: the
model sees UI state only when it calls the tool. The fixtures stage the read as its own leg (tool at k, answer at
k+2), so a probe turn costs 3 assistant messages; the six-turn `agent-config`
probe sits at 0/2, 3/5 … 15/17.

## Multimodal

The adapter forwards inline `image`/`document`/`audio`/`video` parts to Gemini
as inline media; a remote URL becomes a text note for the model. The
`multimodal` cell has its own route (`/api/copilotkit-multimodal`) and agent
(`multimodal-demo`). Unlike langgraph-python it ships no
`legacy-converter-shim.tsx`: the shim appends legacy `binary` parts, which
AG-UI 1.0 rejects at `RunAgentInput` validation. PDFs reach the model as
documents, not flattened text. aimock matches on the prompt text only, so
fixture selection does not prove the attachment arrived; a capturing proxy saw
`inlineData` `image/png` and `application/pdf` in the Gemini requests, in both
orders in one thread (2026-09-30). The same forwarding covers the attachments
`headless-complete`'s composer offers.

## Declarative and open generative UI

`declarative-gen-ui` and `a2ui-recovery` are backend-owned. `generate_a2ui` is
a server tool (`src/agents/a2ui_dynamic.py`) that reads the page's context and
A2UI schema with `experimental_get_context()`, makes its own `render_a2ui` Gemini call
(forced with `toolConfig` ANY; `components`/`data` declared as JSON strings,
because Gemini fills a property-less array-of-object with `{}`), validates the
result with the A2UI toolkit, retries up to 3 times with the errors in the
prompt, and returns `a2ui_operations` or the `a2ui_recovery_exhausted` envelope
for the A2UI middleware. Both routes set `injectA2UITool: false`, which is
load-bearing: an injected `render_a2ui` frontend tool would park in the
harness. The surface arrives whole in `TOOL_CALL_RESULT`, with no progressive
streaming and no "Retrying… (N/M)" state between attempts; validation is
structural only. `a2ui-recovery` uses its own prompts
(`d5-a2ui-recovery.ts` PROMPTS entry and the page's `suggestions.ts`).
`declarative-hashbrown` and `declarative-json-render` are tool-less agents
whose instructions make them answer with the renderer's JSON as plain text
(`response_schema` would deliver it as state, not text). `open-gen-ui-advanced`
works now that the model can read app context: the sandbox-function
descriptors are readable via `get_app_context`, and are also written into the
system prompt.

## Not supported

Declared in `manifest.yaml` under `not_supported_features`, with reasons:

- `shared-state-streaming` — streaming needs tool arguments streamed token by
  token; the harness hands over whole argument dicts.
- `gen-ui-interrupt`, `interrupt-headless` — quarantined upstream (a
  `@copilotkit/react-core/v2` resume-path hook bug); langgraph-python, the
  reference integration, declares these unsupported too.

## Beautiful Chat surfaces

The page is byte-identical to langgraph-python, so it offers all nine
suggestion pills. Their status on this adapter:

| Pill                                            | Status                                                                                                                              |
| ----------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| Pie Chart, Bar Chart (Controlled Generative UI) | Works: frontend tools plus backend `query_data`. Probe cells green.                                                                 |
| Schedule Meeting (HITL)                         | Works: frontend tool parks until the user answers. Probe cell green.                                                                |
| Search Flights (A2UI Fixed Schema)              | Works: backend `search_flights` returns the A2UI operations and the runtime's A2UI middleware renders them. Probe cell green.       |
| Excalidraw Diagram (MCP App)                    | Expected to work: same `mcpApps` middleware path as the green `mcp-apps` cell, but no beautiful-chat probe covers it.               |
| Toggle Theme (Frontend Tools)                   | Works: frontend tool. Probe cell green.                                                                                             |
| Sales Dashboard (A2UI Dynamic)                  | Not supported: no `generate_a2ui` tool on this agent, and the route sets `injectA2UITool: false` as the reference does.             |
| Calculator App (Open Generative UI)             | Expected to work: same `generateSandboxedUi` path as the green `open-gen-ui` cell, but no beautiful-chat probe covers it.           |
| Task Manager (Shared State)                     | Works: frontend `enableAppMode`, then backend `manage_todos` writes `todos` with `experimental_set_state()`; the canvas renders it. |

The unsupported pills fail harder here than they would on langgraph-python.
If the model emits a tool name the harness was not configured with, the run
aborts with `unknown_tool` instead of streaming the call through (see
"Backend tools the reference declares and this package needed too").

## Operational

`deployed: false`; no Railway service, no `showcase_deploy.yml` job, and no
`railway-envs.ts` entry — the same posture Hermes shipped with until its
adapter reached PyPI. CI build-check (`showcase_build_check.yml`) and
on-demand E2E (`test_e2e-showcase-on-demand.yml`) are wired so every PR
touching this package still builds the image and can run the shared
Playwright specs against aimock on demand.

**The on-demand E2E job runs the package's WHOLE `tests/e2e` directory** — its
final step is a bare `BASE_URL=http://localhost:3000 npx playwright test
--reporter=list`, with no spec filter. The specs are byte-identical fleet
copies of the shared specs and **must not be edited or skipped** — iron rule 1
(`a2ui-recovery.spec.ts` carries this package's own prompts, which the probe's
per-slug PROMPTS table requires). Read a red on-demand run against the
`not_supported_features` list in `manifest.yaml` before treating it as a
regression.

`BASE_URL` (not `PLAYWRIGHT_BASE_URL`) is the env var `playwright.config.ts`
honours for `use.baseURL`, and `use.extraHTTPHeaders` pins
`X-AIMock-Context: google-antigravity` on the browser context. The config also
declares a `webServer` block that is skipped only when `CI` is set, so a local
run against an `--isolate` stack needs `CI=1 BASE_URL=http://localhost:<port>`
or Playwright will start its own `pnpm dev` on :3000 instead.

Two more things are expected-red in that whole-directory run, both measured on
2026-09-10 against an `--isolate` stack:

- **`beautiful-chat.spec.ts`'s Toggle Theme / Pie Chart / Bar Chart / Task
  Manager tests.** They drive the page's own suggestion pills, and on
  2026-09-10 no mounted fixture covered those prompts (langgraph-python's
  `beautiful-chat.json` only carries the five `d5 beautiful-chat probe: …`
  prompts). On 2026-09-28 `aimock/d6/google-antigravity/beautiful-chat.json`
  gained turnIndex-staged legs for all four, mirrored from
  `d6/claude-sdk-python/beautiful-chat.json`; Task Manager now also has the
  backend `manage_todos` / `get_todos` it needs. All four pass as of
  2026-09-28 (see "Verified cells").
- **`google-antigravity` is the only slug of 22 with no
  `aimock/d6/<slug>/_from-feature-parity.json`.** The other 21 carry a mirrored
  copy of the 22 legacy feature-parity fixtures. Adding one here is a real
  follow-up, but not a free one: 11 of those 22 entries are gated on
  `hasToolResult`, `toolCallId` or `sequenceIndex`, every one of which is dead
  on this integration, so the file needs a full `turnIndex` conversion pass
  before it would help rather than reintroduce re-emit loops. (Checked: none of
  its 22 entries covers the beautiful-chat pill prompts above, so it would not
  fix that bullet.)

### Session limit: ~50 threads per agent instance, per process lifetime

`SessionManager` caps live sessions at `max_sessions=50` per **agent instance**
and only reclaims one after `session_timeout_seconds=1800` of idle. Every E2E
test opens a fresh browser context, hence a fresh `thread_id`, hence a new
session — and several demos share ONE agent instance (`neutral_agent()` backs
`agentic_chat`, both prebuilt cells, `chat-slots`, `chat-customization-css`,
`headless-simple`, `voice`, `frontend_tools`, `frontend-tools-async`,
`threadid-frontend-tool-roundtrip`, `auth` and `default`), so their thread
counts pool into one 50-session budget.

Measured: two back-to-back D6 sweeps plus a couple of local spec batches wedged
the neutral agent inside half an hour, and every subsequent run failed with
`agent_run_error_event … Refusing to start a new Antigravity session: 50 of 50
in use` (`runtimeErrorCode: SESSION_LIMIT`) — which from the spec's side looks
exactly like a broken fixture (a card that never mounts) and is not one.
Restart the integration container to reclaim the budget:

```
docker restart <project>-google-antigravity
```

That measurement is why `agents/_common.build()` now passes
`session_timeout_seconds=300` and `max_sessions=200` (overridable through
`ANTIGRAVITY_SESSION_TIMEOUT_SECONDS` / `ANTIGRAVITY_MAX_SESSIONS`). An
abandoned E2E thread is never coming back, and `SessionManager._remembered`
cold-resumes a thread whose session was reaped, so the shorter idle timeout
costs no conversational continuity; with the shared harness pool an idle
session is roughly 1 MB, so the larger cap is cheap. The whole `tests/e2e`
directory (~90 tests, retries included) fits inside that budget in one
process.

## Frontend formatting

The repo's pre-commit `lint-fix` hook (oxlint/oxfmt) rewrites `import {X}` to
`import type {X}` in copied pages and re-stages them. The demo pages under
`src/app/demos/` in this package are therefore identical to
langgraph-python's modulo that rewrite — the hook is the repo's own
formatter and is semantically identical, not a deviation from the reference.

## Manifest deviation: `threadid-frontend-tool-roundtrip` not listed

The backend registers a `threadid-frontend-tool-roundtrip` agent
(`src/agents/registry.py`) and the Next runtime routes to it
(`src/app/api/copilotkit/route.ts`) — the page copied verbatim from
langgraph-python still works end to end. It is deliberately **not** declared
in `features`/`demos` here, matching both reference manifests: neither
langgraph-python's nor google-adk's `manifest.yaml` lists it either, even
though langgraph-python ships the same page. `shared/constraints.yaml`'s
`generative_ui` allowlists (checked by `validate-constraints.ts` /
`generate-registry.ts`) do not include this id under any approach, including
`constrained-explicit` (the approach this package declares) — so declaring it
as a feature fails the registry build with `ERROR: Demo
'threadid-frontend-tool-roundtrip' is not allowed by any declared
generative_ui approach`. It is a regression-test page (`kind: testing` in
`shared/feature-registry.json`, filed against ENT-658), not a showcase
feature cell, and every other integration that ships the page treats it the
same way.

## Logo and icon placeholders

`shell/public/logos/google-antigravity.svg` is a copy of `google-adk.svg`,
used as a placeholder until a real Antigravity mark is available under a
permissive licence. `showcase/shell-docs/src/data/frameworks/google-antigravity.ts`
carries the matching placeholder for the shell-docs landing page: its
`iconKey` is `"adk"` (there is no `google-antigravity` entry in
`showcase/shell-docs/src/components/icons/index.ts`'s icon registry yet),
called out with an inline comment at the `iconKey` line so a future pass
replacing the logo knows to replace the icon key too.

`docs-links.json` is now populated with per-feature entries — see
"Documentation" below — rather than the placeholder `missing` block this
section used to describe. There is still no antigravity-scoped tree on
`docs.copilotkit.ai` (the adapter is still on an unmerged AG-UI branch), so
every `og_docs_url` in that file points at a `docs.copilotkit.ai/google-antigravity/...`
path that does not resolve yet; `shell_docs_path` is what actually renders
today, pointing at the framework-agnostic shared pages under
`showcase/shell-docs/src/content/docs`. The file previously pointed every
`og_docs_url` at `docs.copilotkit.ai/adk/...`, i.e. at Google ADK's
documentation, which documents a different adapter; before that it was an
empty `features` map with a `missing` block, following `langroid`, the other
born-in-showcase package with no docs namespace.

## Documentation

Until the package is deployed, the landing record links features to the
package source on GitHub rather than to showcase URLs, omits per-feature demo
links, and ships an empty `liveDemos` list (an embedded showcase iframe would
404). Restore the showcase links and the live demo when `deployed` flips.

What exists for this integration's shell-docs surface:

- **A landing-page record** — `showcase/shell-docs/src/data/frameworks/google-antigravity.ts`,
  registered in `showcase/shell-docs/src/data/frameworks/index.ts`, and wired
  into the CLI-framework map in
  `showcase/shell-docs/src/components/content/landing-pages/framework-overview.tsx`.
  It advertises frontend tools, human-in-the-loop, and generative UI tool
  rendering — not shared state, which this adapter does not support (see "Not
  supported" above).
- **A quickstart override** —
  `showcase/shell-docs/src/content/docs/integrations/google-antigravity/quickstart.mdx`,
  modelled on `claude-sdk-python`'s: a "start from scratch" path via the CLI
  and a "use an existing agent" path that installs `google-antigravity` plus
  the `ag-ui-antigravity` adapter and wires up
  `create_antigravity_app` by hand.
- **Setup snippets for supported concepts** under
  `showcase/integrations/google-antigravity/docs/setup/*.mdx`, bundled and
  rendered wherever a shared doc's `<FrameworkSetup concept="..." />` slot
  asks for this framework's version of that concept.
- **A populated `docs-links.json`** — one entry per feature declared in this
  package's `manifest.yaml`, every `shell_docs_path` verified against an
  existing file under `showcase/shell-docs/src/content/docs`.

The `cli-start` demo's `command` now names the real CLI framework id
(`npx copilotkit@latest init --framework antigravity`) rather than the docs
slug. The CLI catalog entry itself is not done yet — it lives in the
Intelligence repo, not this one — so the quickstart's Callout still tells
readers to clone the CopilotKit repository and copy
`examples/integrations/antigravity` until that entry ships.

What is deliberately absent: no setup snippet for state streaming, the one
concept this adapter can't support (`state-streaming-setup.mdx` says so and
shows the per-tool-call alternative) — writing a snippet for a concept with
nothing behind it would document a capability that doesn't exist.

## Verified cells

Measured on 2026-09-10 with `bin/showcase test google-antigravity:<feature>
--d6 --isolate google-antigravity-session`, i.e. the production-equivalent
control-plane path against the shared D6 probes. The final sweep reported
`passed: 24, failed: 0` over the whole matrix, and every cell below was
observed green on two or three independent probe jobs in that stack (d4/d5
representative + d6 full), so these are stable greens rather than single
lucky passes.

Re-measured the same day after the fixture-staging corrections below, on a
freshly built `--isolate google-antigravity-session` stack: `passed: 24,
failed: 0` again, all 24 distinct cells. The package's own Playwright specs for
the multi-pill demos were run against that stack in the same session
(`CI=1 BASE_URL=http://localhost:<port> npx playwright test …`) —
`tool-rendering` 6/6, `tool-rendering-custom-catchall` 7/7, `hitl-in-chat` 5/5,
`hitl-in-app` 8/8, `frontend-tools-async` 5/5, `mcp-apps` 2/2 (+2 skipped
upstream), `beautiful-chat` 3/7 (the four reds are the fixture gap and the
unsupported shared-state pill documented under "Operational").

Re-measured on 2026-09-28 after rebasing onto main and adding the adapter's
`experimental_get_state()` / `experimental_set_state()`, on a freshly built `--isolate
google-antigravity-session` stack: `passed: 27, failed: 0`, including the three
new cells `a2ui-fixed-schema` (probed as `gen-ui-a2ui-fixed`), `open-gen-ui`
(`gen-ui-open`) and `gen-ui-agent`. Playwright against the same stack:
`subagents` 3/3 (delegation log included), `beautiful-chat` 9/9 (the four
pills that were red now have fixtures, Task Manager its todo tools),
`a2ui-fixed-schema`, `open-gen-ui` 5/5, `gen-ui-agent` 6/6.

`beautiful-chat` is five probe cells (`beautiful-chat-{bar-chart,pie-chart,
schedule-meeting,search-flights,toggle-theme}`) and only counts as green when
all five pass; `headless-complete` is probed as `gen-ui-headless-complete`,
`gen-ui-tool-based` as `gen-ui-custom`, `hitl-in-chat` as `hitl-text-input`,
`hitl-in-app` as `hitl-approve-deny`, and `chat-customization-css` as
`chat-css`.

| Feature                         | Result        | Note                                                                                                                                                                                                   |
| ------------------------------- | ------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| agentic-chat                    | GREEN         | Three-turn context retention. The mirrored `generate_haiku` pair was deleted: `agentic_chat` is the neutral agent and the page registers no tool.                                                      |
| prebuilt-sidebar                | GREEN         |                                                                                                                                                                                                        |
| prebuilt-popup                  | GREEN         |                                                                                                                                                                                                        |
| chat-slots                      | GREEN         |                                                                                                                                                                                                        |
| chat-customization-css          | GREEN         |                                                                                                                                                                                                        |
| headless-simple                 | GREEN         |                                                                                                                                                                                                        |
| headless-complete               | GREEN         | Four turns, one server-tool round-trip each; fixture legs staged on turnIndex 0/2, 3/5, 6/8, 9/11.                                                                                                     |
| beautiful-chat                  | GREEN         | All five probe cells. `search_flights` and `query_data` had to become backend tools (see below).                                                                                                       |
| voice                           | GREEN         |                                                                                                                                                                                                        |
| frontend-tools                  | GREEN         | Three turns; legs staged at turnIndex 0/2, 3/5, 6/8.                                                                                                                                                   |
| frontend-tools-async            | GREEN         | Also needed the stale duplicate `project planning` fixture removed. Pills 2-3 carry a second ladder at 3/5 and 6/8 for the spec's one-thread test.                                                     |
| hitl-in-chat                    | GREEN         | Frontend `book_call` parks and resumes. Both page pills emit `book_call` too — they used to emit `schedule_meeting`, a tool nothing here declares.                                                     |
| hitl-in-app                     | GREEN         | Frontend `request_user_approval` + in-app approval dialog. Escalate pill carries a second ladder at 3/5 for the spec's two-pill test.                                                                  |
| gen-ui-tool-based               | GREEN         | Needed a `gen-ui-custom.json` fixture (missing from this package). The stray `gen-ui-tool-based.json` — open-gen-UI content emitting `generateSandboxedUi`, which nothing here declares — was deleted. |
| tool-rendering                  | GREEN         | Owns all five pill prompts for the whole tool-rendering family; see the staging section below.                                                                                                         |
| tool-rendering-default-catchall | GREEN         | Legs at turnIndex 0 (tool) and 1/2 (narration); green under the strict rule deployed aimock uses (see below).                                                                                          |
| tool-rendering-custom-catchall  | GREEN         | Two probe turns at 0/2 and 3/5. Its four duplicate pill groups were removed — this file loads first alphabetically and was shadowing `tool-rendering.json`.                                            |
| auth                            | GREEN         |                                                                                                                                                                                                        |
| subagents                       | GREEN         | Supervisor chain restaged at turnIndex 0/2/4/6 (research → write → critique → answer).                                                                                                                 |
| mcp-apps                        | GREEN         | `create_view` leg moved into `mcp-apps.json` and staged on turnIndex 0.                                                                                                                                |
| a2ui-fixed-schema               | GREEN         | Backend `display_flight` returns the v0.9 `a2ui_operations` container; the route's A2UI middleware renders it. Legs at turnIndex 0/2.                                                                  |
| open-gen-ui                     | GREEN         | Frontend `generateSandboxedUi` (registered by the provider) parks and is answered by its handler. Legs at turnIndex 0/2.                                                                               |
| gen-ui-agent                    | GREEN         | Seven `set_steps` round-trips at turnIndex 0..12, summary at 14; the probe's second and third pills run in the same thread, so they carry ladders offset by 15 and 30.                                 |
| reasoning-default               | not-supported | Harness drops `reasoning_content`; no reasoning surface mounts. See "Reasoning".                                                                                                                       |
| reasoning-custom                | not-supported | Same root cause.                                                                                                                                                                                       |
| tool-rendering-reasoning-chain  | not-supported | Same root cause: the probe asserts one reasoning-block mount per turn.                                                                                                                                 |

### Why every reachable tool leg is staged on `turnIndex`

This is the single largest divergence from the reference fixtures and it is
forced by the adapter's architecture. Antigravity's Go harness owns the
conversation history in-process; the Python side only forwards the newest
user turn, and the harness composes the chat-completions request itself.
In that request **there is never a `role: "tool"` message**. A finished tool
call comes back as two `assistant` messages: one for the call (empty content)
and one whose text is

```text
Tool response for <tool_name>:
{"result": "..."}
```

Consequently aimock's `hasToolResult` matcher is permanently `false` for this
integration and `toolCallId` never matches, so the reference fixtures'
second-leg entries could not fire: every tool-emitting fixture kept matching
turn after turn and the run re-issued the same tool call until the probe timed
out (`done-signal-missing`, 200+ repeats on some cells).

The replacement discriminator is `turnIndex` — aimock's count of `assistant`
messages in the request — which the harness _does_ expose faithfully:
**+2 per tool round-trip, +1 per plain text answer**, verified against the
aimock journal on every cell. So each leg carries an absolute `turnIndex`:
leg 1 of the first turn at 0, its narration at 2, leg 1 of the next turn at
3, and so on. `sequenceIndex` was rejected deliberately: the LLM hop carries
no `x-test-id` (see "LLM path"), so its counters would live in the
`DEFAULT_TEST_ID` bucket forever and the second run against a warm aimock
would silently skip the tool leg — a masked green.

**A leg needs EVERY absolute position it can be reached from.** `turnIndex` is
a position _disambiguator_, not a reject gate (aimock's `selectByTurnIndex`):
among the fixtures that content-match, the one with the highest
`turnIndex <= assistantCount` wins, an untagged fixture is eligible at every
position, and a scripted position that is still ahead of the conversation
never answers. Three consequences this package is built around:

- A group staged only at `3/5` still answers a fresh thread — with leg 1,
  over and over, because no scripted position is at-or-behind 0 or 2. A group
  staged only at `0/2` answers the second pill of a thread with its
  _narration_, and the tool never fires.
- So a pill that a spec drives from two positions carries two ladders. The
  clearest case is the five-roll `roll_d20` chain in `tool-rendering.json`:
  the per-pill tests open a fresh page, so it walks the even counts
  `0/2/4/6/8` with the closing text at 10, while
  `tool-rendering-custom-catchall.spec.ts`'s "sequential pills in one thread"
  test clicks Find flights first (consuming 0..2) and walks the odd counts
  `3/5/7/9/11` with the text at 13. The two ladders are disjoint because a
  tool round-trip moves the count by 2 and a narration by 1, so both yield
  exactly five cards ending on 20. `hitl-in-chat`'s sales pill, `hitl-in-app`'s
  escalate pill, `frontend-tools-async`'s auth and reading pills, and the
  Chain-tools pill carry the same kind of second ladder.
- A prompt that is a superstring of another fixture's `userMessage` joins that
  fixture's candidate set, so ties matter. The Chain-tools pill's prompt
  contains "weather in Tokyo" and the Stock-price pill's contains "AAPL"; both
  owning groups are therefore registered ABOVE the group they shadow in
  `tool-rendering.json`, since a `turnIndex` tie is broken by registration
  order.

**Deployed aimock uses the strict rule.** Everything above describes the
relaxed selection a local stack gets. Staging and production run aimock with
`--proxy-only`, and a proxying aimock always applies the strict gate
(`recordMatchOptions`): a fixture whose `turnIndex` is not exactly the
assistant count is rejected, and an untagged fixture matches at every
position. A leg must therefore sit on the exact positions the flow reaches,
and an untagged tool leg loops forever on staging even when it terminates
locally. That is how `tool-rendering-default-catchall` ran away on staging
(PNI-570/PNI-571: three concurrent streams, +211 bytes per cycle, never
ending). Reproduce staging's rule locally by setting
`AIMOCK_STRICT_TURN_INDEX=1` on the stack's aimock container.

What is _not_ staged on `turnIndex`: a handful of legs mirrored in from
langgraph-python for tools no agent or page on this integration declares —
`display_flight`, `write_document`, and Mastra's hyphenated `get-weather`.
They are gated on `toolName`, which keeps them out of every candidate set
here (the tool is never in `RunAgentInput.tools`), so they are inert rather
than wrong. `tool-rendering-default-catchall.json` used to pair a
`toolCallId` narration with an untagged `toolName` leg 1. It terminated
locally only because its `turnIndex: 0` text fallback won the second
iteration under the relaxed rule; under the strict rule the fallback was
rejected and the untagged leg 1 answered every turn. It is now staged on
`turnIndex` like the rest: leg 1 at 0, narration at 1 and 2.

### Backend tools the reference declares and this package needed too

Antigravity's harness validates every tool name the model emits against the
tools it was configured with and aborts the run with
`AntigravityExecutionError: ... (unknown_tool)`. langgraph-python is lenient
here — an unknown tool call still streams to the frontend — so two surfaces
that work there died on this adapter until the tool was declared:

- `search_flights` on `beautiful_chat` (`src/agents/beautiful_chat.py`), which
  langgraph-python's `beautiful_chat` graph also owns as a backend tool. It
  delegates to the shared `showcase/shared/python/tools/search_flights.py`
  implementation.
- `query_data` on `beautiful_chat`, same file, same reason: four of that page's
  nine suggestion pills spell out "use the `query_data` tool to fetch the data
  first", so the model emits it by name. It delegates to the shared
  `showcase/shared/python/tools/query_data.py` implementation, exactly as
  langgraph-python's graph does.
- `render_pie_chart` / `render_bar_chart` on `gen-ui-tool-based` needed no
  change — the page registers them through `useComponent` with a schema, so
  the adapter picks them up from `RunAgentInput.tools`.

### Environment note: the harness image must be current

The three `--isolate` infra images (`showcase-harness:local`,
`showcase-dashboard:local`, `showcase-pocketbase:local`) are reused from the
local Docker store rather than rebuilt per run. On this machine
`showcase-harness:local` was two months old, and two cells were red purely
because of it: the stale `d5-gen-ui-custom` still had a per-slug allowlist
that sent the retired haiku prompt, and the stale `d5-hitl-approve-deny` had
no `completeOnMount` gate. Both went green with no source change after
`bin/showcase build harness-control-plane`. Rebuild that image before trusting
a red cell here.
