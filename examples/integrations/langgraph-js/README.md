# CopilotKit <> LangGraph Starter

This is a starter template for building AI agents using [LangGraph](https://www.langchain.com/langgraph) and [CopilotKit](https://copilotkit.ai). It provides a modern Next.js application with an integrated LangGraph agent to be built on top of.

This project is organized as a monorepo using [Turborepo](https://turbo.build) and [pnpm workspaces](https://pnpm.io/workspaces).

## Project Structure

```
.
├── apps/
│   ├── web/          # Next.js frontend application
│   └── agent/        # LangGraph agent
├── pnpm-workspace.yaml
├── turbo.json
└── package.json
```

## Prerequisites

- Node.js 18+
- [pnpm](https://pnpm.io/installation) 9.15.0 or later
- OpenAI API Key (for the LangGraph agent)

## Getting Started

1. Install all dependencies (this installs everything for both apps):
```bash
pnpm install
```

2. Set up your OpenAI API key:
```bash
cd apps/agent
echo "OPENAI_API_KEY=your-openai-api-key-here" > .env
```

3. Start the development servers:
```bash
pnpm dev
```

This will start both the Next.js app (on port 3000) and the LangGraph agent (on port 8123) using Turborepo.

## Available Scripts

All scripts use Turborepo to run tasks across the monorepo:

- `pnpm dev` - Starts both the web app and agent servers in development mode
- `pnpm dev:studio` - Starts the web app and agent with LangGraph Studio UI
- `pnpm build` - Builds all apps for production
- `pnpm lint` - Runs linting across all apps

### Running Scripts for Individual Apps

You can also run scripts for individual apps using pnpm's filter flag:

```bash
# Run dev for just the web app
pnpm --filter web dev

# Run dev for just the agent
pnpm --filter agent dev

# Or navigate to the app directory
cd apps/web
pnpm dev
```

## Customization

The main UI component is in `apps/web/src/app/page.tsx`. You can:
- Modify the theme colors and styling
- Add new frontend actions
- Utilize shared-state
- Customize your user-interface for interacting with LangGraph

The LangGraph agent code is in `apps/agent/src/`.

## 📚 Documentation

- [CopilotKit Documentation](https://docs.copilotkit.ai) - Explore CopilotKit's capabilities
- [LangGraph Documentation](https://langchain-ai.github.io/langgraph/) - Learn more about LangGraph and its features
- [Next.js Documentation](https://nextjs.org/docs) - Learn about Next.js features and API

## Contributing

Feel free to submit issues and enhancement requests! This starter is designed to be easily extensible.

## License

This project is licensed under the MIT License - see the LICENSE file for details.

## Troubleshooting

### Agent Connection Issues
If you see "I'm having trouble connecting to my tools", make sure:
1. The LangGraph agent is running on port 8000
2. Your OpenAI API key is set correctly
3. Both servers started successfully
