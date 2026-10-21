# CopilotKit <> LangGraph Auth & File Upload Example

This is an example of building an authenticated AI agent using [LangGraph](https://www.langchain.com/langgraph) and [CopilotKit](https://copilotkit.ai). It provides a Next.js application with a LangGraph agent served by FastAPI, and shows how to pass the signed-in user to the agent, gate tools by user identity, and let the agent answer questions about uploaded files.

Features include:

- 🔐 Authenticate users before agent interaction
- 🛡️ Secure agent tools based on user identity
- 👤 Access user information within LangGraph agents
- 🎯 Conditionally enable/disable agent capabilities
- 📁 Upload and process files (PDF, Excel, CSV) with the agent

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

To use another model or an OpenAI-compatible API (a proxy, gateway or local server), also set:

```bash
OPENAI_MODEL=gpt-4o
OPENAI_BASE_URL=https://your-openai-compatible-api.example.com/v1
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

This will start both the UI (http://localhost:3000) and agent (http://localhost:8000) servers concurrently.

4. Pick a user from the menu in the top-left corner to sign in, then chat with the agent. Signed-in users get the backend tools (weather, file handling); anonymous users only get the frontend tools.

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

## Documentation

The main UI component is in `src/app/page.tsx`. You can:

- Modify the theme colors and styling
- Add new frontend tools (`useFrontendTool`) and tool renderers (`useRenderTool`)
- Customize the CopilotKit sidebar appearance

### Project Structure

- **Frontend** (`src/app/`)
  - `page.tsx` - Main UI with the authenticated agent (CopilotKit v2 hooks: `useAgent`, `useFrontendTool`, `useRenderTool`)
  - `components/fake-auth-provider.tsx` - Auth provider and `<CopilotKit>` setup (replace with real auth)
  - `components/copilot-input.tsx` - Chat input with file upload (wraps the v2 `CopilotChatInput`)
  - `components/user-menu.tsx` - Login/logout menu
  - `api/copilotkit/[[...slug]]/route.ts` - CopilotKit v2 runtime endpoint forwarding to the agent
- **Agent** (`agent/`)
  - `agent.py` - LangGraph agent with auth-aware tools
  - `main.py` - FastAPI server exposing the agent over AG-UI
  - `file_routes.py` - File upload and processing endpoints

### Authentication Flow

1. The user signs in via the frontend auth provider
2. The user token is passed to CopilotKit via the `properties` prop
3. CopilotKit forwards it to the agent as AG-UI `forwardedProps`
4. `CustomLangGraphAGUIAgent` (`agent/agent.py`) merges it into `config.configurable`
5. The agent reads the user identity and enables tools accordingly

To use your own auth, replace `fake-auth-provider.tsx` with your auth system (NextAuth.js, Auth0, Clerk, Supabase, etc.) and verify the token signature in `agent/agent.py`. The demo token is not signed.

### File Upload Support

Click **+** in the chat input to upload files. They are processed and stored per conversation thread, so the agent can answer questions about them:

- **PDF Files** - Text extraction with page-by-page content
- **Excel Files** (.xlsx, .xls) - Sheet parsing, column analysis, and data preview
- **CSV Files** (.csv) - Data parsing, column analysis, and data preview

File processing endpoints:

- `POST /process-file` - Upload and process a PDF, Excel, or CSV file
- `GET /files/{thread_id}` - List all uploaded files for a thread
- `GET /file/{thread_id}/{file_id}` - Retrieve file content
- `DELETE /file/{thread_id}/{file_id}` - Remove an uploaded file

## 📚 Documentation

- [LangGraph Documentation](https://langchain-ai.github.io/langgraph/) - Learn more about LangGraph and its features
- [CopilotKit Documentation](https://docs.copilotkit.ai) - Explore CopilotKit's capabilities
- [Next.js Documentation](https://nextjs.org/docs) - Learn about Next.js features and API
- [FastAPI Documentation](https://fastapi.tiangolo.com/) - Learn about the FastAPI server

## Contributing

Feel free to submit issues and enhancement requests! This example is designed to be easily extensible.

## License

This project is licensed under the MIT License - see the LICENSE file for details.

## Troubleshooting

### Agent Connection Issues

If the agent doesn't respond, make sure:

1. The LangGraph agent is running on port 8000 (override with `AGENT_PORT`)
2. Your OpenAI API key is set correctly in `.env`
3. Both servers started successfully

### Authentication Issues

If the agent says you're not signed in, pick a user from the menu in the top-left corner and send the message again.

### Python Dependencies

If you encounter Python import errors:

```bash
cd agent
uv sync
```
