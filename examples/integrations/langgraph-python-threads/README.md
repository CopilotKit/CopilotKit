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

| Service              | Port | Description                              |
| -------------------- | ---- | ---------------------------------------- |
| **PostgreSQL**       | 5432 | Thread and event storage                 |
| **Redis**            | 6379 | Session/cache                            |
| **App API**          | 4201 | Intelligence REST API                    |
| **Realtime Gateway** | 4401 | WebSocket gateway for live thread events |

## Prerequisites

- Node.js 18+
- Python 3.8+
- npm 10+
- OpenAI API Key
- Docker (for threads/intelligence support)

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

4. **Start intelligence infrastructure** (for threads):

```bash
docker compose up -d --wait
```

This pulls the GHCR images pinned to `0.1.0-rc.7`.

5. Start all services:

```bash
npm run dev
```

This starts the frontend, BFF, and agent concurrently.

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
