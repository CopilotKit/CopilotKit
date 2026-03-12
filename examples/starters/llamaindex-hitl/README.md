# CopilotKit <> LlamaIndex Guide Example: Human-in-the-Loop (HITL)

This repo demonstrates Human-in-the-Loop (HITL) with [LlamaIndex](https://llamaindex.com) and [CopilotKit](https://copilotkit.ai). It includes a Next.js app connected to a LlamaIndex agent that drafts an essay via a tool (`write_essay`), renders the draft in the chat for review, and waits for you to either accept or ignore the draft. When accepted, the essay is saved to shared state and displayed in the center panel.

### How HITL works here
- Ask the assistant: “Write an essay about …”.
- The agent calls the `write_essay` tool which uses `renderAndWaitForResponse` to show the draft.
- You choose: **Accept Draft** (sends `SEND`) or **Ignore Draft** (sends `CANCEL`).
- On accept, the UI saves the draft to shared state and renders it on the page.
- The action uses `followUp: false` to prevent loops after approval.

## Prerequisites

- Node.js 18+ 
- Python 3.9+
- OpenAI API Key (for the LlamaIndex agent)
- [uv](https://docs.astral.sh/uv/getting-started/installation/)
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

2. Install Python dependencies for the LlamaIndex agent:
```bash
# Using pnpm
pnpm install:agent

# Using npm
npm run install:agent

# Using yarn
yarn install:agent

# Using bun
bun run install:agent
```

3. Set up your OpenAI API key:
```bash
export OPENAI_API_KEY="your-openai-api-key-here"
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

## Available Scripts
The following scripts can also be run using your preferred package manager:
- `dev` - Starts both UI and agent servers in development mode
- `dev:debug` - Starts development servers with debug logging enabled
- `dev:ui` - Starts only the Next.js UI server
- `dev:agent` - Starts only the LlamaIndex agent server
- `install:agent` - Installs Python dependencies for the agent
- `build` - Builds the Next.js application for production
- `start` - Starts the production server
- `lint` - Runs ESLint for code linting

## Documentation

The main UI component is in `src/app/page.tsx`. You can:
- Modify the theme colors and styling
- Customize the CopilotKit sidebar appearance
- Inspect the HITL flow: the `write_essay` action uses `renderAndWaitForResponse` and saves the accepted draft to shared state (displayed on the page).

Agent pieces:
- `agent/agent/agent.py` defines the agent and exposes the frontend tool.
- `agent/agent/server.py` runs the FastAPI server.
- `src/app/api/copilotkit/route.ts` connects the UI to the agent via AG‑UI.

## 📚 Documentation

- [LlamaIndex Documentation](https://docs.llamaindex.com/introduction) - Learn more about LlamaIndex and its features
- [CopilotKit Documentation](https://docs.copilotkit.ai) - Explore CopilotKit's capabilities
- [Next.js Documentation](https://nextjs.org/docs) - Learn about Next.js features and API


## Contributing

Feel free to submit issues and enhancement requests! This starter is designed to be easily extensible.

## License

This project is licensed under the MIT License - see the LICENSE file for details.

## Troubleshooting

### Agent Connection Issues
If you see "I'm having trouble connecting to my tools", make sure:
1. The LlamaIndex agent is running on port 9000 (default when using `pnpm dev`/`npm run dev`). If you run `server.py` directly, it uses 8000—update `src/app/api/copilotkit/route.ts` accordingly.
2. Your OpenAI API key is set correctly
3. Both servers started successfully

### Python Dependencies
If you encounter Python import errors:
```bash
cd agent
uv sync
```
