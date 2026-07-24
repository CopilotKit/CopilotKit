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

## Managed CopilotKit Intelligence

`copilotkit init` writes `CPK_INTELLIGENCE_API_KEY` for the selected managed
project. `CPK_TELEMETRY_ID` is an optional, non-secret analytics identity.
Keep both values in `.env`; the telemetry ID is not a credential.

## Pinned SDK compatibility and offline licensing

This template pins `@copilotkit/runtime` and `@copilotkit/react-core` at
`1.62.3`. Those packages predate managed entitlement responses. Until the
pins move to a release with that contract, set `COPILOTKIT_LICENSE_TOKEN` in
`.env` alongside `CPK_INTELLIGENCE_API_KEY`. The token supplies the legacy
Threads entitlement check; it does not replace the managed API key.

`CPK_TELEMETRY_ID` stays an optional, separate analytics identity. Offline or
self-hosted deployments can also use `COPILOTKIT_LICENSE_TOKEN` as described
in the self-hosting guide.

## License

This project is licensed under the MIT License - see the LICENSE file for details.
