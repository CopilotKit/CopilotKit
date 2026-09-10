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
`tool-rendering-custom-catchall`, `tool-rendering-reasoning-chain`, and
`headless-complete` demos use tools (`get_weather`, `search_flights`,
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

`reasoning-default`, `reasoning-custom`, and `tool-rendering-reasoning-chain`
route to a `reasoning_agent()` built on `gpt-5-mini` through the same shim.
Whether these go green depends on whether the harness surfaces the OpenAI
`reasoning_content` deltas aimock emits for `gpt-5`-family models as
`thinking_delta` AG-UI steps. See the Verified Cells table below for the
observed result.

## Not supported

Declared in `manifest.yaml` under `not_supported_features`, with reasons:

- `shared-state-read`, `readonly-state-agent-context`, `agent-config` — the
  adapter forwards only user messages to Antigravity; `RunAgentInput` state,
  context, and `forwardedProps` are not folded into the prompt yet.
- `gen-ui-agent`, `shared-state-read-write`, `shared-state-streaming` — no
  state-writer path: `STATE_SNAPSHOT` only comes from `structured_output` at
  the end of a turn, so live step lists and agent-written notes cannot stream.
- `multimodal` — non-text message parts are dropped by the adapter.
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

## Logo placeholder

`shell/public/logos/google-antigravity.svg` is a copy of `google-adk.svg`,
used as a placeholder until a real Antigravity mark is available under a
permissive licence.

## Verified cells

Filled in by Task 8 (red-to-green sweep against the shared D6 probes, isolate
`google-antigravity-session`). Status is "pending" until that task runs.

| Feature                         | Status  |
| ------------------------------- | ------- |
| agentic-chat                    | pending |
| prebuilt-sidebar                | pending |
| prebuilt-popup                  | pending |
| chat-slots                      | pending |
| chat-customization-css          | pending |
| headless-simple                 | pending |
| headless-complete               | pending |
| beautiful-chat                  | pending |
| voice                           | pending |
| frontend-tools                  | pending |
| frontend-tools-async            | pending |
| hitl-in-chat                    | pending |
| hitl-in-app                     | pending |
| gen-ui-tool-based               | pending |
| tool-rendering                  | pending |
| tool-rendering-default-catchall | pending |
| tool-rendering-custom-catchall  | pending |
| auth                            | pending |
| subagents                       | pending |
| reasoning-default               | pending |
| reasoning-custom                | pending |
| tool-rendering-reasoning-chain  | pending |
| mcp-apps                        | pending |
