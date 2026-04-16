# CopilotKit <> A2A + A2UI Starter

This is a starter template for building AI agents that use [A2UI](https://a2ui.org) and [CopilotKit](https://copilotkit.ai). It provides a modern Next.js application with an integrated restaurant finder agent that can find restaurants and book reservations

![Demo](Demo.gif)

## Prerequisites

- Gemeni API Key (for the ADK/A2A agent)
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

3. Set up your Gemeni API key:

Create a `.env` file inside the `agent` folder with the following content:

```
GEMENI_API_KEY=sk-...your-openai-key-here...
```

4. Start the development server:

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
- `dev:debug` - Starts development servers with debug logging enabled
- `dev:ui` - Starts only the Next.js UI server
- `dev:agent` - Starts only the A2A agent server
- `build` - Builds the Next.js application for production
- `start` - Starts the production server
- `install:agent` - Installs Python dependencies for the agent

## Documentation

The main UI component is in `app/page.tsx`, but most of the UI comes from from the agent in the form of A2UI declarative components. To see and edit the components it can generate, look in `agent/prompt_builder.py`.
To generate new components, try the [A2UI Composer](https://a2ui-editor.ag-ui.com)

## 📚 Documentation

- [A2UI + CopilotKit Documentation](https://docs.copilotkit.ai/a2a) - Learn more about how to use A2UI with CopilotKit
- [A2UI Documentation](https://a2ui.org) - Learn more about A2UI and its capabilities
- [CopilotKit Documentation](https://docs.copilotkit.ai) - Explore CopilotKit's capabilities
- [Next.js Documentation](https://nextjs.org/docs) - Learn about Next.js features and API

## Contributing

Feel free to submit issues and enhancement requests! This starter is designed to be easily extensible.

## License

This project is licensed under the MIT License - see the LICENSE file for details.

## Troubleshooting

### Agent Connection Issues

If you see "I'm having trouble connecting to my tools", make sure:

1. The ADK agent is running on port 10002
2. Your Gemini API key is set correctly
3. Both servers started successfully

### Python Dependencies

If you encounter Python import errors:

```bash
cd agent
uv sync
uv run .
```
