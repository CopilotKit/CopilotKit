# CopilotKit <> strands Starter

This is a starter template for building AI agents using [strands](https://strands.com) and [CopilotKit](https://copilotkit.ai). It provides a modern Next.js application with an integrated investment analyst agent that can research stocks, analyze market data, and provide investment insights.

## Prerequisites

- Node.js 20+
- Python 3.12+
- [uv](https://docs.astral.sh/uv/) (Python package manager)
- OpenAI API Key (for the strands agent)
- Any of the following package managers:
  - npm (default)
  - [pnpm](https://pnpm.io/installation)
  - [yarn](https://classic.yarnpkg.com/lang/en/docs/install/)
  - [bun](https://bun.sh/)

## Getting Started

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

> **Note:** Installing the package dependencies will also install the agent's python dependencies via the `install:agent` script.

2. Set up your OpenAI API key:

```bash
export OPENAI_API_KEY="your-openai-api-key-here"
```

or create a `.env` file.

```bash
echo "OPENAI_API_KEY=your-openai-api-key-here" > .env
```

3. Start the development server:

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

This will start both the UI and agent servers concurrently.

## CopilotKit Intelligence & Threads (Optional)

CopilotKit Intelligence provides durable, multi-turn conversation threads with memory persistence. To enable:

### Prerequisites

- Docker Desktop or equivalent
- CopilotKit License Token (get from [CopilotKit Cloud](https://cloud.copilotkit.ai))

### Setup

1. Start the intelligence stack:

```bash
# Set your license token (if not already in .env)
echo "COPILOTKIT_LICENSE_TOKEN=your-token-here" >> .env

# Start intelligence services (postgres, redis, intelligence API)
docker compose -f ../../../showcase/shared/intelligence-dev/docker-compose.yml up -d

# Verify services are healthy
docker compose -f ../../../showcase/shared/intelligence-dev/docker-compose.yml ps
```

2. Ensure intelligence configuration in `.env` (uncomment if already present):

```bash
COPILOTKIT_LICENSE_TOKEN=your-token-here
INTELLIGENCE_API_URL=http://localhost:4201
INTELLIGENCE_GATEWAY_WS_URL=ws://localhost:4401
```

3. Run your application:

```bash
npm run dev
```

The intelligence stack will now handle conversation threads, state persistence, and memory. See the [Intelligence setup documentation](../../../showcase/shared/intelligence-dev/README.md) for troubleshooting and advanced configuration.

### Stopping Intelligence

```bash
# Stop services (keeps data)
docker compose -f ../../../showcase/shared/intelligence-dev/docker-compose.yml stop

# Stop and remove containers + volumes (fresh start)
docker compose -f ../../../showcase/shared/intelligence-dev/docker-compose.yml down -v
```

## Available Scripts

The following scripts can also be run using your preferred package manager:

- `dev` - Starts both UI and agent servers in development mode
- `dev:ui` - Starts only the Next.js UI server
- `dev:agent` - Starts only the strands agent server
- `build` - Builds the Next.js application for production
- `start` - Starts the production server
- `install:agent` - Installs Python dependencies for the agent

## 📚 Documentation

The main UI component is in `src/app/page.tsx`. You can:

- Modify the theme colors and styling
- Add new frontend actions
- Customize the CopilotKit sidebar appearance

Otherwise, check out the documentation relevant to your task:

- [Strands Documentation](https://strandsagents.com/latest/documentation/docs/) - Learn more about Strands and its features
- [CopilotKit Documentation](https://docs.copilotkit.ai) - Explore CopilotKit's capabilities
- [Next.js Documentation](https://nextjs.org/docs) - Learn about Next.js features and API

## Contributing

Feel free to submit issues and enhancement requests! This starter is designed to be easily extensible.

## License

This project is licensed under the MIT License - see the LICENSE file for details.

## Troubleshooting

### Agent Connection Issues

If you see "I'm having trouble connecting to my tools", make sure:

1. The strands agent is running on port 8000
2. Your OpenAI API key is set correctly
3. Both servers started successfully

### Python Dependencies

If you encounter Python import errors:

```bash
cd agent
uv sync
```
