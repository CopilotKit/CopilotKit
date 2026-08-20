# CopilotKit <> Angular + ADK Starter

This is a starter template for building AI agents using Google's [ADK](https://google.github.io/adk-docs/) and [CopilotKit](https://copilotkit.ai), with an **Angular** frontend. It pairs an Angular SPA with a standalone Node [Copilot Runtime](https://docs.copilotkit.ai) and a Python ADK agent — demonstrating shared agent state, generative UI, frontend tools, suggestions, and (optionally) a managed threads drawer.

## Architecture

Three processes run behind a single `npm run dev` (via `concurrently`):

| Process   | Port   | What it is                                                                    |
| --------- | ------ | ----------------------------------------------------------------------------- |
| `ui`      | `4200` | The Angular app (`ng serve`)                                                  |
| `runtime` | `8200` | The standalone Copilot Runtime (`tsx server.ts`), served at `/api/copilotkit` |
| `agent`   | `8000` | The Python ADK agent (`uv`)                                                   |

The Angular app talks to the runtime (`http://localhost:8200/api/copilotkit`), and the runtime proxies the ADK agent (`AGENT_URL`, default `http://localhost:8000/`).

## Prerequisites

- Node.js 20.19+ (required by the Angular 21 toolchain; the managed-Intelligence path below needs ≥ 22)
- Python 3.12+
- [`uv`](https://docs.astral.sh/uv/getting-started/installation/) (installs the Python agent's dependencies)
- Google Makersuite API Key (for the ADK agent) — see https://makersuite.google.com/app/apikey

## Getting Started

1. Install dependencies. This also provisions the Python agent's virtual environment via `uv` (a `postinstall` step):

   ```bash
   npm install
   ```

   > **Note:** This creates a `.venv` inside the `agent` directory. To activate it manually:
   >
   > ```bash
   > source agent/.venv/bin/activate
   > ```

2. Configure your environment. Copy `.env.example` to `.env` and set your Google API key:

   ```bash
   cp .env.example .env
   # then edit .env and set GOOGLE_API_KEY=...
   ```

3. Start the full dev stack (UI + runtime + agent):

   ```bash
   npm run dev
   ```

   Then open http://localhost:4200.

## Available Scripts

- `dev` — Starts the UI, runtime, and agent concurrently
- `dev:debug` — Same as `dev` with `LOG_LEVEL=debug`
- `dev:ui` — Starts only the Angular UI (`ng serve`)
- `dev:runtime` — Starts only the Copilot Runtime (`tsx server.ts`)
- `dev:agent` — Starts only the Python ADK agent
- `build` — Builds the Angular application for production (`ng build`)
- `start` — Serves the Angular app (`ng serve`)
- `install:agent` — Installs the Python agent's dependencies via `uv`

## What's in here

- `src/app/app.ts` — the three-column layout (threads drawer / themed main panel / chat) and the `setThemeColor` frontend tool.
- `src/app/app.config.ts` — `provideCopilotKit` wiring: the runtime URL, the `get_weather` generative-UI renderer, and the static suggestions.
- `src/app/proverbs.ts` — shared agent state (`injectAgentStore`), read and written from the UI.
- `src/app/main-content.ts` — the themed center panel that hosts the proverbs card.
- `src/app/agent-state.ts` — the shared `AgentState` type.
- `src/app/weather-card.ts` — the generative-UI card rendered when the agent calls `get_weather`.
- `src/app/web-inspector.ts` — dev aid: mounts the CopilotKit web inspector (`cpk-web-inspector`) for watching AG-UI events, agent state, and runtime connectivity. Safe to delete for production.
- `server.ts` — the standalone Copilot Runtime, registering the `default` agent (with env-gated managed Intelligence).
- `scripts/` — cross-platform launchers used by the `dev`/`install` npm scripts to set up and run the Python agent.
- `agent/` — the Python ADK agent (unchanged from the React ADK example).

## Threads & managed Intelligence (optional)

The threads drawer and persistent conversation memory are powered by **CopilotKit Intelligence**. They are **off by default** — the drawer renders a locked "Upgrade" state until you enable Intelligence.

To enable them, set `COPILOTKIT_LICENSE_TOKEN` (and the Intelligence endpoint vars) in `.env`. See the commented block in `.env.example`:

```bash
COPILOTKIT_LICENSE_TOKEN=
INTELLIGENCE_API_URL=http://localhost:4201
INTELLIGENCE_GATEWAY_WS_URL=ws://localhost:4401
INTELLIGENCE_API_KEY=
```

Run `copilotkit license` to provision a license. When `COPILOTKIT_LICENSE_TOKEN` is set, `server.ts` wires `CopilotKitIntelligence` (threads + memory); otherwise it falls back to an in-memory runner and the drawer stays locked.

> **Notes for the Intelligence path:**
>
> - The managed-Intelligence path requires **Node.js ≥ 22** (the base UI + runtime run on Node 20+).
> - `server.ts` ships a demo `identifyUser` stub returning `demo-user`. The Intelligence platform requires the identified user to actually exist, so thread persistence needs a **real, provisioned user id** — replace the stub with your auth-derived identity (the `copilotkit` CLI provisions one when it scaffolds a project). Leaving `demo-user` in place can cause thread operations to fail.
> - Set `INTELLIGENCE_API_KEY` whenever you set `COPILOTKIT_LICENSE_TOKEN`. The runtime builds `CopilotKitIntelligence` off the license token alone; if the API key is missing, threads/memory fail with an opaque auth error at request time rather than a clear startup error.

## 📚 Documentation

- [ADK Documentation](https://google.github.io/adk-docs/) — Learn more about the ADK and its features
- [CopilotKit Documentation](https://docs.copilotkit.ai) — Explore CopilotKit's capabilities
- [Angular Documentation](https://angular.dev) — Learn about Angular

## License

This project is licensed under the MIT License — see the LICENSE file for details.

## Troubleshooting

### Agent Connection Issues

If the chat reports trouble connecting, make sure:

1. The ADK agent is running on port `8000`.
2. Your `GOOGLE_API_KEY` is set correctly in `.env`.
3. The runtime is listening on port `8200` (check for the "Copilot Runtime listening at ..." log line).

### Python Dependencies

If the agent fails to start, re-provision its environment:

```bash
npm run install:agent
```
