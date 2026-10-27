# A2UI Playground, powered by CopilotKit

A calm research desk. A Google ADK agent on Gemini answers open questions in prose, and when a view would carry the answer better (a trend, a comparison, pictures of the subject, a set of sources) it renders one from CopilotKit's standard A2UI catalog. Press the **A2UI** button on any view to decompile it into the A2UI the agent wrote, and again to compile it back.

What it shows:

- **Native generative UI** (`@copilotkit/react-core/v2/generative-ui`): `createGenerativeUI` extending `standardUI`, the standard catalog unchanged, themed in Solarized through the `--a2ui-*` variables.
- **Natural rendering.** The system prompt describes how to research and present, and says a view is always optional; it never asks for a component. Ask "how has climate change affected us over time?" and the agent decides a chart helps.
- **Markdown transport, streamed component by component.** The agent writes A2UI operations in ` ```a2ui ` fences inside its reply. Each component reaches the browser as soon as its JSON closes, so a view builds up while the model writes. (See "Why markdown transport" below.)
- **App functions behind generated buttons**: `saveNote`, `openSource`, `askFollowUp`, `copyText`, `exportCsv` (`src/lib/generative-ui.ts`, handlers in `src/lib/use-desk-functions.ts`).
- **Decompile** (`src/components/SurfaceFrame.tsx`): every generated view sits over the A2UI that made it. The A2UI button pixelates the view into its source and back. The source opens folded to one line per operation.
- **A report sheet** (`src/components/ReportPanel.tsx`): ask for a report or briefing and the agent writes it into a named `GenerativeUISurface` beside the chat, live.
- **Pictures**: a `find_images` tool searches Wikimedia Commons for freely licensed pictures with credits, shown in `Image` and `ImageGrid` views.
- **A catalog of every component** (`src/components/CatalogPage.tsx`, `src/lib/catalog.ts`): the drawer's **Catalog** tab shows the standard catalog's components in its seven groups (layout, text, inputs, feedback, data, media, composites). Each specimen is A2UI rendered by the same renderer as the agent's views, with an **A2UI** button to read it and an info button with what the agent is told about the component. `?catalog` links straight to it.
- **Light and dark**: Solarized light or dark, following the system setting. The app's tokens switch on `prefers-color-scheme`, and `.dark` on `<html>` brings the CopilotKit chat and the catalog's own dark values along.
- **The composer's + menu**: attach a picture (or drop one anywhere on the chat), or pick a view from a catalog (Chart, Table, Calculator, Form, Pictures, Map, Report) to answer the next question with.
- **Works signed out, sign in to keep it** (Clerk): anyone can use the desk without an account; nothing is kept. Signing in (Clerk, on a sign-in page in the desk's own materials) is how a reader keeps threads and connects apps. The runtime route serves two runtimes: signed in, Intelligence keeps threads per reader (`identifyUser` returns the Clerk user); signed out (the default), the same agent with nothing kept (`src/server/runtime.ts`).
- **Actions in the reader's Google apps** (Composio): on the **Connections** page a reader connects Gmail, Calendar, Drive, Docs or Sheets through Google's own sign-in. The agent then gets those apps' tools on each run (`agent/src/research_desk/actions.py`). Anything that sends, creates, changes or deletes pauses for the reader: ADK's tool confirmation reaches the chat as an AG-UI interrupt, and `useInterrupt` shows exactly what will happen with a Confirm button (`src/components/ActionConfirmation.tsx`).
- **Intelligence threads** with a thread drawer. On a thread's first run the agent picks an icon for it (a fast Flash-Lite call) and sends it as thread state, which Intelligence keeps.
- **Model picker**: Gemini 3.8 Flash (default), Gemini 4 Argon, Gemini 3.1 Pro. The choice rides in `forwardedProps.model` on each run; the agent applies it in `before_model_callback`.
- **Grounded research**: a `web_research` tool runs Gemini with Google Search grounding and returns real source links, shown with their favicons under the question.

## Run it

This example uses the workspace packages from the native generative UI branch (PR #7819), so run it from the monorepo.

```bash
# 1. From the repo root: install and build the CopilotKit packages
pnpm install
pnpm nx run-many -t build -p @copilotkit/react-core @copilotkit/runtime

# 2. Keys
cd examples/showcases/a2ui
cp .env.example .env   # add GEMINI_API_KEY, CPK_INTELLIGENCE_API_KEY, the Clerk keys and COMPOSIO_API_KEY

# 3. The agent (Python 3.12+, uv)
pnpm install:agent
pnpm dev:agent          # serves AG-UI on http://localhost:8014

# 4. The app, in a second terminal
pnpm example-dev        # http://localhost:3014
```

- **Clerk:** create an application at https://dashboard.clerk.com and copy its publishable and secret keys into `VITE_CLERK_PUBLISHABLE_KEY` and `CLERK_SECRET_KEY` (use the copy buttons; the text shown is masked). Sign-in lives at `/sign-in` and `/sign-up`.
- **Composio:** create a project at https://platform.composio.dev and copy its API key into `COMPOSIO_API_KEY`. Composio's managed Google sign-in needs no Google OAuth app of your own (the consent screen says Composio; add your own OAuth app under Auth Configs to change that). Without the key, Connections is off and the agent only researches.

`CPK_INTELLIGENCE_API_KEY` comes from `npx copilotkit@latest login` then `npx copilotkit@latest project select` (it writes the key into `.env`).

Useful URLs:

- `http://localhost:3014/?thread=<id>` opens a thread directly (the address bar follows the open thread, so prepared threads can be bookmarked).
- `http://localhost:3014/?catalog` opens the component catalog, and `?connections` the reader's connected apps.
- `http://localhost:3014/?inspector` turns on the CopilotKit Inspector, whose Generative UI pane shows surfaces, the catalog, and the prompt.

## A demo in five minutes

The starters on the welcome screen are the script. None of them names a component; the agent decides what to draw.

1. **Living longer** ("How has life expectancy changed across continents over the last century?"). The agent researches (sources appear under the question), answers in a few sentences, and a line chart builds up component by component. The thread gets a title and an icon in the drawer. Press the **A2UI** button: the chart pixelates into the operations the agent wrote (`createSurface`, `updateComponents`, the data model). Press it again to compile it back. Click **Save** in the view: the app's `saveNote` handler runs and the note lands in **Notes** at the foot of the drawer.
2. **My commute** ("Help me estimate my commute's yearly CO2…"). The agent builds an estimator: sliders for distance and days, live results computed in the view with `calc`. Drag a slider; the numbers change with no call to the agent. Decompile to show the `@path` bindings and `calc` calls behind them.
3. **Choosing a program**. The agent needs facts only you have, so it asks with a form. Submit it; the values go back to the agent as a message, and it answers with a researched comparison.
4. **The Aral Sea** for pictures from Commons beside a chart, and **Brief me on fusion** for a report written live into the sheet beside the chat.
5. From the composer's **+**, pick **Table** and ask anything: the agent answers with a table. Switch the model and ask again. Open an older thread from the drawer: its history and views come back from Intelligence.

## How it fits together

```
Browser (TanStack Start, React 19)
  CopilotKitProvider generativeUI={{ ui: deskUI, theme, transport: "markdown" }}
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
  FenceRepairer: repairs and streams each A2UI component as it closes
```

### Why markdown transport

The tool transport (`render_ui`) asks the model to put the whole A2UI tree into function-call arguments. In our runs Gemini garbled large nested objects there: missing `version`, dropped `component` keys, even escaped key names like `"\"surfaceId\""`. As plain JSON lines in its reply, the same model writes valid operations.

Gemini still slips in small ways (a missing brace, props nested under `props`, a root `Card` inside the app's own frame), so `agent/src/research_desk/fences.py` repairs each line on the way out. It also streams: Gemini often writes a whole view on one line, so the repairer sends each component as soon as its object closes rather than holding the line until it ends.

### Files

| Path                                    | What it does                                                     |
| --------------------------------------- | ---------------------------------------------------------------- |
| `src/components/Desk.tsx`               | Provider, generative UI config, layout                           |
| `src/components/SurfaceFrame.tsx`       | Each generated view, with its A2UI button and decompile          |
| `src/components/SourcePlate.tsx`        | The A2UI plate under a view                                      |
| `src/components/A2UISource.tsx`         | The A2UI as a folding tree                                       |
| `src/lib/decompile.tsx`                 | The pixelate transition between a view and its A2UI              |
| `src/components/ReportPanel.tsx`        | The report sheet (a named `GenerativeUISurface`)                 |
| `src/components/Composer.tsx`           | The chat input: model picker, + menu, send                       |
| `src/components/Welcome.tsx`            | Welcome screen and the starter carousel slot                     |
| `src/components/ThreadDrawer.tsx`       | Threads grouped by day, icons, archive, Catalog and Notes tabs   |
| `src/components/CatalogPage.tsx`        | The catalog gallery, in a provider of its own                    |
| `src/lib/catalog.ts`                    | One A2UI specimen per component, in the catalog's groups         |
| `src/lib/generative-ui.ts`              | `deskUI` (standard catalog + functions) and the Solarized theme  |
| `src/lib/use-desk-functions.ts`         | Handlers for generated buttons                                   |
| `src/lib/view-catalog.ts`               | The views the + menu offers                                      |
| `src/server/runtime.ts`                 | `CopilotRuntime` with the ADK agent, Intelligence and the reader |
| `src/server/connections.ts`             | The reader's Google apps through Composio                        |
| `src/components/ConnectionsPage.tsx`    | Connect and disconnect Google apps                               |
| `src/components/ActionConfirmation.tsx` | The confirm card for actions in the reader's apps                |
| `agent/src/research_desk/actions.py`    | The connected apps' tools, per reader, with confirmation         |
| `agent/src/research_desk/identity.py`   | Who the agent works for on a run                                 |
| `agent/src/research_desk/agent.py`      | ADK agent, model selection, icon pick, thread-naming shortcut    |
| `agent/src/research_desk/fences.py`     | Repairs and streams A2UI fence lines                             |
| `agent/src/research_desk/prompt.py`     | The system prompt                                                |
| `agent/src/research_desk/research.py`   | Grounded `web_research`                                          |
| `agent/src/research_desk/images.py`     | `find_images` on Wikimedia Commons                               |
| `PRODUCT.md`, `DESIGN.md`               | Product and design context for design work                       |

### Notes

- The runtime names the signed-in reader to the agent in a header, and the agent trusts that header over anything in the run's state (`agent/src/research_desk/identity.py`). Keep the agent private to the app's server, or set `AGENT_SHARED_SECRET` so it ignores callers without the runtime's secret.
- The ADK agent keeps its own sessions in memory; Intelligence holds the durable thread. After an agent restart, ag-ui-adk seeds a new session from the thread history.
- Intelligence names new threads by running this same agent with a system prompt of its own and no `forwardedProps`. The app always forwards the picked model, so the agent recognizes the naming run and answers it with Flash-Lite instead of the research loop.
