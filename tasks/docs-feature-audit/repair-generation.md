# Generation and representation repair log

## C001 — unsupported-state parity in raw Markdown

### Scope

- Source: `showcase/shell-docs/src/lib/llm-text.ts`
- Focused regression coverage: `showcase/shell-docs/src/lib/__tests__/llm-text.test.ts`
- Baseline revision: `b0079629eae9445f82cae66baf674c091da971ad`

### Before

The HTML `Snippet` component reads the generated catalog and displays the supported/unsupported state. The raw Markdown renderer used only bundled demos, so an unsupported scoped page emitted the interactive-demo comment or code instead of the HTML unsupported notice.

Because the test was introduced with this repair, the before result was reconstructed by applying only the implementation diff in reverse while retaining the test assertions, then restoring it immediately. Command:

```sh
npm --prefix showcase/shell-docs test -- --run src/lib/__tests__/llm-text.test.ts -t 'matches the HTML unsupported state'
```

Result: 3 failed / 46 skipped. The failing cells were LangGraph Python interactive generative UI, AWS Strands Python state streaming, and Built-in Agent headless interrupts. Each Markdown result lacked the expected `Not supported on …` notice.

### After (superseded count)

The raw renderer now resolves catalog state before loading a snippet or expanding an inline demo and emits the same framework-specific unsupported notice as HTML.

The original focused assertion passed: 3 passed / 46 skipped. This count is
retained as the first green checkpoint only.

### Current regression checkpoint

After the related shared-guide repair landed, the complete focused suite below
passed: **5 files, 62 tests**. This supersedes the earlier three-assertion
count; it includes the unsupported-state controls, guide bindings, redirect
contract, Rich Threads Markdown composition, and source-backed tool-rendering
composition. Generation completed with 21 integrations, 1,029 catalog cells,
and 802 demo bundles.

## C016 — Rich Threads prompt composition in raw Markdown

### Before

The Threads overview imported the shared snippet containing
`<RichThreadsSetupPrompt />`. The raw Markdown renderer expanded prompt helpers
before importing that snippet, leaving a literal component tag and omitting the
canonical `add-rich-threads` onboarding command. The focused test was red with
that exact marker.

### After

Prompt helpers are expanded after shared snippets are inlined. The same raw
Markdown path now emits the canonical command and contains no literal prompt
component. This is a shared composition change; it does not copy prompt text
into the Threads guide.

## Mastra tool-rendering source extraction

The authored Mastra page refers to the actual `tool-rendering-agent` region.
The region already existed around the current Showcase agent, but its file was
absent from the cell's manifest highlights, so generation could not bundle it.
The manifest now highlights that source once for the `tool-rendering` cell.

### Validation

```sh
npm --prefix showcase/shell-docs test -- --run \
  src/lib/__tests__/rich-threads-setup-docs.test.ts \
  src/lib/__tests__/tool-rendering-docs.test.ts
```

After the generator lifecycle completed, both files passed: 6 tests passed.
The before/after route and screenshot index is
[`repair-render-comparison.md`](repair-render-comparison.md).

The earlier concurrent Mastra expectation failure is **superseded**: the
source-backed shared guide repair was committed in `fe8b79f9d2`, and the
current focused checkpoint passes.

## C002 — Google ADK guide bindings and legacy route continuity

The two Google ADK catalog entries now target their existing canonical scoped
guides. The two previously advertised component URLs remain usable: current
HTML, `.md`, and `.mdx` requests each return a permanent local redirect to the
corresponding scoped canonical route. The final HTML and Markdown responses are
200 and contain no missing-snippet marker.

The preserved baseline delivered legacy HTML as a generic Google ADK page and
returned 404 for the two legacy Markdown URLs. The current redirect contract
therefore restores a meaningful final Markdown response rather than merely
preserving a status code.

## C004 — Hashbrown and JSON Render catalog ownership

The feature catalog now binds `declarative-hashbrown` and
`declarative-json-render` to their existing root feature guides, and the
Generative UI navigation exposes both. Current HTML and Markdown responses for
both routes return 200 with no missing-snippet marker.

## Current focused validation

```sh
npm --prefix showcase/shell-docs test -- --run \
  src/lib/__tests__/llm-text.test.ts \
  src/lib/__tests__/feature-guide-bindings.test.ts \
  src/lib/__tests__/next-config-redirects.test.ts \
  src/lib/__tests__/rich-threads-setup-docs.test.ts \
  src/lib/__tests__/tool-rendering-docs.test.ts
```

Result: **5 files passed, 62 tests passed**. The source-binding and redirect
unit covers C002/C004; the local response matrix is recorded in
[`repair-render-comparison.md`](repair-render-comparison.md).

## REPAIR-002 — Google ADK display setup binding

The shared `frontend-tools-setup` concept is rendered by the root display,
tool-based, and frontend-tools guides. The Google ADK version previously
extracted the in-chat HITL agent, whose instruction always called
`generate_task_steps`. A chart-agent replacement would have moved the same
drift into the frontend-tools guide, whose demo changes the background.

The setup now extracts a tagged, feature-neutral factory from
`shared_chat.py`. It shows the real `AGUIToolset()` bridge and terminal
callback without imposing a chart or HITL tool name. The focused regression
was red on the old HITL source and is green for the source bundle plus raw
Markdown expansion of all three consumers:

```sh
npm --prefix showcase/shell-docs test -- --run \
  src/lib/__tests__/frontend-tools-setup-coverage.test.ts
```

Result: **1 file passed, 4 tests passed** after full setup/demo generation.
Local `:3004` response checks then confirmed six 200 responses (HTML and
`.mdx` for each guide), each with the neutral factory and without
`generate_task_steps`, missing-snippet markers, or literal setup tags. The
two generative-UI pages retain their own `render_bar_chart` renderer later in
the page; the frontend-tools route does not inherit it from setup.

## C037/C038 — Hashbrown and JSON Render source-backed guide code

The two root BYOC guides were reachable but their frontend examples had
separated from the selected Showcase implementations. Hashbrown showed a
nonexistent `useJsonParser(message.content)` / `useUiKit({ catalog, value })`
shape. JSON Render showed a handwritten parser and catalog API that did not
exist in the demos.

Each guide now resolves compact, source-backed excerpts from its selected
`declarative-hashbrown` or `declarative-json-render` cell: Hashbrown's kit,
provider, chat slot, and parser; JSON Render's catalog, registry, assistant
renderer, and guarded parser. The guide does not duplicate either library's
API. The renderer copies are currently integration-owned source files, so the
guide uses bounded file excerpts rather than creating another shared copy or
changing each frontend copy merely to add annotations.

```sh
npm --prefix showcase/shell-docs test -- --run \
  src/lib/__tests__/byoc-source-guides.test.ts
```

Result: **1 file passed, 2 tests passed** after generation. The test renders
both guides as raw Markdown for LangGraph Python, LangGraph TypeScript, Google
ADK, Strands, and the built-in agent, and asserts their actual APIs resolve
without skipped snippets. Local `:3004` delivery then checked both HTML and
`.mdx` for both guides across those five frameworks: **20/20 responses were
200**, contained all required selected-source terms, and contained no missing
or unexpanded snippet marker.

## C010 / REPAIR-004 — Built-in Agent A2UI source and raw-Markdown context

The Built-in Agent fixed-schema factory already had both the inline schema and
the `display_flight` operation builder, but exposed neither under the shared
guide's source-region names. The guide now resolves those existing regions and
identifies Built-in Agent as schema-inline.

The initial rendered HTML was correct, while the canonical raw Markdown route
still selected LangGraph's schema-loading branch. This was a distinct resolver
defect: `/built-in-agent/...` canonically redirects to the bare route, and the
bare Markdown resolver applied Built-in Agent context only when an authored
override file existed. Shared root guides had no context, so snippet lookup
fell back to LangGraph. The resolver now keeps the root-framework context for
all bare routes, matching the live root docs surface.

```sh
npm --prefix showcase/shell-docs test -- --run \
  src/app/llms-mdx/[[...slug]]/route.test.ts \
  src/lib/__tests__/a2ui-fixed-schema-builtin-agent.test.ts
```

Result: **2 files passed, 17 tests passed** after generation. The route suite
keeps the generated framework-scoped control and adds the authored-root shared
fallback control. On a freshly restarted local `:3004`, HTML and canonical
Markdown both returned 200 with the Built-in Agent inline schema and operation
builder, no LangGraph `a2ui.load_schema` excerpt, and no missing/unexpanded
snippet marker. The legacy Built-in Agent Markdown URL redirects to that same
canonical response.
