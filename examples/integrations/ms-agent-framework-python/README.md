# CopilotKit <> Microsoft Agent Framework (Python)

This is a starter template for building CopilotKit experiences using the [Microsoft Agent Framework](https://aka.ms/agent-framework). It ships with a Next.js UI and a FastAPI server that exposes a Microsoft Agent Framework agent over the AG-UI protocol, so you can study and customize both sides of the stack.

## Prerequisites

- OpenAI or Azure OpenAI credentials (for the Microsoft Agent Framework agent)
- Python 3.12+
- uv
- Node.js 20+ 
- Any of the following package managers:
  - pnpm (recommended)
  - npm
  - yarn
  - bun

> **Note:** This repository ignores lock files (package-lock.json, yarn.lock, pnpm-lock.yaml, bun.lockb) to avoid conflicts between different package managers. Each developer should generate their own lock file using their preferred package manager. After that, make sure to delete it from the .gitignore.

## Getting Started

1. Install dependencies using your preferred package manager:

   ```bash
   # Using pnpm (recommended)
   pnpm install

   # Using npm
   npm install

   # Using yarn
   yarn install

   # Using bun
   bun install
   ```

   > **Note:** This automatically sets up the Python environment as well.
   >
   > If you have manual issues, you can run:
   >
   > ```sh
   > npm run install:agent
   > ```

2. Set up your agent credentials. The backend automatically uses Azure when the Azure env vars below are present; otherwise it falls back to OpenAI. Create a `.env` file inside the `agent` folder with one of the following configurations:

   **OpenAI**
   ```
   OPENAI_API_KEY=sk-...your-openai-key-here...
   OPENAI_CHAT_MODEL_ID=gpt-4o-mini
   ```

   **Azure OpenAI**
   ```
   AZURE_OPENAI_ENDPOINT=https://your-resource.openai.azure.com/
   AZURE_OPENAI_CHAT_DEPLOYMENT_NAME=gpt-4o-mini
   # If you are not relying on az login:
   # AZURE_OPENAI_API_KEY=...
   ```

3. Start the development server:

   ```bash
   # Using pnpm
   pnpm dev

   # Using npm
   npm run dev

   # Using yarn
   yarn dev

   # Using bun
   bun run dev
   ```

   This will start both the UI and the Microsoft Agent Framework server concurrently.

## Available Scripts

The following scripts can also be run using your preferred package manager:

- `dev` – Starts both UI and agent servers in development mode
- `dev:debug` – Starts development servers with debug logging enabled
- `dev:ui` – Starts only the Next.js UI server
- `dev:agent` – Starts only the Microsoft Agent Framework server
- `build` – Builds the Next.js application for production
- `start` – Starts the production server
- `lint` – Runs ESLint for code linting
- `install:agent` – Installs Python dependencies for the agent

## Documentation

The main UI component is in `src/app/page.tsx`. You can:

- Modify the theme colors and styling
- Add new frontend actions
- Customize the CopilotKit sidebar appearance

## 📚 Documentation

- [Microsoft Agent Framework](https://aka.ms/agent-framework) – Learn more about Microsoft Agent Framework and its features
- [CopilotKit Documentation](https://docs.copilotkit.ai) – Explore CopilotKit’s capabilities
- [Next.js Documentation](https://nextjs.org/docs) – Learn about Next.js features and API

## Contributing

Feel free to submit issues and enhancement requests! This starter is designed to be easily extensible.

## License

This project is licensed under the MIT License – see the LICENSE file for details.

## Troubleshooting

### Agent Connection Issues

If you see "I'm having trouble connecting to my tools", make sure:

1. The Microsoft Agent Framework agent is running on port 8000
2. Your OpenAI/Azure credentials are set correctly
3. Both servers started successfully

### Python Dependencies

If you encounter Python import errors:

```bash
cd agent
uv sync
uv run src/main.py
```
