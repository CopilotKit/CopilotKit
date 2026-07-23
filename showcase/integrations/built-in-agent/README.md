# Built-in Agent (TanStack AI) Showcase

**CopilotKit's `BuiltInAgent` in factory mode with TanStack AI as the LLM backend.**

The agent runs **in-process inside the Next.js API route** — there is no separate agent server process to start (unlike the LangGraph TypeScript variant which spawns `langgraph-cli` on port 8123).

## Quick Start

### Prerequisites

- Node.js 18+
- An OpenAI API key

### Setup

1. **Clone & install dependencies**

```bash
npm install
```

2. **Set environment variables**

Create a `.env.local` file from `.env.example`:

```bash
cp .env.example .env.local
```

Then fill in your `OPENAI_API_KEY`:

```
OPENAI_API_KEY=sk-...
NEXT_PUBLIC_COPILOTKIT_AGENT=default
```

3. **Start the dev server**

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) to see the demo index.

## Build

```bash
npm run build
```

## Architecture

- **Agent Factory**: See `src/lib/factory/tanstack-factory.ts` for the `BuiltInAgent` wiring and TanStack AI integration.
- **Tools**: Defined in:
  - `src/lib/factory/state-tools.ts` — state management tools
  - `src/lib/factory/server-tools.ts` — server-side tools
  - `src/lib/factory/subagent-tools.ts` — sub-agent tools
- **API Route**: `src/app/api/copilotkit/[[...slug]]/route.ts` handles the AG-UI protocol.

## Next Steps

Phase 3+ will add individual demo pages under `src/app/demos/`.
