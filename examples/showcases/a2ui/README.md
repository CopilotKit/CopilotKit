# A2UI Playground, powered by CopilotKit

A calm research desk. A Google ADK agent on Gemini answers open questions in prose, and when a view would carry the answer better (a trend, a comparison, pictures of the subject, a set of sources) it renders one from CopilotKit's standard A2UI catalog. Choose **JSON** or **Express** in the composer. Both reach the same renderer as A2UI v1.0 JSON. The **A2UI** button on a view shows those JSON operations, including compiled JSON in Express mode; it does not show raw Express source. Press it again to return to the view.

What it shows:

- **Native generative UI** (`@copilotkit/react-core/v2/generative-ui`): `createGenerativeUI` extending `standardUI`, the standard catalog unchanged, themed in Solarized through the `--a2ui-*` variables.
- **Natural rendering.** A custom research-desk prompt describes how to research and present, with prose preferred when a view would add little. Ask "how has climate change affected us over time?" and the agent decides a chart helps. The same research policy applies to both formats.
- **JSON/Express picker.** JSON is the default. The choice persists in this browser and travels in `forwardedProps.uiFormat`. Explicitly changing it starts a fresh thread for the new format. Reloading the saved choice or selecting the current value does not reset a thread. The picker is disabled during a run; the model choice is retained.
- **Markdown transport with previews.** JSON runs stream repaired `a2ui` operations; Express runs compile `a2ui-express` fences on the server and stream valid JSON snapshots. Both keep prose, generated views, and the report sheet in the same reply. See the transport details below.
- **App functions behind generated buttons**: `saveNote`, `openSource`, `askFollowUp`, `copyText`, `exportCsv` (`src/lib/generative-ui.ts`, handlers in `src/lib/use-desk-functions.ts`).
- **Decompile** (`src/components/SurfaceFrame.tsx`): every generated view sits over the A2UI that made it. The A2UI button pixelates the view into its source and back. The source opens folded to one line per operation.
- **A report sheet** (`src/components/ReportPanel.tsx`): ask for a report or briefing and the agent writes it into a named `GenerativeUISurface` beside the chat, live.
- **Pictures**: a `find_images` tool searches Wikimedia Commons for freely licensed pictures with credits, shown in `Image` and `ImageGrid` views.
- **A catalog of every component** (`src/components/CatalogPage.tsx`, `src/lib/catalog.ts`): the drawer's **Catalog** tab shows the standard catalog's components in its seven groups (layout, text, inputs, feedback, data, media, composites). Each specimen is A2UI rendered by the same renderer as the agent's views, with an **A2UI** button to read it and an info button with what the agent is told about the component. `?catalog` links straight to it.
- **Light and dark**: Solarized light or dark, following the system setting. The app's tokens switch on `prefers-color-scheme`, and `.dark` on `<html>` brings the CopilotKit chat and the catalog's own dark values along.
- **The composer's + menu**: attach a picture (or drop one anywhere on the chat), or pick a view from a catalog (Chart, Table, Calculator, Form, Pictures, Map, Report) to answer the next question with.
- **Intelligence threads** with a thread drawer. On a thread's first run the agent picks an icon for it (a fast Flash-Lite call) and sends it as thread state, which Intelligence keeps.
- **Model picker**: Gemini 3.8 Flash (default), Gemini 4 Argon, Gemini 3.1 Pro. The choice rides in `forwardedProps.model` on each run; the agent applies it in `before_model_callback`.
- **Grounded research**: a `web_research` tool runs Gemini with Google Search grounding and returns real source links, shown with their favicons under the question.

## Run it

This example deliberately uses the CopilotKit workspace packages from the native generative UI branch (PR #7819), so run it from the monorepo. The Google A2UI compiler and its dependencies use published releases; no SDK or renderer fork is required.

```bash
# 1. From the repo root: install and build the CopilotKit packages
pnpm install
pnpm exec nx run-many -t build -p @copilotkit/react-core @copilotkit/runtime

# 2. Keys
cp examples/showcases/a2ui/.env.example examples/showcases/a2ui/.env
# Add GEMINI_API_KEY and CPK_INTELLIGENCE_API_KEY to that .env file.

# 3. The agent (Python 3.12+, uv)
uv sync --project examples/showcases/a2ui/agent --group dev
pnpm exec nx run @copilotkit/example-a2ui-research-desk:dev:agent
# Serves AG-UI on http://localhost:8014.

# 4. The app, in a second terminal at the repo root
pnpm exec nx run @copilotkit/example-a2ui-research-desk:example-dev
# Opens http://localhost:3014.
```

`CPK_INTELLIGENCE_API_KEY` comes from `npx copilotkit@latest login` then `npx copilotkit@latest project select` (it writes the key into `.env`).

Useful URLs:

- `http://localhost:3014/?thread=<id>` opens a thread directly (the address bar follows the open thread, so prepared threads can be bookmarked).
- `http://localhost:3014/?catalog` opens the component catalog.
- `http://localhost:3014/?inspector` turns on the CopilotKit Inspector, whose Generative UI pane shows surfaces, the catalog, and the prompt.

## A demo in five minutes

The starters on the welcome screen are the script. None of them names a component; the agent decides what to draw.

1. **Living longer** ("How has life expectancy changed across continents over the last century?"). The agent researches (sources appear under the question), answers in a few sentences, and a line chart builds up. The thread gets a title and an icon in the drawer. Press the **A2UI** button: the chart pixelates into the JSON operations that rendered it (`createSurface`, `updateComponents`, the data model). Press it again to return to the view. Click **Save** in the view: the app's `saveNote` handler runs and the note lands in **Notes** at the foot of the drawer.
2. **My commute** ("Help me estimate my commute's yearly CO2…"). The agent builds an estimator: sliders for distance and days, live results computed in the view with `calc`. Drag a slider; the numbers change with no call to the agent. Decompile to show the `@path` bindings and `calc` calls behind them.
3. **Choosing a program**. The agent needs facts only you have, so it asks with a form. Submit it; the values go back to the agent as a message, and it answers with a researched comparison.
4. **The Aral Sea** for pictures from Commons beside a chart, and **Brief me on fusion** for a report written live into the sheet beside the chat.
5. From the composer's **+**, pick **Table** and ask anything: the agent answers with a table. Switch the model and ask again. Switch **JSON** to **Express** to start a fresh conversation using the other syntax. Open an older thread from the drawer: its history and views come back from Intelligence.

## How it fits together

```
Browser (TanStack Start, React 19)
  CopilotKitProvider generativeUI={{ ui: deskUI, theme, transport: "markdown" }}
  properties={{ model, uiFormat }}
  ├─ ThreadDrawer (useThreads, agent-picked icons)
  ├─ CopilotChat generativeUISurface={SurfaceFrame} suggestionView={StarterSuggestions}
  ├─ ReportPanel (<GenerativeUISurface id="report">)
  └─ useGenerativeUIFunction(...) handlers
        │  /api/copilotkit  (TanStack Start server route)
        ▼
CopilotRuntime  intelligence: CopilotKitIntelligence  (threads, names, history)
        │  AG-UI over HTTP
        ▼
Google ADK agent (agent/, ag-ui-adk)
  system prompt + App Context (the generative UI guide, sent by the browser)
  tools: web_research, find_images
  JSON: FenceRepairer → A2UI JSON fences
  Express: Google SDK → validated snapshot diffs → A2UI JSON fences
```

### Why markdown transport

The tool transport (`render_ui`) asks the model to put the whole A2UI tree into function-call arguments. In our runs Gemini garbled large nested objects there: missing `version`, dropped `component` keys, even escaped key names like `"\"surfaceId\""`. As plain JSON lines in its reply, the same model writes valid operations.

For JSON runs, [`fences.py`](agent/src/research_desk/fences.py) repairs missing braces and misplaced `props`, and sends each component as its object closes rather than waiting for an entire line. It also removes a redundant root `Card` frame as an app-specific presentation choice.

### What Express changes, and why

The bridge adapts the Express/JSON prototype from `examples/v2/a2ui-markdown` at commit `2184c0e425`. It reuses that integration approach with this playground's catalog and research agent; it does not replace the playground with the generic demo's prompt or components.

Google's published SDK owns Express parsing and compilation. [`express.py`](agent/src/research_desk/express.py) adapts the browser's component, slot, event, and function schemas into the SDK catalog, then uses SDK validation. [`transport.py`](agent/src/research_desk/transport.py) handles this app's markdown stream and target routing. The browser's catalog remains the source of truth, including custom functions and the `report` target.

| Choice                                                           | Reason                                                                                                                                                                                                                                  |
| ---------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Compile on the server into A2UI v1.0 JSON                        | Both formats use the existing renderer, bindings, action handlers, source view, and persisted thread representation.                                                                                                                    |
| Replace UI syntax guidance only                                  | The research tools, selected model, title/icon flows, report policy, user context, and current surface values still apply.                                                                                                              |
| Keep compiler and snapshot state local to each run               | Concurrent conversations must not share partially compiled surfaces or deduplication state.                                                                                                                                             |
| Buffer prefixes and diff valid SDK snapshots                     | SDK 0.9.0 does not implement incremental Express parsing. Recompilation permits previews without repeatedly creating a surface or replaying unchanged operations. Replace this bridge when the SDK supplies a suitable incremental API. |
| Hold a program containing `deleteSurface` until final validation | An unfinished program must not delete a working view. Ordinary create/update programs can still preview.                                                                                                                                |
| Validate before recording emitted operations                     | An invalid batch must not make later output assume the browser received a create or update that was withheld.                                                                                                                           |
| Report final compilation failures                                | Invalid final syntax or graphs produce `RUN_ERROR`, with no automatic retry. A valid preview already shown may remain; this custom conversation does not yet provide a dedicated error/retry affordance.                                |

An upstream `RUN_ERROR` passes through unchanged: unfinished Express is discarded, and the source stream closes rather than replacing the provider's error with a second compilation failure. Cancellation also closes the source stream.

Validation has a specific boundary. For complete trees created during the current run, the bridge uses SDK component and graph checks, including root and child references and cycles. The browser envelope for older surfaces contains target, data model, and rejection information, but no component tree. Updates to those surfaces validate the available nodes; references into the unseen prior tree cannot be fully checked on the server. The browser remains the final validation guard for that combined tree.

### Prompt policy and SDK compatibility

[`prompt.py`](agent/src/research_desk/prompt.py) is a substantial custom research-desk prompt: research current claims, cite sources, prefer prose when sufficient, choose focused views, and use real actions. These policies apply in both formats; syntax examples and transport instructions vary by format. The instruction to avoid a root `Card` is the app's visual rule because `SurfaceFrame` already frames the view. A `Card` root is valid A2UI; the root component's ID is `root`, but its type need not be `Card`.

The Express guide includes the following compatibility instructions for SDK 0.9.0/core 0.4.0. They preserve the existing catalog contract without modifying the SDK.

| Case                                 | Express guidance                                                                            | Why                                                                                                                                                     |
| ------------------------------------ | ------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Long component signatures            | Use named arguments such as `Text(text="Hello")`.                                           | The compiler accepts keywords, while generated SDK guidance favors positional arguments; optional styling fields make positional calls fragile.         |
| Open-ended `calc`/`series` arguments | Use `{"@call":"calc", args:{expression:"seats * 29", seats:$/seats}}`.                      | Constructor syntax rejects additional named arguments even when the function schema permits them.                                                       |
| A custom button function             | Use `onClick={functionCall:saveNote(title="Finding", text=$/note)}`.                        | A bare `saveNote(...)` compiles to a function value, while `onClick` requires an Action wrapper. This wrapper is also part of the host's JSON contract. |
| Agent event context and chat text    | Use `onClick={event:{name:"followUp", userMessage:"Explain this", context:{note:$/note}}}`. | The SDK's `Event(...)` constructor drops `userMessage` and ignores named `context`; an explicit event map retains both.                                 |
| Corner radius                        | Use a catalog token such as `radius="md"`.                                                  | SDK style normalization rejects CSS values such as `"12px"`.                                                                                            |

The SDK-specific guidance can be removed when the corresponding constructor, skill-generation, or style behavior is supported upstream. The Action wrapper and catalog adaptation remain host contracts. Compilation and validation do not execute browser functions.

### Nested catalog guidance

The Express integration also carries a separately tracked prompt fix. SDK 0.9.0's generated signatures omit nested field contracts for object and array properties wrapped in dynamic-value unions. For example, a Map marker is described as a place without showing its allowed fields. The model can then invent a `description` field that the compiler rejects.

`ExpressCompiler.instructions()` appends the received literal JSON Schemas for structured properties, including nullable and union branches. The guide retains required fields, enums, nested types, and closed-object restrictions for every component. It does not change component schemas, weaken validation, or change the shared research/presentation policy. Data bindings and function values remain available.

For the captured standard catalog, this adds 20,389 characters: the complete Express guide grows from 63,258 to 83,647 characters. The regression test uses a custom component name and nullable object, verifies the received contracts are present, and proves that an invented nested field is still rejected. A live Express Map also rendered three markers with the existing keyless MapLibre/OpenFreeMap renderer. The compact-shape experiment is not included here.

### Published dependency baseline

The following published versions were checked on **2026-10-24** and are pinned directly so imports and compatibility workarounds have an explicit baseline. The lockfiles record the resolved dependency graph. CopilotKit packages deliberately remain `workspace:*`.

The root `pnpm.overrides` resolves requests for `@ag-ui/client@1.0.2` to published `1.0.3`. The example's `HttpAgent` must share the same `AbstractAgent` class identity as the workspace runtime and its middleware; mixing these patch versions fails TypeScript's private-member compatibility check. The override aligns this client across the workspace, including other consumers pinned to `1.0.2`. It leaves `0.0.x` clients and other SDK version pins unchanged. Remove the override when workspace manifests and their consumers consistently request a compatible current client version without it.

| Package          | Version  |
| ---------------- | -------- |
| `a2ui-agent-sdk` | `0.9.0`  |
| `a2ui-core`      | `0.4.0`  |
| `ag-ui-adk`      | `0.11.0` |
| `ag-ui-protocol` | `1.0.0`  |
| `google-adk`     | `2.13.0` |
| `google-genai`   | `2.33.0` |
| `@ag-ui/client`  | `1.0.3`  |

### Blockers and remaining limits

Status as of **2026-10-24**. The compatibility cases above are handled by the bridge; they are not unresolved implementation blockers.

| Area                         | Status                                                 | What remains                                                                                                                                                                                                                                                                           |
| ---------------------------- | ------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Local JSON/Express execution | No unresolved implementation blocker                   | Use the documented credentials and setup; the live coverage below is narrower than full protocol conformance.                                                                                                                                                                          |
| Shared deployment            | Deployment blocker                                     | Replace the fixed demo `identifyUser` with identity from your app's verified session before serving multiple users.                                                                                                                                                                    |
| Production startup           | Production-start blocker; development setup unaffected | `example-start` expects `.output/server/index.mjs`, but the Vite build produces `dist/server/server.js` without that `.output` entry. Fix the build artifact/start command and Node adapter setup before deployment; the emitted file may export a handler rather than start a server. |
| Prefix recompilation         | Nonblocking SDK limitation                             | Recompiling accumulated Express permits previews but may add work as source grows. The bridge does not claim a universal latency improvement over JSON.                                                                                                                                |
| Older surface graphs         | Nonblocking validation limit                           | The server cannot check references into an omitted prior tree; the browser validates the combined result, as described above.                                                                                                                                                          |
| Compilation recovery         | Nonblocking behavior limit                             | `RUN_ERROR` ends a failed run; there is no automatic retry. This custom conversation can leave only preceding prose or a valid preview visible. A dedicated error/retry affordance is separate UI work.                                                                                |
| Unsubmitted calculator edits | Nonblocking persistence limit                          | Reloading a JSON thread restored its generated view with initial quantity 3 after a local edit to 5; the note saved with quantity 5 remained. This existing client-state behavior is unchanged by the bridge. Persistence after submitting was not tested.                             |
| Generated claims and dates   | Model-content limitation                               | A live synthetic report added “March 2025” without a supplied date. Verify generated claims and dates; protocol validation cannot establish factual accuracy. This concerns the shared research agent's content, not Express syntax.                                                   |

### Verification

Run these commands from the repository root:

```bash
NX_DAEMON=false NX_TUI=false pnpm exec nx run @copilotkit/example-a2ui-research-desk:test:agent
NX_DAEMON=false NX_TUI=false pnpm exec nx run @copilotkit/example-a2ui-research-desk:check-types
NX_DAEMON=false NX_TUI=false pnpm exec nx run @copilotkit/example-a2ui-research-desk:example-build
```

The agent tests cover compiler/catalog behavior, chunk boundaries, snapshot updates, graph validation, target routing, and run-event handling without live Gemini calls. For a browser check, exercise both formats with a bound calculator, a function button, a submitted form, and a report. Also check persistence, thread reset on format change, the disabled picker during a run, and existing title/icon/history behavior. These checks do not establish protocol-wide conformance or comparative latency.

Live Express checks on **2026-10-24** exercised a `calc` data binding, `saveNote`, a form event carrying context, the report target, and JSON source views. A live JSON run with the published dependency baseline also completed the ticket calculator: three $12 tickets showed $36, changing the quantity to five showed $60, and `saveNote` saved the updated quantity and total. Live form and report coverage here applies to Express only.

### Files

| Path                                   | What it does                                                    |
| -------------------------------------- | --------------------------------------------------------------- |
| `src/components/Desk.tsx`              | Provider, generative UI config, layout                          |
| `src/components/SurfaceFrame.tsx`      | Each generated view, with its A2UI button and decompile         |
| `src/components/SourcePlate.tsx`       | The A2UI plate under a view                                     |
| `src/components/A2UISource.tsx`        | The A2UI as a folding tree                                      |
| `src/lib/decompile.tsx`                | The pixelate transition between a view and its A2UI             |
| `src/components/ReportPanel.tsx`       | The report sheet (a named `GenerativeUISurface`)                |
| `src/components/Composer.tsx`          | The chat input: model and format pickers, + menu, send          |
| `src/components/UIFormatPicker.tsx`    | JSON/Express selection and running-state availability           |
| `src/lib/ui-format.ts`                 | Allowed formats and the JSON default                            |
| `src/components/Welcome.tsx`           | Welcome screen and the starter carousel slot                    |
| `src/components/ThreadDrawer.tsx`      | Threads grouped by day, icons, archive, Catalog and Notes tabs  |
| `src/components/CatalogPage.tsx`       | The catalog gallery, in a provider of its own                   |
| `src/lib/catalog.ts`                   | One A2UI specimen per component, in the catalog's groups        |
| `src/lib/generative-ui.ts`             | `deskUI` (standard catalog + functions) and the Solarized theme |
| `src/lib/use-desk-functions.ts`        | Handlers for generated buttons                                  |
| `src/lib/view-catalog.ts`              | The views the + menu offers                                     |
| `src/server/runtime.ts`                | `CopilotRuntime` with the ADK agent and Intelligence            |
| `agent/src/research_desk/agent.py`     | ADK agent, model selection, icon pick, thread-naming shortcut   |
| `agent/src/research_desk/fences.py`    | Repairs and streams A2UI fence lines                            |
| `agent/src/research_desk/express.py`   | Browser-catalog adaptation, SDK compilation and validation      |
| `agent/src/research_desk/transport.py` | Express fences, snapshot diffs, target and event preservation   |
| `agent/src/research_desk/prompt.py`    | Shared research policy with format-specific syntax guidance     |
| `agent/src/research_desk/research.py`  | Grounded `web_research`                                         |
| `agent/src/research_desk/images.py`    | `find_images` on Wikimedia Commons                              |
| `PRODUCT.md`, `DESIGN.md`              | Product and design context for design work                      |

### Notes

- `identifyUser` returns a fixed demo user. Replace it with your app's verified session before deploying anywhere shared.
- The ADK agent keeps its own sessions in memory; Intelligence holds the durable thread. After an agent restart, ag-ui-adk seeds a new session from the thread history.
- Intelligence names new threads by running this same agent with a system prompt of its own and no `forwardedProps`. The app always forwards the picked model, so the agent recognizes the naming run and answers it with Flash-Lite instead of the research loop.
