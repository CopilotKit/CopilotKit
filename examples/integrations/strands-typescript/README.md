# CopilotKit <> Strands (TypeScript) Starter

This is a starter template for building AI agents using [Strands](https://strandsagents.com) (TypeScript SDK) and [CopilotKit](https://copilotkit.ai). It provides a modern Next.js application with an integrated demo assistant that can manage todos, query data, render charts, and generate dynamic UI.

## Prerequisites

- Node.js 20+
- OpenAI API Key (for the Strands agent)
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

> **Note:** Installing the package dependencies will also install the agent's dependencies via the `install:agent` script.

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

## Available Scripts

The following scripts can also be run using your preferred package manager:

- `dev` - Starts both UI and agent servers in development mode
- `dev:ui` - Starts only the Next.js UI server
- `dev:agent` - Starts only the Strands agent server
- `build` - Builds the Next.js application for production
- `start` - Starts the production server
- `install:agent` - Installs Node.js dependencies for the agent

## Documentation

The main UI component is in `src/app/page.tsx`. You can:

- Modify the theme colors and styling
- Add new frontend actions
- Customize the CopilotKit sidebar appearance

Otherwise, check out the documentation relevant to your task:

- [Strands Documentation](https://strandsagents.com/latest/documentation/docs/) - Learn more about Strands and its features
- [Strands TypeScript SDK](https://github.com/strands-agents/sdk-typescript) - TypeScript SDK reference
- [CopilotKit Documentation](https://docs.copilotkit.ai) - Explore CopilotKit's capabilities
- [Next.js Documentation](https://nextjs.org/docs) - Learn about Next.js features and API

## Contributing

Feel free to submit issues and enhancement requests! This starter is designed to be easily extensible.

## License

This project is licensed under the MIT License - see the LICENSE file for details.

## Troubleshooting

### Agent Connection Issues

If you see "I'm having trouble connecting to my tools", make sure:

1. The Strands agent is running on port 8000
2. Your OpenAI API key is set correctly
3. Both servers started successfully

### Agent Dependencies

If you encounter import errors in the agent:

```bash
cd agent
npm install
```
