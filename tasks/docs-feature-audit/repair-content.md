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
