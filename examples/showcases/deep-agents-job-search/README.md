# Job Application Assistant

A Job assistant built with [CopilotKit](http://copilotkit.ai/) (Next.js) on the frontend and [DeepAgents](https://github.com/langchain-ai/deepagents) (by LangChain) on the backend. Users upload their resume (PDF), the system extracts skills and context and DeepAgents orchestrate sub-agents & tools to search the web (via Tavily) for relevant job postings. Results stream back to the UI in real time and are rendered alongside the chat. 

DeepAgents provides clean orchestration with sub-agents and tools, while CopilotKit (AG‑UI) handles real-time streaming and stateful UI updates. Refer to the [official integration docs](https://docs.copilotkit.ai/integrations/langgraph/deep-agents).

**What This Demo Shows:**

- Resume upload + PDF parsing
- Skill extraction from real resumes
- DeepAgents orchestration with sub-agents and tools
- Internet search via Tavily
- Tool calls streamed to the UI using AG-UI

Here is the high-level flow:

```
[User uploads resume & submits job query]
        ↓
Next.js UI (ResumeUpload + CopilotChat)
        ↓
useCopilotReadable syncs resume + preferences
        ↓
POST /api/copilotkit (AG-UI protocol)
        ↓
FastAPI + DeepAgents (/copilotkit endpoint)
        ↓
Resume context + skills injected into agent
        ↓
DeepAgents orchestration
   ├─ internet_search (Tavily)
   ├─ job filtering & normalization
   └─ update_jobs_list (tool call)
        ↓
AG-UI streaming (SSE)
        ↓
CopilotKit runtime receives tool result
        ↓
Frontend captures tool output
        ↓
Jobs rendered in table + chat stay clean
```

## Project Structure

```
.
├── src/                               ← Next.js frontend
│   ├── app/
│   │   ├── page.tsx                      
│   │   ├── layout.tsx                 ← CopilotKit provider
│   │   └── api/
│   │       ├── upload-resume/route.ts ← upload endpoint
│   │       └── copilotkit/route.ts    ← CopilotKit AG-UI runtime
│   ├── components/
│   │   ├── ChatPanel.tsx              ← Chat + tool capture
│   │   ├── ResumeUpload.tsx           ← PDF upload UI
│   │   ├── JobsResults.tsx            ← Jobs table renderer
│   │   └── LivePreviewPanel.tsx          
│   └── lib/
│       ├── jobsParser.ts              ← Normalization helpers
│       └── types.ts                   ← Shared frontend types
│
├── agent/                             ← DeepAgents backend
│   ├── main.py                        ← FastAPI + AG-UI endpoint
│   ├── agent.py                       ← DeepAgents graph & tools
│   ├── pyproject.toml                 ← Python deps (uv)
│   └── uv.lock
│
├── package.json
├── next.config.ts
└── README.md

```

## Environment Variables

You will need an [OpenAI API Key](https://platform.openai.com/settings/organization/api-keys) and [Tavily API Key](https://app.tavily.com/home).

Create the `agent/.env` and set your keys:

```dotenv
OPENAI_API_KEY=sk-proj-...
TAVILY_API_KEY=tvly-dev-...
OPENAI_MODEL=gpt-4-turbo
```

## Setup & Installation

### 1. Installation

Frontend (Next.js):

```bash
npm install
# or
yarn install
```

Backend (Python, uv)

```bash
cd agent
uv add
uv sync
```

The backend uses [uv](https://github.com/astral-sh/uv) for dependency management. Install it if it's not already in your system: `pip install uv`.

### 2. Running locally

Start the backend:

```bash
cd agent
uv run python main.py
```

Backend runs on `http://localhost:8123`.

Start the frontend (in a new terminal):

```bash
npm run dev
# or
yarn dev
```

Navigate to [http://localhost:3000](http://localhost:3000) in your browser.

## License

This project is licensed under the MIT License. See the [LICENSE](LICENSE) file for details.