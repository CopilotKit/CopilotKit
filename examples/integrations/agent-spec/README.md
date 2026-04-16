# CopilotKit <> Agent Spec Starter

This is a starter template for building AI agents using Agent Spec and CopilotKit. It provides a modern Next.js application wired to a FastAPI backend that serves an Agent Spec agent with A2UI-powered frontend tool rendering (calendar, inbox, email compose, daily brief dashboard).

![Demo](demo.gif)

## Prerequisites

- OpenAI-compatible API key (for the Agent Spec LLM)
- Python 3.10+
- uv
- Node.js 20+
- Any of the following package managers:
  - npm (default)
  - [pnpm](https://pnpm.io/installation)
  - [yarn](https://classic.yarnpkg.com/lang/en/docs/install/)
  - [bun](https://bun.sh/)

## Getting Started

Before installing, please clone the [AG-UI repository](https://github.com/ag-ui-protocol/ag-ui) into the same directory as this repo, `with-agent-spec`.

1. Install dependencies using your preferred package manager:

```bash
# Using npm (default)
npm install

# Using pnpm
pnpm install

# Using yarn
yarn install

# Using bun
bun install
```

> Note: This automatically sets up the Python environment for the agent (via `postinstall`). If you encounter issues, you can run:
>
> ```bash
> npm run install:agent
> ```

Note: this install both LangGraph and WayFlow runtimes for running your Agent Spec agents. The runtime can be selected when loading the agent in `main.py`, setting either `langgraph` or `wayflow`.

2. (Optional) Set up your LLM environment variables:

Create a `.env` file inside the `agent` folder if you need to override defaults:

```
OPENAI_API_KEY=sk-...your-api-key...
OPENAI_BASE_URL=https://api.your-provider.com/v1   # optional
OPENAI_MODEL=gpt-5.2                               # optional
```

The backend loads this `.env` automatically (via `python-dotenv`). You can also set:

- `PORT` to change the FastAPI server port (defaults to `8000` in this template)
- Any provider-specific variables your tools require

3. Start the development servers:

```bash
# Using npm (default)
npm run dev

# Using pnpm
pnpm dev

# Using yarn
yarn dev

# Using bun
bun run dev
```

This starts both the UI and the agent concurrently. The agent runs at `http://localhost:8000/`, and the UI runs at `http://localhost:3000`. The UI proxies requests to the agent (no extra env required by default).

To run only the UI or only the backend:

```bash
# Only UI
npm run dev:ui

# Only backend
npm run dev:agent
```

## Project Structure

- `src/app/page.tsx` - Main chat UI with frontend tool renderers (calendar, inbox, email, daily brief)
- `src/components/` - React components for CalendarView, InboxView, EmailComposeView
- `src/app/theme.ts` - A2UI theme configuration
- `agent/src/a2ui_agentspec_agent.py` - Agent spec definition with system prompt, tools, and demo data
- `agent/src/main.py` - FastAPI server entry point

## Available Scripts

You can run these with any package manager:

- `dev` - Starts both UI and agent servers in development mode
- `dev:debug` - Starts development servers with debug logging enabled
- `dev:ui` - Starts only the Next.js UI server
- `dev:agent` - Starts only the Agent Spec FastAPI server
- `build` - Builds the Next.js application for production
- `start` - Starts the production server
- `install:agent` - Installs Python dependencies for the agent

## Documentation

- CopilotKit Documentation: https://docs.copilotkit.ai
- Next.js Documentation: https://nextjs.org/docs

## Contributing

Feel free to submit issues and enhancement requests! This starter is designed to be easily extensible.

## License

This project is licensed under the MIT License - see the LICENSE file for details.

## Troubleshooting

### A2UI surfaces clipped (temporary workaround)

If A2UI cards (e.g. those with bottom action buttons) get clipped in the chat UI, we keep a temporary patch under:

- `src/app/patches/@copilotkit/a2ui-renderer/dist/A2UIMessageRenderer.js`

To apply it locally (this edits `node_modules` and will be overwritten by reinstalling dependencies):

```bash
npm run patch:ui
```

After copying, restart `npm run dev`.

### Custom message key warning (temporary workaround)

If you see React warnings about duplicate keys related to custom message rendering (keys like `${message.id}-custom-before` / `${message.id}-custom-after`), we keep a temporary patch under:

- `src/app/patches/@copilotkit/react-core/dist/index.mjs`

To apply it locally (this edits `node_modules` and will be overwritten by reinstalling dependencies):

```bash
npm run patch:ui
```

After copying, restart `npm run dev`.

### Agent Connection Issues

If you see "I'm having trouble connecting to my tools", make sure:

1. The Agent Spec backend is running on port 8000
2. The UI started successfully on port 3000
3. If using a custom backend URL, set `NEXT_PUBLIC_COPILOTKIT_SERVER_URL`

### Python Dependencies

If you encounter Python import errors:

```bash
cd agent
uv sync
uv run src/main.py
```
