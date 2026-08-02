# CopilotKit <> PydanticAI Starter

This is a starter template for building AI agents using [PydanticAI](https://ai.pydantic.dev/) and [CopilotKit](https://copilotkit.ai). It provides a modern Next.js application with an integrated investment analyst agent that can research stocks, analyze market data, and provide investment insights.

## Prerequisites

- OpenAI API Key (for the PydanticAI agent)
- Python 3.12+
- uv
- Node.js 20+
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

> **Note:** This will automatically setup the Python environment as well.
>
> If you have manual issues, you can run:
>
> ```sh
> npm run install:agent
> ```

2. Set up your OpenAI API key:

Create a `.env` file in the project root with the following content:

```
OPENAI_API_KEY=sk-...your-openai-key-here...
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

## Running a managed Channel

`channel-host.mts` mounts the same agent as a managed Intelligence Channel
(Slack, Teams). It requires `INTELLIGENCE_API_KEY` and a declared Channel in
`.copilotkit/channels.json` — set both up with `copilotkit init` or
`copilotkit channels add`, which write that file and the credentials your
`.env` needs, then:

```bash
npm run channel
```

The host reads which Channel to hold from `.copilotkit/channels.json`. If a
project declares more than one, set `INTELLIGENCE_CHANNEL_NAME` to pick one.

The host holds no provider credentials and exposes no provider endpoint —
Intelligence owns the provider edge — so the same file works for every provider.

Once startup finishes, the log reports the truth per Channel:

- `Channel "<name>" is online.` — the managed session is up and can send.
- `Channel "<name>" is declared but no managed provider is attached yet.` —
  a normal waiting state, not a failure. Run `copilotkit channels status` to
  see what setup remains.

Neither message proves the provider app is installed, reachable, or that
anyone can message it — verify that separately (invite the bot, then message
it) before treating the Channel as working.

## Available Scripts

The following scripts can also be run using your preferred package manager:

- `dev` - Starts both UI and agent servers in development mode
- `dev:debug` - Starts development servers with debug logging enabled
- `dev:ui` - Starts only the Next.js UI server
- `dev:agent` - Starts only the PydanticAI agent server
- `build` - Builds the Next.js application for production
- `start` - Starts the production server
- `install:agent` - Installs Python dependencies for the agent
- `channel` - Holds a managed Intelligence Channel open (see "Running a managed Channel" above)
- `typecheck:channel` - Type-checks `channel-host.mts` on its own `tsconfig.channel.json`

## Documentation

The main UI component is in `src/app/page.tsx`. You can:

- Modify the theme colors and styling
- Add new frontend actions
- Customize the CopilotKit sidebar appearance

## 📚 Documentation

- [PydanticAI Documentation](https://ai.pydantic.dev) - Learn more about PydanticAI and its features
- [CopilotKit Documentation](https://docs.copilotkit.ai) - Explore CopilotKit's capabilities
- [Next.js Documentation](https://nextjs.org/docs) - Learn about Next.js features and API

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

## CopilotKit Intelligence & Threads (Optional)

CopilotKit Intelligence adds durable thread history and cross-session memory to
your agent. It requires a `COPILOTKIT_LICENSE_TOKEN` and a running local
Intelligence stack (Docker Desktop + a local Intelligence repo checkout).

### Prerequisites

- [Docker Desktop](https://www.docker.com/products/docker-desktop/) running
- A `COPILOTKIT_LICENSE_TOKEN` (obtain from [CopilotKit Cloud](https://cloud.copilotkit.ai))
- The [Intelligence repo](https://github.com/CopilotKit/Intelligence) cloned
  locally. The `docker-compose.intelligence.yml` defaults to a sibling
  directory at `../../../Intelligence` relative to this starter; override with
  the `INTELLIGENCE_REPO` env var if your checkout is elsewhere.

### Start the intelligence stack

```bash
# From inside this starter directory:
docker compose -f docker-compose.intelligence.yml up -d --wait
```

First run builds the intelligence image from source (may take several minutes).

### Verify the stack is healthy

```bash
docker compose -f docker-compose.intelligence.yml ps
```

All three services (`postgres`, `redis`, `intelligence`) should show `healthy`.

### Set environment variables

Add the following to your `.env` file:

```env
COPILOTKIT_LICENSE_TOKEN=your-license-token-here
INTELLIGENCE_API_URL=http://localhost:4206
INTELLIGENCE_GATEWAY_WS_URL=ws://localhost:4406
```

Then start the dev server as usual (`npm run dev`). Thread history and memory
features are activated automatically when `COPILOTKIT_LICENSE_TOKEN` is set.

### Stop / reset

```bash
# Stop without removing data:
docker compose -f docker-compose.intelligence.yml down

# Full reset (removes postgres + redis volumes):
docker compose -f docker-compose.intelligence.yml down -v
```
