# CopilotKit <> LangGraph Auth Starter

This is a starter template for building authenticated AI agents using [LangGraph](https://www.langchain.com/langgraph) and [CopilotKit](https://copilotkit.ai). It provides a modern Next.js application with an integrated LangGraph agent, served by FastAPI, that knows who the signed-in user is, only offers its backend tools to authenticated users, and answers questions about uploaded PDF, Excel, and CSV files.

## Prerequisites

- Node.js 20.9+
- Python 3.12+
- [uv](https://docs.astral.sh/uv/) (Python package manager)
- Any of the following package managers:
  - npm (default)
  - [pnpm](https://pnpm.io/installation)
  - [yarn](https://classic.yarnpkg.com/lang/en/docs/install/)
  - [bun](https://bun.sh/)
- OpenAI API Key (for the LangGraph agent)

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

This will also install the Python agent dependencies via `uv sync`.

2. Set up your environment variables:

```bash
cp .env.example .env
```

Then edit the `.env` file and add your OpenAI API key:

```bash
OPENAI_API_KEY=your-openai-api-key-here
```

To use a different model or any OpenAI-compatible API, also set `OPENAI_MODEL` (default `gpt-4o`) and `OPENAI_BASE_URL`.

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

This will start both the UI and agent servers concurrently. Open [http://localhost:3000](http://localhost:3000), pick a demo user from the menu in the top-left corner, and try the suggested prompts.

## Available Scripts

The following scripts can also be run using your preferred package manager:

- `dev` - Starts both UI and agent servers in development mode
- `dev:debug` - Starts development servers with debug logging enabled
- `dev:ui` - Starts only the Next.js UI server
- `dev:agent` - Starts only the LangGraph agent server
- `build` - Builds the Next.js application for production
- `start` - Starts the production server
- `lint` - Runs ESLint
- `install:agent` - Installs Python dependencies for the agent

## Project Structure

```
├── src/                                  # Next.js frontend source
│   ├── app/
│   │   ├── page.tsx                      # Main page: shared state, frontend tools, tool rendering
│   │   ├── layout.tsx                    # Root layout with the auth provider
│   │   ├── api/copilotkit/[[...slug]]/   # CopilotKit runtime route (LangGraphHttpAgent → :8000)
│   │   └── components/
│   │       ├── fake-auth-provider.tsx    # Demo auth + <CopilotKit> provider
│   │       ├── user-menu.tsx             # Sign-in / switch-user menu
│   │       └── copilot-input.tsx         # Chat input with file upload
│   └── lib/                              # Demo users and token helpers
├── agent/                                # LangGraph Python agent
│   ├── main.py                           # FastAPI server (AG-UI endpoint + file routes)
│   ├── agent.py                          # Graph, auth node and tools
│   ├── file_routes.py                    # PDF, Excel and CSV processing endpoints
│   └── pyproject.toml                    # Agent dependencies (managed by uv)
├── public/                               # Static assets
├── next.config.ts
├── tsconfig.json
└── package.json
```

## How it works

- **Authentication:** the frontend passes the signed-in user's token to CopilotKit through the `properties` prop. CopilotKit forwards it to the agent as AG-UI `forwardedProps`, and `CustomLangGraphAGUIAgent` in `agent/agent.py` merges it into `config.configurable`. The graph's `auth_node` decodes the token and stores the user in state.
- **Identity-gated tools:** `chat_node` binds the backend tools (`get_weather`, `list_uploaded_files`, `get_file_content`) only for authenticated users. Anonymous users get the frontend tools only.
- **File uploads:** click **+** in the chat input to upload PDF, Excel, or CSV files. `agent/file_routes.py` extracts their content per conversation thread, and the agent reads it through its file tools.
- **Frontend:** `src/app/page.tsx` uses the CopilotKit v2 hooks `useAgent` (shared proverbs state), `useFrontendTool` (`setThemeColor`, `addProverb`), and `useRenderTool` (renders `get_weather` as a weather card).

The demo token is not signed. To use real auth, replace `fake-auth-provider.tsx` with your auth system (NextAuth.js, Auth0, Clerk, Supabase, etc.) and verify the token signature in `agent/agent.py`.

## 📚 Documentation

The main UI component is in `src/app/page.tsx`. You can:

- Modify the theme colors and styling
- Add new frontend tools and tool renderers
- Customize the CopilotKit sidebar appearance

Otherwise, check out the documentation relevant to your task:

- [LangGraph Documentation](https://langchain-ai.github.io/langgraph/) - Learn more about LangGraph and its features
- [CopilotKit Documentation](https://docs.copilotkit.ai) - Explore CopilotKit's capabilities
- [Next.js Documentation](https://nextjs.org/docs) - Learn about Next.js features and API
- [FastAPI Documentation](https://fastapi.tiangolo.com/) - Learn about the FastAPI server

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

### Authentication

If the agent says you're not signed in, pick a user from the menu in the top-left corner and send the message again.

### Python Dependencies

If you encounter Python import errors:

```bash
cd agent
uv sync
```
