# A2UI Playground

Watch an agent write UI. Ask for anything ("Q3 sales by region as a dashboard", "compare three noise-cancelling headphones", "a signup form with a plan choice") and the answer arrives in the chat as real, interactive UI: an **A2UI 1.0** surface rendered by **CopilotKit Gen UI 2.0**. Beside the chat you see the **A2UI Express** the model writes, one line per component, and hovering a line lights up the component it made.

A hosted version runs at https://web-production-d0431.up.railway.app.

## What it shows

- **A2UI 1.0 on CopilotKit Gen UI 2.0.** Every operation is `{ "version": "v1.0", ... }`, streamed over AG-UI as `generative-ui-surface` activities and rendered with `@copilotkit/react-core` 1.83.
- **A2UI Express by default.** The model writes one line per component and Google's `@a2ui/agent` SDK compiles it, usually about half the size of the same UI in JSON. JSON is the alternative. Express that still fails to compile after a retry is rewritten as JSON on the same surface.
- **Any model.** Gemini Flash (`gemini-flash-latest`) is the default; Gemma 4 runs locally through Ollama (or any OpenAI-compatible server); GPT is in the picker too.
- **A real catalog.** The 69 Gen UI 2.0 standard components, 52 of the playground's own (shadcn/ui, TanStack Charts, MapLibre) and 3 macros, `FlightCard`, `ProductCard` and `WeatherReport`, that the server expands into standard components.
- **Chat first, with the code beside it.** Each prompt shows its UI inline as it paints. The side pane shows the selected surface's Express (or JSON) lines as they are written, the JSON with an editor (live preview, no model; then "Ask the model to change this"), and the run's timings.
- **Take it home.** `/components` documents every component, `/skills` builds and exports an agent skill for a chosen set of components, `/evals` shows per-model scores (`pnpm evals`), `/start` is the quick start, and `examples/adk` is a Google ADK agent on the same catalog.

## Run it

Requires Node 22+, pnpm 10, and a key for at least one model: `GEMINI_API_KEY` (Gemini Flash, the default), `OPENAI_API_KEY` (GPT), or Gemma 4 through a local Ollama (`ollama pull gemma4:e4b`, no key).

```bash
pnpm install
cp .env.example .env.local      # then set GEMINI_API_KEY (and/or OPENAI_API_KEY)
pnpm dev                        # http://localhost:3100
```

Production: `pnpm build && pnpm start` (`PORT`, default 3100).

```bash
pnpm catalog:export      # src/a2ui/export/{catalog,inference-catalog}.json (runs before dev and build)
pnpm skills:export       # skills/generated/{express,json}: the skills /skills serves
pnpm evals               # per-model scores -> src/data/evals.json, shown at /evals
pnpm evals --models gemini --formats express --tasks sales-dashboard,flights --out /tmp/evals.json
pnpm evals --skill path/to/skill.zip --formats json   # score a skill exported from /skills
node scripts/record-replay.mjs dynamic "<prompt>"     # re-record the first-visit replay (dev server running)
```

## How it works

1. **The browser sends its catalog.** `src/a2ui/catalog/catalog.ts` builds it with `createGenerativeUI({ id, extends: [standardUI], components })`, and every run carries it in the generative UI envelope.
2. **The agent picks a path** (`src/agent/agent.ts`): a pre-built template filled with real data (Open-Meteo, OpenStreetMap, OSRM, Frankfurter), or `generate_a2ui`, which hands a brief to a composer sub-agent.
3. **The composer writes the surface** in Express (`src/agent/compose-express.ts`) or JSON (`src/agent/composer.ts`). Each finished line is compiled and sent at once, so the UI paints while the model is still writing; components it has named but not finished show as dotted frames.
4. **Macros expand on the server** (`src/a2ui/macros/`), and map markers are geocoded by name.
5. **CopilotKit validates and renders** every operation in the browser with your components. A click on a surface goes back to the agent as an A2UI action, and a follow-up updates the surface in place.

## Hosting

The public site is one Railway service running `pnpm start` behind Railway's proxy. Every prompt spends the server's model keys, so a production build carries limits.

Set on Railway:

| Variable                             |                                                                                                                                                       |
| ------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GEMINI_API_KEY`                     | Required. Gemini Flash, the default model.                                                                                                            |
| `OPENAI_API_KEY`                     | Optional. Turns on GPT in the model picker.                                                                                                           |
| `COPILOTKIT_TELEMETRY_DISABLED=true` | Optional. Turns off the CopilotKit runtime's usage telemetry.                                                                                         |
| `DISABLED_MODELS`                    | Optional. Comma-separated model ids (`gpt`, `gemma`) to show as unavailable without removing their keys, e.g. while a provider account has no credit. |
| `AGENT_RUNS_PER_10_MIN`              | Optional. The per-visitor run limit (default 12).                                                                                                     |

Leave every `GEMMA_*` unset: Gemma on the shared Gemini key runs into its per-minute token limit, and without `GEMMA_BASE_URL` the picker tells visitors to run Gemma locally. Leave `ENABLE_MINIMAL`, `ENABLE_JEV`, `ENABLE_ADK` and `ENABLE_SNAPSHOT` unset too: in production `/minimal`, `/jev*`, `/adk`, `/snapshot` and their API routes answer 404 unless the matching one is `1` (`src/proxy.ts`).

The limits are constants in `src/lib/limits.ts`:

| What                                                                                       | Limit                                                                                            |
| ------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------ |
| Agent runs per IP (`/api/copilotkit` run and suggest requests, and the opt-in demo routes) | a burst of 6, then 12 per 10 minutes (`AGENT_RUNS_PER_10_MIN`)                                   |
| Agent runs, all visitors together                                                          | a burst of 60, then 300 per hour                                                                 |
| `/api/express`, `/api/skills` per IP                                                       | a burst of 30, then 60 per minute                                                                |
| `/api/models` per IP                                                                       | a burst of 10, then 30 per minute                                                                |
| Request body                                                                               | agent 1 MB, express 512 KB, skills 64 KB                                                         |
| What the agent reads of a chat                                                             | the newest 40 messages, 4,000 characters per user message or tool call, 60,000 characters in all |
| Lookups one prompt starts                                                                  | 4 data calls per run; 12 geocoded map pins and 6 macros per surface                              |
| `/api/express`                                                                             | 1,000 components per request                                                                     |
| The catalog the browser sends                                                              | 80,000 characters once it is a prompt (the real one is about 26,000)                             |
| Model output per call                                                                      | router 4,096 tokens, composer 16,384 tokens                                                      |

A refused request gets a 429 (with `Retry-After`) or a 413, with a short message the chat shows, such as "You're sending a lot of requests. Try again in a minute." The page's startup calls (`info`, `connect`) and requests that can't start a run are not counted. The IP is the first `X-Forwarded-For` address, else `X-Real-IP`. The counts are kept in memory: right for one instance, but each extra replica counts on its own, and a redeploy resets them. Listing and clearing threads answers 403, since the runtime has no `identifyUser`.

These limits slow a visitor down; they are not a budget. Set a spend cap on each provider key in its own dashboard (the Google Cloud billing account behind the Gemini key, the OpenAI project's budget), and use keys made for this deploy so either can be revoked alone.

## Use it in your app

The same setup in your own app, in three files (the page at `/start` walks through it). Install the versions this repo runs:

```bash
npm i @copilotkit/react-core@1.83.0 @copilotkit/runtime@1.83.0 zod@3.25.76
```

1. **Catalog** (`app/genui.tsx`): `createGenerativeUI({ id, extends: [standardUI], components: { WeatherCard: { component: WeatherCard, description, props: z.object({ ... }) } } })` from `@copilotkit/react-core/v2/generative-ui`. The agent can use only what the catalog defines.
2. **Provider** (`app/page.tsx`): `<CopilotKitProvider runtimeUrl="/api/copilotkit" generativeUI={{ ui }}><CopilotChat /></CopilotKitProvider>` from `@copilotkit/react-core/v2`. The catalog goes out with every run.
3. **Runtime route** (`app/api/copilotkit/[[...slug]]/route.ts`): a `CopilotRuntime` with any agent (`new BuiltInAgent({ model: "google/gemini-flash-latest" })` with `GOOGLE_API_KEY` is the shortest), served by `createCopilotRuntimeHandler`. Because the browser sends a catalog, the runtime adds the `render_ui` tool and the catalog guide to the agent's run and validates every A2UI operation it sends back. `/minimal` is this setup.

**Bring your own agent: Google ADK.** `examples/adk` is a plain ADK `LlmAgent` on Gemini Flash (`ADK_MODEL`, default `gemini-3.5-flash`), served over AG-UI with `ag-ui-adk`, with no A2UI code. `src/app/api/adk/[[...slug]]/route.ts` fronts it with `HttpAgent` from `@ag-ui/client` (`ADK_AGENT_URL`, default `http://localhost:8000/`), and `/adk` is the chat page. The runtime's generative UI middleware applies to any AG-UI agent it fronts, not only `BuiltInAgent`; `AGUIToolset()` exposes `render_ui` to the model and the agent's instruction provider appends the catalog guide (AG-UI context) to its prompt.

```bash
cd examples/adk && uv sync
export GOOGLE_API_KEY=your-key
uv run server.py                 # http://localhost:8000/
pnpm dev                         # from the repo root, then open http://localhost:3100/adk
```

**Any renderer, any agent.** `/catalog.json` serves the catalog as an A2UI v1.0 catalog document (from `exportA2UICatalog`), for renderers outside React and for validators; `/skills` serves agent skills generated from the same catalog.

## Layout

| Path                         | What it holds                                                                       |
| ---------------------------- | ----------------------------------------------------------------------------------- |
| `src/agent/`                 | The agent: router, composers (Express and JSON), models, surfaces, templates, tools |
| `src/a2ui/catalog/`          | Definitions (Zod), renderers and samples of the playground's components             |
| `src/a2ui/macros/`           | The three macros and their samples                                                  |
| `src/components/playground/` | The chat, composer, lines pane and the JSON editor                                  |
| `src/app/`                   | Pages (`/`, `/components`, `/skills`, `/evals`, `/start`, `/watch`) and API routes  |
| `skills/`                    | The catalog skill and the generated agent skills                                    |
| `examples/adk/`              | A Google ADK agent served over AG-UI                                                |
| `scripts/`                   | Catalog and skill export, evals, the replay recorder, browser checks                |

## Known limitations

- Express does not always compile on the first try; the composer retries, then rewrites the surface as JSON, which can make a run slower.
- External APIs dominate template latency and vary run to run; the in-memory cache resets with the server.
- Map geocoding follows Nominatim's 1 request per second policy; a marker still unresolved 10 s after the stream ends keeps the model's coordinates.
- The rate limits are counted in memory, so each replica counts on its own.

## Credits

Motion recipes from transitions.dev by Jakub Antalik (https://github.com/Jakubantalik/transitions.dev). Used under its license: free to use, copy and modify in commercial and personal projects; the library itself may not be redistributed as a competing product. The recipes and their notice live in `src/styles/motion.css`.
