# CopilotKit <> CrewAI Flow Starter

This is a starter template for building AI agents using [CrewAI Flows](https://docs.crewai.com/en/concepts/flows) and [CopilotKit](https://copilotkit.ai). It provides a modern Next.js application with an integrated CrewAI Flow agent to be built on top of.

## Prerequisites

- Node.js 18+
- Python 3.10+
- [uv](https://docs.astral.sh/uv/) - Fast Python package installer and resolver
- Any of the following package managers:
  - npm (default)
  - [pnpm](https://pnpm.io/installation)
  - [yarn](https://classic.yarnpkg.com/lang/en/docs/install/)
  - [bun](https://bun.sh/)
- OpenAI API Key (for the CrewAI Flow agent)

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

> **Note:** Installing the package dependencies will also install the agent's Python dependencies via the `install:agent` script using `uv`. This will automatically create a virtual environment and install dependencies from `pyproject.toml`.

2. Set up your OpenAI API key:

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

## Running a Channel

`channel-host.mts` mounts the same agent as an Intelligence Channel
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

The Channel itself is declared in `channels.mts` — that is where to add commands,
reactions, or an `onMention` handler. `channel-host.mts` only owns the process
lifetime, and is byte-identical in every starter.

Once startup finishes, the log reports the truth per Channel:

- `Channel "<name>" is online.` — the session is up and can send.
- `Channel "<name>" is declared but no provider is attached yet.` —
  a normal waiting state, not a failure. Run `copilotkit channels status` to
  see what setup remains.

Neither message proves the provider app is installed, reachable, or that
anyone can message it — verify that separately (invite the bot, then message
it) before treating the Channel as working.

## Available Scripts

The following scripts can also be run using your preferred package manager:

- `dev` - Starts both UI and agent servers in development mode
- `dev:ui` - Starts only the Next.js UI server
- `dev:agent` - Starts only the CrewAI Flow agent server
- `build` - Builds the Next.js application for production
- `start` - Starts the production server
- `install:agent` - Installs Python dependencies for the agent using `uv`
- `channel` - Holds an Intelligence Channel open (see "Running a Channel" above)
- `typecheck:channel` - Type-checks the channel host on its own `tsconfig.channel.json`

## Documentation

The main UI component is in `src/app/page.tsx`. You can:

- Modify the theme colors and styling
- Add new frontend actions
- Utilize shared-state
- Customize your user-interface for interacting with CrewAI Flow

## 📚 Documentation

- [CopilotKit Documentation](https://docs.copilotkit.ai) - Explore CopilotKit's capabilities
- [CrewAI Flow Documentation](https://docs.crewai.com/en/concepts/flows) - Learn more about CrewAI Flow and its features
- [Next.js Documentation](https://nextjs.org/docs) - Learn about Next.js features and API

## Contributing

Feel free to submit issues and enhancement requests! This starter is designed to be easily extensible.

## License

This project is licensed under the MIT License - see the LICENSE file for details.

## Troubleshooting

### Agent Connection Issues

If you see "I'm having trouble connecting to my tools", make sure:

1. The CrewAI Flow agent is running on port 8000
2. Your OpenAI API key is set correctly
3. Both servers started successfully
