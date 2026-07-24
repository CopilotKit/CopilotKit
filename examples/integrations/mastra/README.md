# CopilotKit <> Mastra Starter

This is a starter template for building AI agents using [Mastra](https://mastra.ai) and [CopilotKit](https://copilotkit.ai). It provides a modern Next.js application with integrated AI capabilities and a beautiful UI.

## Prerequisites

- Node.js 18+
- Any of the following package managers:
  - npm (default)
  - [pnpm](https://pnpm.io/installation)
  - [yarn](https://classic.yarnpkg.com/lang/en/docs/install/)
  - [bun](https://bun.sh/)

## Getting Started

1. Add your OpenAI API key

```bash
# you can use whatever model Mastra supports
echo "OPENAI_API_KEY=your-key-here" >> .env
```

2. Install dependencies using your preferred package manager:

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
# Set your license token
echo "COPILOTKIT_LICENSE_TOKEN=your-token-here" >> .env

# Start intelligence services (postgres, redis, intelligence API)
docker compose -f ../../../showcase/shared/intelligence-dev/docker-compose.yml up -d

# Verify services are healthy
docker compose -f ../../../showcase/shared/intelligence-dev/docker-compose.yml ps
```

2. Add intelligence configuration to `.env`:

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
- `dev:agent` - Starts only the Mastra agent server
- `dev:debug` - Starts development servers with debug logging enabled
- `build` - Builds the application for production
- `start` - Starts the production server

## Documentation

- [Mastra Documentation](https://mastra.ai/en/docs) - Learn more about Mastra and its features
- [CopilotKit Documentation](https://docs.copilotkit.ai) - Explore CopilotKit's capabilities
- [Next.js Documentation](https://nextjs.org/docs) - Learn about Next.js features and API

## Contributing

Feel free to submit issues and enhancement requests!

## License

This project is licensed under the MIT License - see the LICENSE file for details.
