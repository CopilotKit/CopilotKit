

https://github.com/user-attachments/assets/0a955c8e-d993-4577-9ca3-e510a544cb6e


# LangGraphJS Multi-Agent Telecom Support System

This is an intelligent customer support application built with [CopilotKit](https://copilotkit.ai) and [LangGraph](https://www.langchain.com/langgraph). It features a multi-agent AI system that handles customer inquiries, manages telecom services, and automatically escalates complex issues to human agents.

The system includes four specialized agents:
- **Intent Agent** - Classifies customer messages and determines urgency
- **Customer Lookup Agent** - Retrieves customer profiles and service details
- **Reply Agent** - Generates personalized responses based on context
- **Escalation Agent** - Routes complex issues to appropriate support teams



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

1. Install all dependencies (this installs everything for the frontend and agent:
```bash
pnpm install
```

2. Set up your OpenAI API key:
```bash
cd apps/agent
echo "OPENAI_API_KEY=your-openai-api-key-here" > .env
```

3. Start the development servers concurrently:
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

## Troubleshooting

### Agent Connection Issues
If you see "I'm having trouble connecting to my tools", make sure:
1. The LangGraph agent is running on port 8000
2. Your OpenAI API key is set correctly
3. Both servers started successfully
