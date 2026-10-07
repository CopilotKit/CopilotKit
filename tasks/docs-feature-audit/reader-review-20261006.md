# Reader review: selected guides (2026-10-06)

A final review, read as a new developer, of the repaired guides for the five
selected frameworks. It was run against a local production build of branch tip
`56cf5aba12` (`next build` + `next start`, port 3910, light theme, 1280x900),
in a disposable worktree. Fixes were then made in the main worktree and checked
with the selected-guide guard.

## Method

For each of 45 cells (9 pages × 5 frameworks), a Playwright crawl and a manual
read checked the following:

- **HTML vs Markdown.** The rendered page and its `.md` route agree on headings
  and code. Code blocks were matched by their first meaningful line, both ways.
- **Markers.** The page has no skip markers, "Missing snippet", unresolved
  snippet tags or `[object Object]`.
- **Foreign code.** Code blocks contain no import fingerprints from another
  framework.
- **Embeds.** Every iframe's demo id exists in that framework's registry, and
  the iframe host matches its `backend_url`.
- **Code source.** Code samples come from Showcase and match the stated steps.
- **Reader contract.** The page states an outcome, prerequisites, steps and a
  test action.
- **Links.** All 105 internal links resolve, and every unique external link was
  fetched.
- **Copy Prompt.** "Copy Prompt" was clicked on 3 pages.

Built-in Agent pages are served at the root (`/quickstart`, `/voice`, …).

## Results

Key: **OK** = no defect. An ID means the cell has a finding (see Defects).
Severity: H = wrong or blocking, M = misleading or missing for a reader, L = cosmetic.

| Page                            | langgraph-python             | langgraph-typescript | google-adk    | strands       | built-in-agent              |
| ------------------------------- | ---------------------------- | -------------------- | ------------- | ------------- | --------------------------- |
| quickstart                      | OK                           | R2 (M, fixed)        | OK            | OK            | R8 (L, open)                |
| frontend-tools                  | R1 (M, fixed)                | OK                   | OK            | OK            | OK                          |
| human-in-the-loop               | R1 (M, fixed); R6 (M, open)  | R6 (M, open)         | OK            | R3 (M, fixed) | OK                          |
| generative-ui/tool-rendering    | R1 (M, fixed)                | OK                   | OK            | OK            | R4 (M, fixed); R7 (L, open) |
| generative-ui/state-rendering   | OK                           | OK                   | OK            | OK            | OK                          |
| shared-state                    | R1 (M, fixed); R5 (L, fixed) | R5 (L, fixed)        | R5 (L, fixed) | R5 (L, fixed) | OK                          |
| generative-ui/a2ui/fixed-schema | OK                           | OK                   | OK            | OK            | OK                          |
| voice                           | OK                           | OK                   | OK            | OK            | OK                          |
| multimodal-attachments          | OK                           | OK                   | OK            | OK            | OK                          |

- **Totals.** 45 cells were checked. 33 were OK on first read, and 12 had
  findings. After the fixes, 41 are OK. Four cells keep an open finding: two
  medium (R6) and two low (R7, R8).
- **Clean on every cell.** No skip markers, "Missing snippet" or broken embeds
  were found, and no code from another framework. Every iframe demo id exists
  in its framework's registry. All 105 internal links resolve.
- **Copy Prompt.** Checked on `/strands/human-in-the-loop`, `/google-adk/voice`
  and `/langgraph-typescript/generative-ui/a2ui/fixed-schema`. Each prompt names
  the right framework ("AWS Strands (Python)", "Google ADK", "LangGraph
  (TypeScript)") and the right feature and goal, and links back to the page.
- **Reader contract.** Every cell states an outcome, steps and a test action
  ("Try it" or "To test it"), except R4. Prerequisites are explicit on the
  quickstarts and state-rendering, and implicit elsewhere ("You have a working
  chat surface…", "already have…").

## Defects

| ID  | Severity | Cells                                                                                               | Finding                                                                                                                                                                | Root cause                                                                                                                                                                                                                     | Status                                                                                                                                                                                |
| --- | -------- | --------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| R1  | M        | LGP frontend-tools, human-in-the-loop, tool-rendering, shared-state                                 | The `.md` route emits a bare `<InstallPythonSDK />`. The HTML shows the `uv`/`poetry`/`pip`/`conda` install tabs, but the Markdown has no install command.             | `renderPageToLlmText` inlined shared snippets before it expanded `<FrameworkSetup />`, so snippets used inside a Showcase setup fragment stayed as tags.                                                                       | Fixed `f6afc8f8c2`: inline the setup fragment's snippets. New `llm-text` test, red without the fix and green with it.                                                                 |
| R2  | M        | LGTS quickstart (existing-agent, TypeScript tab)                                                    | The page says "Do not pass a `checkpointer`", then shows the Showcase `graph.ts` compiled with `MemorySaver`.                                                          | The Showcase excerpt contradicts the prose. The JS LangGraph API server always replaces `compiled.checkpointer` (`@langchain/langgraph-api` `dist/graph/load.mjs`).                                                            | Fixed `6dec8ec6d8`: the page now says the server replaces it, so readers should leave it out.                                                                                         |
| R3  | M        | Strands human-in-the-loop (also `/human-in-the-loop/useInterrupt` and the Strands TypeScript setup) | The "interrupt primitive" link returns 404.                                                                                                                            | strandsagents.com moved the guide to `/docs/user-guide/sdk/interrupts/`.                                                                                                                                                       | Fixed `81cbce635e`.                                                                                                                                                                   |
| R4  | M        | Built-in Agent tool-rendering                                                                       | The page has no test action.                                                                                                                                           | The page override ends at "The backend tools".                                                                                                                                                                                 | Fixed `065a30ed2d`: added "Try it" using the demo's own suggestions.                                                                                                                  |
| R5  | L        | shared-state on LGP, LGTS, ADK and Strands                                                          | The text says "The demo on this page wires…", but these pages embed no demo.                                                                                           | Shared root prose.                                                                                                                                                                                                             | Fixed `b939ea2ffa`: names the Showcase `shared-state-read-write` cell.                                                                                                                |
| R6  | M        | LGP and LGTS human-in-the-loop                                                                      | Prose says "LangGraph can enforce a graph checkpoint with `interrupt(...)`". Directly below, a box says "LangGraph doesn't support Human in the Loop: Interrupts".     | Both manifests list `gen-ui-interrupt` under `not_supported_features`, a harness quarantine for a react-core resume bug (since `5240ba813c`, 2026-06-06, also on main). `<InlineDemo>` renders that status as "Not supported". | **Open.** Needs an owner decision: lift the quarantine, or render a quarantine-specific notice. Changing the manifest changes the harness classification, so it was not changed here. |
| R7  | L        | Built-in Agent tool-rendering                                                                       | The page has no "Tool calls alongside reasoning" section, although Built-in Agent ships `tool-rendering-reasoning-chain` with a `reasoning-chain-message-view` region. | The Built-in Agent reasoning model setup (`createAgenticChatReasoningAgent`) has no `reasoning-chain-model` region to show.                                                                                                    | Open. Needs a Showcase region first.                                                                                                                                                  |
| R8  | L        | Built-in Agent quickstart (also the other quickstarts and multimodal `.md`)                         | Markdown keeps Shiki `// [!code highlight]` annotations that the HTML consumes.                                                                                        | The raw-MDX route emits fences as authored.                                                                                                                                                                                    | Open. This is site-wide renderer behaviour, not specific to these pages.                                                                                                              |

## Verification

- `npm run pretypecheck`, then
  `npx vitest run src/lib/__tests__/selected-showcase-guide-bindings.test.ts --maxWorkers=1 --execArgv=--max-old-space-size=4096`,
  run under `lockf -t 3600 /private/tmp/claude-501/shell-docs-gen.lock`: 25/25
  pass after the fixes.
- `npx vitest run src/lib/__tests__/llm-text.test.ts`: 59/59 pass. With the
  R1 change reverted, the new test fails (negative control).
- External links fetched: `a2ui-composer.ag-ui.com`,
  `dashboard.operations.copilotkit.ai`, `react.dev/errors/31` and
  `deeplearning.ai` return 200. The old Strands interrupts URL returned 404
  (R3).
