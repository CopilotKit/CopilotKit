# Content repair iteration log

Scope: selected React guides for LangGraph Python, LangGraph TypeScript, Google ADK, AWS Strands, and Built-in Agent, plus shared MDX where a correction benefits every generated route. Generation, registry, source-region, and runtime/fixture changes belong to their assigned lanes.

## Acceptance standard

For each repaired selected page, a reader can identify the minimum prerequisite, copy the shown current-v2 setup without an unrelated package or unsafe identity shortcut, understand the expected result, and follow an applicable API/reference or complete authorization link. Shared examples must agree with the current API reference; setup guidance must point to a runnable Showcase-owned implementation rather than inventing a second example.

## Planned repairs

- `CONTENT-GEN-006`: correct shared tool-rendering hook names and reference links.
- `CONTENT-GEN-009`: add Strands-native setup fragments only after the runtime lane provides the final bridge regions and semantics.
- `CONTENT-GEN-011`: repair two LangGraph interactive-guide sentences.
- `CONTENT-GEN-012`: remove only the unused v2 `@copilotkit/react-ui` install from selected ADK and Strands quickstarts.
- `CONTENT-GEN-014`: replace direct client-header identity examples in selected Intelligence-enabled quickstarts and the canonical runtime guide with the existing verified-session pattern, and link the complete authorization contract.
- `CONTENT-GEN-015`: remove `0.0.0.0` as a client destination from selected quickstarts while retaining loopback guidance.
- `CONTENT-GEN-016`: replace the Threads overview's copied coding-agent flow with the existing `RichThreadsSetupPrompt`.

## Evidence status

Local docs rendering is coordinated with the runtime and generation lanes. A successful AIMock reply is not treated as proof of an identity or prompt contract.

## Iteration 1 — selected-guide prose and contract fixes

Changed shared tool-rendering terminology and links (`CONTENT-GEN-006`), the LangGraph interactive introduction (`CONTENT-GEN-011`), selected ADK/Strands install lists (`CONTENT-GEN-012`), selected quickstart client-address troubleshooting (`CONTENT-GEN-015`), server-verified Intelligence identity guidance in LangGraph/ADK/Strands and the canonical runtime guide (`CONTENT-GEN-014`), and the Threads overview prompt handoff (`CONTENT-GEN-016`). Built-in Agent required only the connection wording because its quickstart already had the minimal v2 install list.

The shell-docs generator/pretest completed. The focused test then proved a source-composition defect: the shared Threads overview's `RichThreadsSetupPrompt` is not expanded in raw Markdown/LLM text, although direct uses are. The generation lane owns the renderer repair; the new focused test deliberately remains red until that repair lands. No local fixture result is used as proof of the identity or prompt contracts.

## Iteration 2 — canonical tool-rendering repair

`CONTENT-GEN-006` now uses the documented `useDefaultRenderTool` and
`useRenderTool` reference links, removes the stale `args` callback property,
and keeps one concise v2 guidance callout. The Mastra authored
Tool Rendering route now uses the canonical Showcase-backed guide rather than
an iframe and copied API samples. Its backend section pulls the real Mastra
tool imports and tagged weather-tool definition from the bundled Showcase
source. The raw-Markdown contract now resolves Mastra's authored route, which
is the route the browser serves.

`npm --prefix showcase/shell-docs test -- src/lib/__tests__/llm-text.test.ts
-t 'dependency-complete canonical tool-rendering|HTML unsupported state|no-demo
unsupported|supported wired'` completed with 8 passing checks after generator
pretest. This validates the Google ADK, LangGraph Python, and actual Mastra
tool-rendering Markdown outputs and the C001 Markdown availability behavior.
It does not claim runtime tool execution or prompt-contract verification.

## Iteration 3 — canonical Threads prompt in raw Markdown

`CONTENT-GEN-016` now has one source of truth: the Threads overview uses the
existing `RichThreadsSetupPrompt` instead of a copied coding-agent flow. The
raw Markdown/LLM renderer expands that prompt after shared MDX imports are
inlined, matching the order used by the HTML renderer. The expansion retains
the existing `add-rich-threads` intent; it does not create a second prompt API
or claim that a browser, cloud project, or persistence check has run.

`npm --prefix showcase/shell-docs test -- src/lib/__tests__/tool-rendering-docs.test.ts src/lib/__tests__/llm-text.test.ts src/lib/__tests__/rich-threads-setup-docs.test.ts -t 'shared default-rendering guidance|dependency-complete canonical tool-rendering|HTML unsupported state|no-demo unsupported|supported wired|canonical Rich Threads prompt'` completed after generator pretest with 3 files passing, 10 checks passing, and 47 checks skipped. This verifies the selected-source/Markdown composition contracts; it is not runtime fixture proof.

## Iteration 4 — source-owned named renderer

The root and Mastra canonical Tool Rendering pages now select the current
`render-weather-tool` region from each page's `tool-rendering` Showcase cell,
rather than embedding the hand-maintained `ToolRenderingPerToolExample`. The
region includes the actual `get_weather` name and Zod `parameters` schema;
its card and parsing helper stay in the same Showcase demo. A static bundled
source check confirmed that Google ADK, LangGraph Python, and Mastra each
provide that region from `src/app/demos/tool-rendering/page.tsx` lines 15–96.

The focused Vitest invocation completed generator pretest but did not execute
its assertions because the local shell-docs test resolver could not find
`gray-matter`. No dependency or lockfile was changed to work around that local
environment state. `git diff --check` passed for the four changed source/test
files. Rerun the focused renderer tests after shell-docs dependency resolution
is restored.

## Iteration 5 — validation after dependency restoration

After the generation lane restored the existing locked shell-docs dependency
tree, the focused source-region and raw-Markdown suite passed: 3 files, 11
checks passed, 46 skipped. It confirms the shared root/Mastra body resolves
through its `@/snippets` import, each selected context renders its own
Showcase-owned named renderer, and the C001/C016 controls remain intact.

## Iteration 6 — local identity and production authorization boundary

`CONTENT-GEN-014` is deliberately a local-only quickstart contract: the four
selected guides return one fixed `local-demo-user` identity and state that it
cannot isolate multiple users. They link to the existing Thread authorization
guide rather than defining a placeholder application-auth helper. That guide
contains the executable-shape server contract (`verifyAppSession(request)`,
`onRequest`, and ownership guards for the unscoped thread routes).

An independent generation review found no undefined production helper or
multi-user safety claim. `npm --prefix showcase/shell-docs test --
src/lib/__tests__/intelligence-quickstart-docs.test.ts -t 'keeps selected
quickstart identities local-only'` passed after generator pretest: 1 check
passed, 4 skipped.

## Iteration 7 — source-owned authored-guide contracts

`CONTENT-GEN-020` updates the AG2 and Mastra Frontend Tools pages to the v2
`useFrontendTool` reference. The AG2 page now renders its actual
`frontend-tool-registration` region from the `frontend-tools` Showcase cell,
rather than maintaining a second action sample. `CONTENT-GEN-022` replaces the
copied named renderer with the exact `render-weather-tool` region from the
`tool-rendering` cell, including its Zod parameters, state-safe location access,
and dependency array.

`CONTENT-GEN-021` remains **pending**. Its new frontend state region is valid,
but the guide still contains a copied backend that does not match the Showcase
`gen-ui-agent` (`searches`/`StateSnapshotEvent` versus the actual
`steps`/`ReplyResult` agent and route). Do not treat the frontend region alone
as a complete source-backed guide repair.

`npm --prefix showcase/shell-docs test -- src/lib/__tests__/current-v2-authored-guides.test.ts`
passed after generator pretest: 2 checks covering only C020/C022. It proves
their source selection and rendered Markdown content, not an agent/browser
runtime run.

## Iteration 8 — Google ADK tool-first HITL path

The shared HITL overview now leads with the tool-based
[`useHumanInTheLoop`](/reference/hooks/useHumanInTheLoop) path. It states the
expected decision flow, expands each framework's existing setup fragment, and
then names native LangGraph graph interrupts as a separate capability. The
Google ADK route explicitly says that its supported path is the tool-based
in-chat decision and that `useInterrupt` and the headless-interrupt guide do
not apply because ADK has no native interrupt primitive. The page still uses
the existing Showcase `hitl-in-chat` source region; it adds no replacement
backend example.

`npm --prefix showcase/shell-docs test --
human-in-the-loop-context.test.ts` passed after generator pretest: 1 file and
1 test. It renders the Google ADK Markdown context and asserts the supported
path, explicit capability boundary, current v2 reference link, and removal of
the former LangGraph-first prose. This is documentation rendering evidence,
not an ADK runtime qualification.

## Iteration 9 — shared browser-tool language and prompt contract check

The shared Frontend Tools guide now says that the developer registers browser
functions and the agent calls them. It links to `useFrontendTool`, keeps the
existing Showcase-backed sample, and distinguishes browser work from backend
work. The shared Agent Config guide now leads with the user outcome (tone,
expertise, and response length) and retains the meaningful runtime difference:
separate runtimes read agent state while in-process agents receive forwarded
provider properties. The read-only context guide no longer attributes every
framework bridge to `CopilotKitMiddleware`; each integration's setup owns its
actual bridge details.

The existing `RichThreadsSetupPrompt` remains one shared component and raw
Markdown expands it correctly. A first source-only check found that the local
`~/Code/Intelligence` checkout (4.9.39) lacks the `--intent` parser branch, so
that checkout cannot qualify the public prompt. The official registry reports
`copilotkit@latest` as 4.9.50, however, and the exact copied command succeeded
against that published package:

```text
npx --yes --package=copilotkit@4.9.50 copilotkit onboard start --coding-agent codex --intent add-rich-threads
```

It exited 0 and served the Add Rich Threads onboarding plan. The disposable
run used `XDG_STATE_HOME` and the npm cache under `/private/tmp`, with
telemetry disabled; it made no login, project, or cloud call and did not touch
user state. This resolves REPAIR-005 for the published prompt contract. The
residual limit is only local checkout/version skew; its stale `dist` must not
be used to judge the public docs command.

## Iteration 10 — shared chat and headless reader pass

The Headless UI guide now names the concrete outcome: build a chat with app
components while retaining the agent connection, streaming, and tool calls.
It describes the complete cell as a complete message view rather than a
"generative-UI weave," and links `useAgent`, `useCopilotKit`, `useComponent`,
and `useRenderToolCall` to their v2 references. The Chat Components guide now
starts with the choice a reader is making—use `CopilotChat` when they do not
want to build message-list, streaming, and tool-call handling—and links both
`CopilotChat` and `useConfigureSuggestions` to their v2 references. Neither
edit changes the Showcase snippets, setup, or runtime contract.

Shared-state review confirmed the source-backed guide structure and corrected
the read-only-context transport wording.

## Iteration 11 — local Showcase replacements for legacy feature viewers

`CONTENT-GEN-003` replaces the selected legacy remote Feature Viewer embeds
with local Showcase-backed demos and extracted source. The shared LangGraph
Interactive source now covers both LangGraph Python and LangGraph TypeScript;
the Strands and Built-in Agent Interactive wrappers use the same local
`hitl-in-chat` demo and `hitl-hook` region. The Built-in Agent Frontend Tools
wrapper uses `frontend-tools` plus its `frontend-tool-registration` region.
Its Tool Rendering wrapper reuses the current local `ToolRenderingGuide`,
which contains the `tool-rendering` demo and `render-weather-tool` region.

This removes remote Feature Viewer provenance from five guide sources covering
eleven selected feature bindings. The replacement prose states an observable
action and outcome. It adds no source regions, manifest entries, or runtime
logic. Source inspection confirms the docs renderer supplies the route's
integration to `InlineDemo` and the wrappers' `snippet_cell` provides the
source-cell default to `Snippet`. Render validation is pending the next
approved lightweight shell-docs slot.

## Iteration 12 — Strands state and context setup fragments

The Strands runtime lane supplied stable, tested source regions in
`src/agents/agent.py`: `state-context-builder`, `agent-context-prompt`, and
`shared-state-preferences-prompt`. The new setup fragments use the first two
through `DemoCode`; the existing preferences formatter remains part of the
same builder's shared-state support. Shared State explains how current state
reaches each run; read-only context and agent config explain the AG-UI
context-to-prompt bridge. The recipe gate and the shared-state read/read-write
and read-only-context D6 cells were green before this documentation change.
Documentation rendering is pending the next approved shell-docs slot; this
does not claim a new runtime qualification.

## Iteration 13 — Angular reader isolation and Microsoft Agent Framework overview contract

The Angular reference now describes its own activity and human-response
contracts without comparing them to another frontend. Built-in Agent's shared
quickstart keeps its existing default-frontend instructions, but its Angular
rendered branch now points readers to the Angular quickstart for provider and
runtime-URL setup. Its server-tools callout likewise selects Angular's
`registerFrontendTool` or `registerRenderToolCall` guidance instead of
React-only hooks.

The Microsoft Agent Framework Python HITL overview is intentionally a chooser
for interrupt-based and tool-based child guides. Its stable-API test now checks
those two CTA paths and confirms the overview does not present provider setup;
it does not add copied backend code to the overview.

`npm --prefix showcase/shell-docs test --
src/lib/__tests__/angular-docs-content.test.ts
src/lib/__tests__/ms-agent-python-stable-api.test.ts --pool=forks
--maxWorkers=1 --no-file-parallelism` passed after generator pretest: 2 files,
17 tests. This is raw-Markdown/source-contract evidence only. Angular browser
representation and generator-owned resolver mappings remain separate gates.

## Iteration 14 — unavailable Pydantic state-rendering route and Built-in Agent reader path

`CONTENT-GEN-031` cannot be repaired with a source snippet: the selected
Pydantic frontend expects `steps`, while its routed backend publishes `todos`.
The guide therefore removes the invalid Python/TypeScript hybrid and remote
iframe, makes the integration gap explicit, and directs readers to the working
Pydantic Shared State guide. It does not claim Pydantic AI lacks state support,
and the underlying Showcase backend implementation remains open.

`REPAIR-009` now gives the Built-in Agent page a complete reader path around
its actual provider and factory excerpts: start with Quickstart, consult the
current `CopilotKitCoreConfig` properties contract and forwarded-properties
safety rules, then set the demo to casual/expert/detailed and observe the
factory's active-config echo. This does not present the factory region as a
complete application. Independent review cleared both source/reader changes.

Focused raw-Markdown contracts were added to the existing authored-guide and
selected-provenance tests. They are queued for the currently coordinated docs
slot; no test, preview, or runtime qualification is claimed here.

## Iteration 15 — Microsoft Agent Framework source contracts and page-action feature intent

`CONTENT-GEN-028` replaces the copied universal A2UI policy with the selected
.NET runtime/agent regions (`injectA2UITool: false` plus an explicit tool) and
Python runtime/agent regions (`injectA2UITool: true` plus no bound tool).
`CONTENT-GEN-029` replaces the viewer and stale examples with the public
`gen-ui-agent` registration, actual publishers/factories, and the shared React
subscription. Both have independent source reviews; runtime behavior remains separate.

`REPAIR-012` keeps the canonical onboarding command unchanged. For a page with
an existing `snippet_cell`, page actions add the frontmatter title/description
as the feature outcome after onboarding and link the same framework/frontend
scoped `.mdx` URL that the route resolves. Quickstarts and references have no
cell and retain the generic prompt. Dedicated Learning and Rich Threads prompts
remain on their existing CLI intent routes. Focused prompt/route contracts and hydrated Agent Config browser copy subsequently passed.

## Iteration 16 — focused selected-guide gate

After independent review, shell-docs pretypecheck and the coordinated five-file
focused suite passed **70 tests in 18.91 seconds** using two forks and a 4 GiB
heap cap (`/private/tmp/docs-audit-focused-20260913.log`). It covers the
C028/C029 Microsoft Agent Framework rewrites, the C031 truthful Pydantic
availability notice, REPAIR-009 Agent Config provenance/action, REPAIR-012
feature-aware copied prompts and scoped Markdown URLs, and REPAIR-013 wording.

The browser independently confirmed the Agent Config copy contains its feature
outcome and selected scoped Markdown URL. Strict local AIMock replay confirms
the guide’s casual/expert/detailed action after the local fixture transport
repair. These are source/representation or patched-local results as applicable;
they do not qualify the complete framework matrix or current registry-only
1.71.1, which lacks the unreleased relative-URL core repair.

## Iteration 17 — full shell-docs suite

The bounded full shell-docs suite reached **125/126 files and 947/948 tests**.
The sole red test is `ms-agent-python-stable-api.test.ts`, which still requires
a retired `OpenAIChatClient` import from the C029 state-rendering page. The new
guide intentionally extracts the actual `set_steps` publisher, public runtime
key, and factory instead. The follow-up is test-only and must assert that
current contract rather than reintroduce obsolete code.

## Iteration 18 — selected React guide provenance and current API repair family

The selected-reader audit found four guide-family defects after the earlier
source-backed repair commits. These are recorded as `REPAIR-014` through
`REPAIR-017` in `repair-status.json` before their first render gate.

- **MCP Apps (REPAIR-014):** the effective Built-in Agent override taught the
  retired `MCPAppsMiddleware`/`.use()` shape. Its actual runtime configures
  `CopilotRuntime({ mcpApps: { servers } })`; the replacement extracts that
  runtime configuration and the existing no-manual-renderer frontend region.
- **Shared State (REPAIR-015):** the Built-in Agent override invented
  task/todo state. The selected demo really stores `preferences` and returns
  `notes`, but the generic factory does not yet read `input.state.preferences`.
  The replacement binds its provider/runtime and verified notes bridge, labels
  model-side preference use as pending, and uses the real **Remember something**
  action.
- **Display-only (REPAIR-016):** the four affected selected bindings are
  LangGraph Python, LangGraph TypeScript, Strands, and Built-in Agent. Their
  sources now share the actual `gen-ui-tool-based` bar-chart renderer and
  `useComponent` setup, removing legacy `CopilotKitState` and
  `@copilotkit/sdk-js/langgraph` instructions.
- **Auth and multimodal (REPAIR-017):** both root guides resolve for all five
  selected React integrations. The new excerpts bind the actual auth request
  headers/provider/on-request gate and the actual attachment configuration/File
  adapter. This is provenance and setup repair, not evidence that every
  backend or media fixture is qualified.

The next required check is one source/render contract that exercises the
effective selected Markdown bindings and rejects the retired MCP, task-state,
and legacy display-only fragments. Local browser and runtime gates remain
separate.

## Iteration 19 — refreshed public CLI contract

The prior published CLI proof was version `4.9.50`, so it could not stand for
the now-current `copilotkit@4.9.60`. In an empty temporary directory with
isolated npm and XDG state, the exact Rich Threads command exited zero and
printed the **Add Rich Threads to the existing CopilotKit app** plan:

```text
npx --yes copilotkit@4.9.60 onboard start --coding-agent codex --intent add-rich-threads
```

The generic copied prompt shape also exited zero with its requested 12-character
run id preserved as `onboarding_run_id`:

```text
npx --yes copilotkit@4.9.60 onboard start --run 4960cli00001 --coding-agent codex
```

Both commands stopped after printing instructions. They did not inspect a user
project, log in, provision cloud resources, or execute an implementation step.
This refresh closes only the current public CLI syntax/intent check; it does not
qualify a local app setup.

## Iteration 20 — LangGraph TypeScript bring-your-own prerequisite gap

`/langgraph-typescript/quickstart` resolves to the shared
`integrations/langgraph/quickstart.mdx` source. Its URL-specific tab default
selects TypeScript only for `language_langgraph_agent`, but the actual
bring-your-own setup has no such tabs: it tells the reader to run `uv init`,
`uv add`, and create Python/FastAPI files. That makes the TypeScript route
present Python prerequisites as its implementation path.

The selected Showcase TypeScript agent provides the repair source of truth:
`showcase/integrations/langgraph-typescript/src/agent/package.json` declares
the current JavaScript packages and `dev` command,
`src/agent/langgraph.json` maps `starterAgent` to `graph.ts:graph`, and the
Next runtime route creates a `LangGraphAgent` against the local deployment.
`REPAIR-018` records the scoped prerequisite mismatch. The next change must
add source regions and a TypeScript-specific bring-your-own branch; it must not
translate the Python example or label current `CopilotKitStateAnnotation` or
`@copilotkit/sdk-js/langgraph` usage as legacy.

## Iteration 21 — Built-in Agent Shared State bridge

The prior guide limitation is now resolved by runtime commit `4ed958ba1f`.
Only the `shared-state-read-write` agent opts into the factory's
`stateSystemPrompt`, which shape-filters its `preferences` object and adds the
known fields to that run's model prompt. The strict fixture has a preserved RED
before-state and a two-turn GREEN result that requires the preference prompt
on the initial tool call; the formatter unit has three focused passing checks.
The guide now extracts that formatter rather than retaining its pending-work
callout. A raw-Markdown contract and rendered reader check remain before this
docs repair can advance; neither result qualifies the complete Built-in Agent
matrix or current registry-only 1.71.1 release.

## Iteration 22 — effective Auth and Multimodal guide boundaries

The earlier REPAIR-017 path statement was wrong. The authoritative local capture
at `tasks/docs-feature-audit/route-source-check-20260913/index.json` fetched all
five selected Auth Markdown routes successfully. Every response contains the
root guide heading **Start with the Showcase auth path** and has no snippet
marker. LangGraph Python and TypeScript therefore use root `auth.mdx` too; their
selected content is its `auth_pattern="langgraph"` branch, not the shadowed
`integrations/langgraph/auth.mdx` file. Auth repairs must stay in the root body,
with any server-verification pattern labelled application-owned rather than a
parallel Showcase implementation.

The selected multimodal frontend sources accept only `image/*` and
`application/pdf` at 10 MB and expose PNG/PDF sample actions. `REPAIR-020`
records the mismatch with the shared guide's broader audio/video outcome. The
repair will distinguish the runnable Showcase image/PDF path from general
attachment API options and will not claim broader provider support before
behavior evidence exists.

## Iteration 23 — readonly capture classification

`REPAIR-019` is a test-observability correction, not a runtime product repair.
The prior readonly capture counted a resource request as an agent run. Commit
`9a56b9b0e8` narrows it to the agent/run boundary and ignores resource POSTs;
ten unit checks plus a real Built-in Agent capture are green. Any future strict
turn-mode policy remains a distinct test concern.

## Iteration 24 — Auth and TypeScript quickstart source/render contracts

The root Auth guide now selects the actual request-header, provider transport,
and complete V2 `onRequest` gate for all five selected routes. Its LangGraph
branch uses the selected `LangGraphAgent` runtime excerpts and no longer
presents the Python FastAPI path as a TypeScript Showcase setup.

The shared LangGraph quickstart now gives the TypeScript URL a source-backed
bring-your-own tab. It renders the selected agent `package.json`,
`langgraph.json`, and bounded exported graph, then uses the package's actual
`npm install` and `npm run dev` path. The demo-content bundler now admits an
explicit command-only cell with source highlights without inventing a browser
route.

Shell-docs pretypecheck passed. The Auth/REPAIR-018 focused contracts passed
2 files / 18 tests in 19.32s, and the command-only bundle regression passed 1
file / 9 tests in 10.99s. These are source/render checks; temporary-app setup
and framework qualification remain separate.

## Iteration 25 — LangGraph TypeScript isolated bring-your-own setup

The TypeScript BYO configuration was reproduced in an isolated `/private/tmp`
layout with the selected `src/agent` directory and its actual `shared-tools`
dependency. The exact documented package manifest installed successfully with
`npm install --ignore-scripts --no-audit --no-fund` under a 4 GiB heap cap.

A focused no-emit typecheck reached the copied graph and all of its imports,
but reported three existing source type errors: two `SalesStage` schema
mismatches and one optional-field-to-`Flight` mismatch. The identical command
against the checked-in agent source reports the same three errors, so the
result is a baseline Showcase graph issue rather than an isolated setup or
package-resolution failure. The reproduction script and full result are
`reproduce-lgts-byoc-setup.sh` and `lgts-byoc-setup-20260913.md` in this
directory. No agent server was launched; graph-load validation waits for the
runtime slot after the active Built-in Agent matrix.
