# CopilotKit + LangGraph (Python)

A starter template for building AI agents using [LangGraph](https://www.langchain.com/langgraph) (Python) and [CopilotKit](https://copilotkit.ai), with optional **CopilotKit Intelligence** for durable conversation threads.

## Architecture

This project is a monorepo with three services:

| Service                   | Port | Description                                |
| ------------------------- | ---- | ------------------------------------------ |
| **Frontend** (`apps/app`) | 3000 | Vite + React app with CopilotKit chat UI   |
| **BFF** (`apps/bff`)      | 4000 | Hono server running the CopilotKit runtime |
| **Agent** (`apps/agent`)  | 8123 | Python LangGraph agent                     |

When threads are enabled, additional infrastructure runs via Docker Compose:

| Service          | Port       | Description                                                                                                                                       |
| ---------------- | ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| **PostgreSQL**   | 5432       | Thread and event storage                                                                                                                          |
| **Redis**        | 6379       | Session/cache                                                                                                                                     |
| **Intelligence** | 4201, 4401 | All-in-one CopilotKit Intelligence container (app-api on 4201, realtime-gateway on 4401, plus thread-culler and db-migrations, under s6-overlay). |

## Prerequisites

- Node.js 18+
- Python 3.12+
- npm 10+
- OpenAI API Key
- [`uv`](https://docs.astral.sh/uv/getting-started/installation/) — required to install the Python agent's dependencies
- [Docker](https://docs.docker.com/get-started/get-docker/) — required for the threads/intelligence services (must be running)

## Getting Started

1. Install dependencies:

```bash
npm install
```

2. Set up environment variables:

```bash
cp .env.example .env
```

Edit `.env` and add your OpenAI API key.

3. **Get a license key** (if you don't already have one):

```bash
copilotkit license -n my-project
```

This authenticates you and issues a `COPILOTKIT_LICENSE_TOKEN`. Add it to your `.env`.

4. Start all services:

```bash
npm run dev
```

This starts Docker Compose infrastructure first, then starts the frontend, BFF, and agent concurrently.

The infrastructure step pulls `ghcr.io/copilotkit/intelligence/composite` — a single container that runs app-api, realtime-gateway, thread-culler, and the db-migrations oneshot together under s6-overlay supervision. The per-service images remain available at `ghcr.io/copilotkit/intelligence/{app-api,realtime-gateway,thread-culler,db-migrations}` if you'd rather run them separately.

You can also run each piece directly:

```bash
npm run dev:infra
npm run dev:app
npm run dev:bff
npm run dev:agent
```

After infrastructure is already running, use the app, BFF, and agent commands directly when you only need to restart one service.

## Removing Threads

To strip out threads/intelligence and use this as a plain CopilotKit + LangGraph demo:

### Frontend

- **Delete** `apps/app/src/components/threads-drawer/` (the entire directory)
- **Revert `apps/app/src/App.tsx`** to remove the `ThreadsDrawer` component and the thread-aware layout wrapper. The app should go back to:

```tsx
import { CopilotChat, CopilotKitProvider } from "@copilotkit/react-core/v2";
import { ExampleLayout } from "@/components/example-layout";
import { ExampleCanvas } from "@/components/example-canvas";
import { useGenerativeUIExamples, useExampleSuggestions } from "@/hooks";
import { ThemeProvider } from "@/hooks/use-theme";

function HomePage() {
  useGenerativeUIExamples();
  useExampleSuggestions();

  return (
    <ExampleLayout
      chatContent={
        <CopilotChat input={{ disclaimer: () => null, className: "pb-6" }} />
      }
      appContent={<ExampleCanvas />}
    />
  );
}

export default function App() {
  return (
    <ThemeProvider>
      <CopilotKitProvider runtimeUrl="/api/copilotkit">
        <HomePage />
      </CopilotKitProvider>
    </ThemeProvider>
  );
}
```

### BFF

- **In `apps/bff/src/server.ts`**, remove the `CopilotKitIntelligence` import and configuration block. Change the `CopilotRuntime` options:
  - Remove `intelligence`
  - Remove `identifyUser`
  - Remove `licenseToken`
- Switch the endpoint back to the non-v2 API if desired (or keep v2 without intelligence — both work)

### Infrastructure

- **Delete** `docker-compose.yml` and `docker/init-db/`
- **Remove** the `INTELLIGENCE_*` variables from `.env` / `.env.example` if you are no longer using CopilotKit Intelligence

### Summary of files to touch

| Action | Path                                      |
| ------ | ----------------------------------------- |
| Delete | `apps/app/src/components/threads-drawer/` |
| Edit   | `apps/app/src/App.tsx`                    |
| Edit   | `apps/bff/src/server.ts`                  |
| Delete | `docker-compose.yml`                      |
| Delete | `docker/init-db/`                         |
| Edit   | `.env.example`                            |

## Documentation

- [CopilotKit Docs](https://docs.copilotkit.ai)
- [LangGraph Docs](https://langchain-ai.github.io/langgraph/)

## License

MIT
