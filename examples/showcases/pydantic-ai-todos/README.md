# CopilotKit <> PydanticAI Todo App

This is a starter template for building AI agents using [PydanticAI](https://ai.pydantic.dev/) and [CopilotKit](https://copilotkit.ai). It provides a modern Next.js application with an integrated AI assistant that helps you manage a todo board with three columns: Todo, In-Progress, and Done.

## Prerequisites

- OpenAI API Key (for the PydanticAI agent)
- Python 3.12+
- uv
- Node.js 20+ 
- Any of the following package managers:
  - pnpm (recommended)
  - npm
  - yarn
  - bun

> **Note:** This repository ignores lock files (package-lock.json, yarn.lock, pnpm-lock.yaml, bun.lockb) to avoid conflicts between different package managers. Each developer should generate their own lock file using their preferred package manager. After that, make sure to delete it from the .gitignore.

## Getting Started

1. Install dependencies using your preferred package manager:
```bash
# Using pnpm (recommended)
pnpm install

# Using npm
npm install

# Using yarn
yarn install

# Using bun
bun install
```

> **Note:** This will automatically setup the Python environment as well.
>
> If you have manual isseus, you can run:
>
> ```sh
> npm run install:agent
> ```


3. Set up your API keys:

Create a `.env` file inside the `agent` folder with the following content:

```bash
# Required: Get from https://platform.openai.com/api-keys
OPENAI_API_KEY=sk-...your-openai-key-here...

# Optional: For agent observability
# Sign up at https://logfire.pydantic.dev
# Create token: https://logfire.pydantic.dev/docs/how-to-guides/create-write-tokens/
LOGFIRE_TOKEN=...your-logfire-token...
```

4. Start the development server:
```bash
# Using pnpm
pnpm dev

# Using npm
npm run dev

# Using yarn
yarn dev

# Using bun
bun run dev
```

This will start both the UI and agent servers concurrently.

## How It Works

This app connects three technologies to create a full-stack agentic todo application:

### The Three Technologies

1. **[PydanticAI](https://ai.pydantic.dev/)** ([`agent/src/agent.py`](agent/src/agent.py)) - Python AI agent framework
   - Defines the agent with GPT-4.1-mini model and tools
   - Tools ([`agent/src/tools.py`](agent/src/tools.py)): `add_todos`, `update_todo`, `delete_todos`, etc.
   - Uses Pydantic models ([`agent/src/models.py`](agent/src/models.py)) for type-safe state

2. **[AG-UI](https://ai.pydantic.dev/agents-ui/)** ([`agent/src/main.py`](agent/src/main.py)) - Bridge between Python and web
   - `agent.to_ag_ui()` converts PydanticAI agent to FastAPI server (port 8000)
   - Handles state synchronization via `StateSnapshotEvent`

3. **[CopilotKit](https://copilotkit.ai/)** ([`src/app/page.tsx`](src/app/page.tsx), [`src/app/api/copilotkit/route.ts`](src/app/api/copilotkit/route.ts)) - React chat UI
   - `useCoAgent()` creates bidirectional state sync with backend
   - `HttpAgent` connects to Python AG-UI server
   - Renders tool calls with custom UI components

<details>
<summary><strong>🔍 Technical Deep Dive -></strong></summary>

### Architecture

```mermaid
graph TD
    A[User Input] --> B[CopilotKit UI<br/>src/app/page.tsx]
    B --> C[useCoAgent Hook<br/>State Sync]
    C --> D[Next.js API Route<br/>src/app/api/copilotkit/route.ts]
    D --> E[HttpAgent<br/>:8000 proxy]
    E --> F[AG-UI Server<br/>agent/src/main.py]
    F --> G[PydanticAI Agent<br/>agent/src/agent.py]
    G --> H[Tools<br/>agent/src/tools.py]
    H --> I[StateSnapshotEvent]
    I --> F
    F --> E
    E --> D
    D --> C
    C --> B
    B --> J[UI Update]

    style A fill:#e1f5ff
    style J fill:#e1f5ff
    style B fill:#a8daff
    style C fill:#a8daff
    style D fill:#a8daff
    style F fill:#ffcba8
    style G fill:#ffcba8
    style H fill:#ffcba8
    style I fill:#ffd700
```

### Data Flow

1. User types in chat → CopilotKit sends to `/api/copilotkit`
2. Next.js proxies via `HttpAgent` to Python backend (localhost:8000)
3. PydanticAI agent calls tools (e.g., `add_todos`)
4. Tools return `StateSnapshotEvent` with updated state
5. AG-UI pushes state back through CopilotKit
6. `useCoAgent` updates React UI automatically

### Key Files

- [`src/app/page.tsx`](src/app/page.tsx) - CopilotKit integration & state sync
- [`src/app/api/copilotkit/route.ts`](src/app/api/copilotkit/route.ts) - Proxy to Python backend
- [`agent/src/agent.py`](agent/src/agent.py) - PydanticAI agent definition
- [`agent/src/tools.py`](agent/src/tools.py) - Todo management tools
- [`agent/src/models.py`](agent/src/models.py) - Shared data models
- [`agent/src/main.py`](agent/src/main.py) - AG-UI server setup

</details>

## Resources

### Documentation

- [PydanticAI Documentation](https://ai.pydantic.dev) - Learn more about PydanticAI and its features
- [CopilotKit Documentation](https://docs.copilotkit.ai) - Explore CopilotKit's capabilities
- [Next.js Documentation](https://nextjs.org/docs) - Learn about Next.js features and API

### Available Scripts
The following scripts can also be run using your preferred package manager:
- `dev` - Starts both UI and agent servers in development mode
- `dev:debug` - Starts development servers with debug logging enabled
- `dev:ui` - Starts only the Next.js UI server
- `dev:agent` - Starts only the PydanticAI agent server
- `build` - Builds the Next.js application for production
- `start` - Starts the production server
- `lint` - Runs ESLint for code linting
- `install:agent` - Installs Python dependencies for the agent

## Contributing

Feel free to submit issues and enhancement requests! This starter is designed to be easily extensible.

## License

This project is licensed under the MIT License - see the LICENSE file for details.

## Troubleshooting

### Agent Connection Issues
If you see "I'm having trouble connecting to my tools", make sure:
1. The PydanticAI agent is running on port 8000
2. Your OpenAI API key is set correctly
3. Both servers started successfully

### Python Dependencies
If you encounter Python import errors:
```bash
cd agent
uv sync
uv run src/main.py
```