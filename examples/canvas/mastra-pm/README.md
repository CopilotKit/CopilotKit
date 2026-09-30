# Project Manager with Mastra

Run a project board whose tasks, team members, name, and description follow a Mastra agent's working memory. The page uses CopilotKit v2 shared state and a theme tool.

![Project board](./assets/preview.png)

## Run locally

Requires Node.js 22.13+, pnpm 10.33.4, and an OpenAI API key. Run these commands from the repository root.

1. Clone and install the workspace:

   ```bash
   git clone https://github.com/CopilotKit/CopilotKit.git
   cd CopilotKit
   corepack enable
   pnpm install --frozen-lockfile
   ```

2. Create the example's environment file:

   ```bash
   cp examples/canvas/mastra-pm/.env.example examples/canvas/mastra-pm/.env
   ```

   Open that `.env` file and set `OPENAI_API_KEY`.

3. Start the app and its workspace dependencies:

   ```bash
   pnpm nx dev @copilotkit-examples/mastra-pm
   ```

4. Open <http://localhost:3000>. Ask the assistant to “Plan a release with three tasks” or “Set the theme color to #008000.” The board shows task assignments in To Do, In Progress, and Done columns.

The Next.js route runs Mastra in the same process; the web app needs no separate agent server or Intelligence connection. `/api/copilotkit/info` exposes agent discovery, and `/api/copilotkit/agent/default/run` streams agent runs. State lives in memory and resets when the server restarts. Each conversation gets its own working-memory resource.

## Optional clients

Run the terminal client from the repository root:

```bash
pnpm nx cli @copilotkit-examples/mastra-pm
```

The CLI uses the same agent definition but starts a separate conversation and in-memory store. It does not share a running web conversation.

## Validate

```bash
pnpm nx show project @copilotkit-examples/mastra-pm
pnpm nx run-many -t test,check-types,lint,build -p @copilotkit-examples/mastra-pm
```

Tests cover runtime discovery and input validation, initial board state, partial or malformed streamed state, hydrated state, and frontend tools. The build uses local system fonts and needs no font downloads.

`src/mastra/` contains the agent and working-memory schema wiring. `src/lib/state.ts` validates streamed records before the board renders them. `snippets/` holds historical workshop steps; those files are not compiled or used by the app.
