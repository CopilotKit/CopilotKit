# Open ChatKit Studio

Explore and build embeddable chat experiences.

## Applications

- **Studio** (port 3000) - Main launcher interface with cards for each app
- **Playground** (port 3001) - AG-UI playground for customizing and learning
- **World** (port 3002) - Interactive globe demo with CopilotKit

## Getting Started

```bash
# Install dependencies
pnpm install

# Setup environment variables for agents (optional)
cp apps/playground/agent/.env.example apps/playground/agent/.env
cp apps/world/agent/.env.example apps/world/agent/.env
# Edit the .env files with your API keys

# Run all apps concurrently
pnpm dev

# Run individual apps
pnpm dev:studio       # Studio launcher only
pnpm dev:playground   # Playground app only
pnpm dev:world        # World app only
```

## Structure

```
open-chatkit-studio/
├── apps/
│   ├── studio/        # Main launcher (Next.js 15)
│   ├── playground/    # AG-UI Playground with LangGraph agent
│   └── world/         # CopilotKit World Explorer
├── package.json       # Root workspace config
├── pnpm-workspace.yaml
└── turbo.json         # Turborepo config
```

## Architecture

This is a monorepo combining multiple chat applications:

- **Monorepo Manager**: pnpm workspaces
- **Build System**: Turborepo for optimized parallel builds
- **Framework**: Next.js 15 with TypeScript
- **Styling**: Tailwind CSS 4
- **Agents**: LangGraph for playground and world apps

Each app runs on its own port and can be developed independently. The studio launcher provides a unified entry point with visual cards linking to each application.

## Development

### Building All Apps
```bash
pnpm build
```

### Building Individual Apps
```bash
pnpm build:studio
pnpm build:playground
pnpm build:world
```

### Running Agents

Playground and World apps each have their own LangGraph agents:

```bash
# Playground agent (port 8124)
cd apps/playground && pnpm dev:agent

# World agent (port 8125)
cd apps/world && pnpm dev:agent
```

## Port Configuration

- Studio: 3000
- Playground: 3001
- World: 3002
- Playground Agent: 8124
- World Agent: 8125
