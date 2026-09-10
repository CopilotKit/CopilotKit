# Parity Notes — Google Antigravity

Baseline: `showcase/integrations/langgraph-python/`.

Google Antigravity is **born-in-showcase** (no `examples/integrations/` Dojo
counterpart). It is unusual among the Python integrations: instead of a
graph or agent framework you author per-demo logic in, it drives Google
Antigravity's SDK — a Go harness subprocess with real file and shell access —
through the `ag-ui-antigravity` adapter, installed from an unmerged branch of
`ag-ui-protocol/ag-ui` (PR #2277). This document records where this
integration deliberately diverges from the canonical langgraph-python pattern
and why, following the same format as the Hermes integration's parity notes.

## Backend model

The backend is **born-in-showcase**: a FastAPI process (`src/agent_server.py`)
built with the adapter's `create_antigravity_app({name: agent, ...})`, hosting
one AG-UI endpoint per demo. `requirements.txt` installs the adapter from
`git+https://github.com/ag-ui-protocol/ag-ui@<sha>#subdirectory=integrations/antigravity/python`,
a commit SHA on the PR branch. The line is written URL-first, without a
`name @` prefix, so `validate-pins.ts` treats it as an intentional VCS
install rather than a non-exact pin; it becomes `ag-ui-antigravity==<version>`
once #2277 merges — alongside `google-antigravity==0.1.9`, the package that bundles
the Go `localharness` binary (manylinux x86_64 and aarch64 wheels).

Every demo name is backed by an `AntigravityAgent` built in
`src/agents/registry.py`. Several demo names share the _same_ agent instance
(e.g. every neutral chat-UI cell shares one `neutral_agent()`), which is safe
because Antigravity sessions are keyed by `thread_id` inside the agent and all
instances share one `HarnessPool` — one Go harness process for the whole
server, not one per agent, which matters because each harness process costs
roughly 95 MB. The Go harness itself makes the model call for every turn; the
Python process only builds the per-turn AG-UI events around it.

## LLM path

The Antigravity SDK has two gaps for a showcase built on aimock: no API-key
field for a custom OpenAI-compatible endpoint, and Gemini-shaped tool
schemas by default. Both are worked around with an in-process OpenAI-compatible
shim (`src/openai_proxy.py`, adapted from the AG-UI branch's
`examples/server/openai_proxy.py`) that sits between the Go harness and
aimock, injects the `Authorization` header the SDK's OpenAI path cannot send,
and normalizes tool schemas.

The shim also stamps a **static** `X-AIMock-Context: google-antigravity`
header on every outbound call, because the harness — not this Python process —
makes the model call. Python's usual per-request `ContextVar` header-forwarding
hook (`_header_forwarding.py`, copied from google-adk for CVDIAG parity) can
attach headers to the _agent_ hop, but those headers cannot cross into the Go
subprocess's own HTTP call to the shim. Concretely this means:

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

## Sub-agents

`subagents` does not use Antigravity's native sub-agent capability (disabled
via `enable_subagents=False`, for the same reason `ask_question` is disabled —
avoiding an interrupt this showcase cannot drive). Instead, `research_agent`,
`writing_agent`, and `critique_agent` are implemented as ordinary server-side
tools that each make one additional chat-completion call through the shim and
return prose. The per-tool cards render correctly from the resulting
`TOOL_CALL_*` events. The reference's delegation log stays empty here: it is
fed from shared agent state, which this adapter cannot write yet (see "Not
supported" below).

## Reasoning

**Measured: not surfaced.** The adapter itself is ready for it — the event
translator maps Antigravity's `StepType.THINKING` / `thinking_delta` onto
AG-UI `THINKING_*` events — but the Go harness never produces such a step
from an OpenAI-compatible response. Driving `/reasoning-default` directly
against a fixture whose response carries a `reasoning` field (so aimock
streams `reasoning_content` alongside `content`) yields exactly:

```
RUN_STARTED, TEXT_MESSAGE_START, TEXT_MESSAGE_CONTENT x36,
TEXT_MESSAGE_END, RUN_FINISHED
```

— the reasoning deltas are dropped and only the answer text arrives. The
CopilotKit reasoning surfaces (`[data-testid="reasoning-block"]`, the
built-in `Thinking… / Thought for…` label) therefore never mount, and the
shared `d5-reasoning-display` probe fails with `no reasoning-role message
rendered`. `tool-rendering-reasoning-chain` fails for the same reason: it
asserts one additional `reasoning-block` mount per turn.

Nothing in a fixture or a thin agent can change this, so
`reasoning-default`, `reasoning-custom` and `tool-rendering-reasoning-chain`
are declared in `not_supported_features`. Their pages, registry entries and
runtime-route names are deliberately left in place (same treatment as
`threadid-frontend-tool-roundtrip` below): the demos still load and answer,
they just render the reasoning as ordinary assistant text. Revisit when the
harness forwards `reasoning_content` as a thinking step.

## Not supported

Declared in `manifest.yaml` under `not_supported_features`, with reasons:

- `shared-state-read`, `readonly-state-agent-context`, `agent-config` — the
  adapter forwards only user messages to Antigravity; `RunAgentInput` state,
  context, and `forwardedProps` are not folded into the prompt yet.
- `gen-ui-agent`, `shared-state-read-write`, `shared-state-streaming` — no
  state-writer path: `STATE_SNAPSHOT` only comes from `structured_output` at
  the end of a turn, so live step lists and agent-written notes cannot stream.
- `multimodal` — non-text message parts are dropped by the adapter.
- `reasoning-default`, `reasoning-custom`, `tool-rendering-reasoning-chain`
  — the Go harness drops the model's `reasoning_content` deltas, so no
  thinking step and no reasoning surface ever reaches the chat. Measured;
  see "Reasoning" above.
- `gen-ui-interrupt`, `interrupt-headless` — quarantined upstream (a
  `@copilotkit/react-core/v2` resume-path hook bug); langgraph-python, the
  reference integration, declares these unsupported too.
- `declarative-gen-ui`, `a2ui-fixed-schema`, `a2ui-recovery`,
  `declarative-hashbrown`, `declarative-json-render`, `open-gen-ui`,
  `open-gen-ui-advanced` — declarative / open generative UI was not
  investigated for this adapter in this PR.

## Operational

`deployed: false`; no Railway service, no `showcase_deploy.yml` job, and no
`railway-envs.ts` entry — the same posture Hermes shipped with until its
adapter reached PyPI. CI build-check (`showcase_build_check.yml`) and
on-demand E2E (`test_e2e-showcase-on-demand.yml`) are wired so every PR
touching this package still builds the image and can run the shared
Playwright specs against aimock on demand.

**The on-demand E2E job runs the package's WHOLE `tests/e2e` directory** — its
final step is a bare `BASE_URL=http://localhost:3000 npx playwright test
--reporter=list`, with no spec filter. That includes
`reasoning-default.spec.ts`, `reasoning-custom.spec.ts` and
`tool-rendering-reasoning-chain.spec.ts`, which **are expected to fail here**
for as long as reasoning is unsupported (see "Reasoning"): they assert a
reasoning surface the Go harness can never produce. Those three specs are
byte-identical fleet copies of the shared specs and **must not be edited or
skipped** — iron rule 1. Read a red on-demand run against the
`not_supported_features` list in `manifest.yaml` before treating it as a
regression; anything outside those three specs is real.

`BASE_URL` (not `PLAYWRIGHT_BASE_URL`) is the env var `playwright.config.ts`
honours for `use.baseURL`, and `use.extraHTTPHeaders` pins
`X-AIMock-Context: google-antigravity` on the browser context. The config also
declares a `webServer` block that is skipped only when `CI` is set, so a local
run against an `--isolate` stack needs `CI=1 BASE_URL=http://localhost:<port>`
or Playwright will start its own `pnpm dev` on :3000 instead.

Two more things are expected-red in that whole-directory run, both measured on
2026-09-10 against an `--isolate` stack:

- **`beautiful-chat.spec.ts`'s Toggle Theme / Pie Chart / Bar Chart / Task
  Manager tests.** They drive the beautiful-chat page's own suggestion pills
  ("Toggle the app theme using the toggleTheme tool.", "Show me a pie chart of
  our revenue distribution by category. Use the query_data tool …", …), and NO
  fixture in the mounted set covers those prompts — not here and not in
  langgraph-python, the declared baseline, whose `beautiful-chat.json` carries
  only the five `d5 beautiful-chat probe: …` prompts plus `for next Tuesday`.
  Only `d6/claude-sdk-{python,typescript}/beautiful-chat.json` cover them; the
  specs' own comments point at the un-mounted legacy
  `showcase/aimock/feature-parity.json` (the local/isolate aimock mounts only
  `shared/`, `d4/`, `d5-recorded/`, `d6/`). So this is a fleet-wide gap, not a
  google-antigravity divergence, and it was left alone rather than papered over
  with per-integration fixtures the reference does not have. Task Manager is
  additionally `shared-state-read-write`, declared unsupported. The three
  chart/theme pills could be un-redded by mirroring the three
  `hasToolResult: false` entries out of
  `d6/claude-sdk-python/beautiful-chat.json` and restaging them on `turnIndex`;
  the five `beautiful-chat-*` D6 probe cells are green either way.
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

## Logo and docs-links placeholders

`shell/public/logos/google-antigravity.svg` is a copy of `google-adk.svg`,
used as a placeholder until a real Antigravity mark is available under a
permissive licence.

`docs-links.json` is the matching placeholder for documentation. There is no
antigravity-scoped tree on `docs.copilotkit.ai` — the adapter is still on an
unmerged AG-UI branch — so `features` is deliberately EMPTY and every demo
falls through to the framework-agnostic feature-level `og_docs_url` /
`shell_docs_path` in `showcase/shared/feature-registry.json`, with a `missing`
entry recording why. This follows `langroid`, the other born-in-showcase
package with no docs namespace. Demos with no registry-level entry render red
on the dashboard, which is the honest signal. The file previously pointed
every `og_docs_url` at `docs.copilotkit.ai/adk/...`, i.e. at Google ADK's
documentation, which documents a different adapter.

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
| tool-rendering-default-catchall | GREEN         |                                                                                                                                                                                                        |
| tool-rendering-custom-catchall  | GREEN         | Two probe turns at 0/2 and 3/5. Its four duplicate pill groups were removed — this file loads first alphabetically and was shadowing `tool-rendering.json`.                                            |
| auth                            | GREEN         |                                                                                                                                                                                                        |
| subagents                       | GREEN         | Supervisor chain restaged at turnIndex 0/2/4/6 (research → write → critique → answer).                                                                                                                 |
| mcp-apps                        | GREEN         | `create_view` leg moved into `mcp-apps.json` and staged on turnIndex 0.                                                                                                                                |
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

What is _not_ staged on `turnIndex`: a handful of legs mirrored in from
langgraph-python for tools no agent or page on this integration declares —
`display_flight`, `write_document`, and Mastra's hyphenated `get-weather`.
They are gated on `toolName`, which keeps them out of every candidate set
here (the tool is never in `RunAgentInput.tools`), so they are inert rather
than wrong. `tool-rendering-default-catchall.json` also still pairs a
`toolCallId` narration with a `toolName` leg 1; it happens to terminate
because its third entry — a `turnIndex: 0` text fallback — is the only
at-or-behind candidate on the second iteration. Both are mirror residue worth
cleaning up the next time that file is touched.

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
