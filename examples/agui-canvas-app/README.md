# AGUI Canvas App

This project is a multi-agent, multi-stack application featuring:
- A **Next.js React frontend** (with CopilotKit and AG-UI)
- A **Python FastAPI agent** (with CopilotKit, LangGraph, and CrewAI)
- A **TypeScript Mastra agent** (with CopilotKit and Mastra)

## Project Structure

```
├── agent/                # Python FastAPI agent
├── agent-ts/mastra/mastra-agent/  # TypeScript Mastra agent
├── frontend/             # Next.js React frontend
```

---

## 1. Python Agent (`agent/`)

A FastAPI-based agent using CopilotKit, LangGraph, and CrewAI.

### Setup & Run
```bash
cd agent
poetry install
poetry run python main.py
```

---

## 2. TypeScript Mastra Agent (`agent-ts/mastra/mastra-agent/`)

A TypeScript agent using CopilotKit and Mastra.

### Setup & Run
```bash
cd agent-ts/mastra/mastra-agent
npx ts-node src/aguiMastra.ts
```

---

## 3. Frontend (`frontend/`)

A Next.js React app using CopilotKit and AG-UI.

### Setup & Run
```bash
cd frontend
pnpm install
pnpm dev
```

The frontend will be available at [http://localhost:3000](http://localhost:3000).

---

## Environment Variables

Each major directory requires a `.env` file for configuration. These files are used to store sensitive information such as API keys, secrets, and environment-specific settings. Be sure to create a `.env` file in each of the following directories:

- `agent/`
- `agent-ts/mastra/mastra-agent/`
- `frontend/`

Typical values to include are API keys (e.g., OpenAI), database URLs, and other secrets required for local development. Refer to each component's documentation or code for the exact variables needed.

### .env file example
```bash
OPENAI_API_KEY = "Your OPENAI API KEY"
```

**Note:** Never commit your `.env` files to version control.

---

## Notes
- Ensure you have **Poetry** (for Python) and **pnpm** (for Node.js/TypeScript) installed.
- Node.js >= 20.9.0 is required for the TypeScript agent.
- Python >= 3.12 is required for the Python agent.
- Configure environment variables as needed for API keys (OpenAI, etc).

---

## License
MIT
