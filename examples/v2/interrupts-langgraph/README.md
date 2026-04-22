# CopilotKit <> LangGraph Starter

This is a starter template for building AI agents using [LangGraph](https://www.langchain.com/langgraph) and [CopilotKit](https://copilotkit.ai). It provides a modern Next.js application with an integrated LangGraph agent to be built on top of.

This project is organized as a monorepo using [pnpm workspaces](https://pnpm.io/workspaces).

## Project Structure

```
.
├── apps/
│   ├── web/          # Next.js frontend application
│   └── agent/        # LangGraph agent
└── package.json      # pnpm workspaces via pnpm-workspace.yaml
```

## Prerequisites

- Node.js 20+
- [pnpm](https://pnpm.io/installation) 9.15.0 or later
- OpenAI API Key (for the LangGraph agent)

## Getting Started

1. Install all dependencies (this installs everything for both apps):

```bash
pnpm install
```

2. Set up your OpenAI API key by copying the example env file and editing it:

```bash
cp apps/agent/.env.example apps/agent/.env
```

Then open `apps/agent/.env` in your editor and fill in `OPENAI_API_KEY` with your key.

For production, also copy `apps/web/.env.example` to `apps/web/.env` and set `LANGGRAPH_DEPLOYMENT_URL` to your deployed agent URL.

3. Start the development servers:

```bash
pnpm dev
```

This will start both the Next.js app (on port 3000) and the LangGraph agent (on port 8125) via Turbo (installed as a dev dependency).

## Available Scripts

All scripts use Turbo to run tasks across the workspace:

- `pnpm dev` - Starts both the web app and agent servers in development mode
- `pnpm build` - Builds all apps for production
- `pnpm lint` - Runs linting across all apps

### Running Scripts for Individual Apps

You can also run scripts for individual apps using pnpm's filter flag:

```bash
# Run dev for just the web app
pnpm --filter web-langgraph-interrupt dev

# Run dev for just the agent
pnpm --filter agent-langgraph-interrupt dev

# Or navigate to the app directory
cd apps/web
pnpm dev
```

## Customization

The main UI component is in `apps/web/src/app/page.tsx`. You can:

- Modify the theme colors and styling
- Add new frontend actions
- Utilize shared-state
- Customize your user-interface for interacting with LangGraph

The LangGraph agent code is in `apps/agent/src/`.

## 📚 Documentation

- [CopilotKit Documentation](https://docs.copilotkit.ai) - Explore CopilotKit's capabilities
- [LangGraph Documentation](https://langchain-ai.github.io/langgraph/) - Learn more about LangGraph and its features
- [Next.js Documentation](https://nextjs.org/docs) - Learn about Next.js features and API

## Contributing

Feel free to submit issues and enhancement requests! This starter is designed to be easily extensible.

## License

This project is licensed under the MIT License - see the LICENSE file for details.

## Troubleshooting

### Agent Connection Issues

**If the chat returns an "Internal error while dispatching CopilotKit request" 500:**
Check the Next.js server logs for `[copilotkit/route] runtime construction failed:` or `[copilotkit/route] handleRequest dispatch failed:`. Common causes:

- `LANGGRAPH_DEPLOYMENT_URL` unset in production (required — check `apps/web/.env`)
- LangGraph server not running at the configured URL (check `pnpm --filter agent-langgraph-interrupt dev` started cleanly)
- `OPENAI_API_KEY` missing from `apps/agent/.env`
