# File Investigator

AI-powered document analysis demo built with [CopilotKit](https://copilotkit.ai), [Strands Agents](https://strandsagents.com), and Amazon Bedrock.

## About This Project

**What This Is:**
- Educational demo showing how to integrate CopilotKit with Python agents
- Reference for building TypeScript frontends with Python backends
- Example of real-time state synchronization between frontend and agent

**What This Is NOT:**
- Production-ready document processing service
- Secure analysis tool for sensitive documents
- Replacement for professional legal/compliance review

**Use this to:**
- Learn CopilotKit + Strands integration patterns
- See how to sync state between React and Python
- Understand multi-file document processing with AWS Bedrock

---

## Quick Start

### Prerequisites
- Node.js 20+
- Python 3.12+
- AWS credentials with Bedrock access

### 1. Install dependencies

```bash
npm install
cd agent && uv sync && cd ..
```

### 2. Configure AWS credentials

Create `agent/.env`:

```bash
AWS_ACCESS_KEY_ID=your-access-key
AWS_SECRET_ACCESS_KEY=your-secret-key
AWS_REGION=us-west-1
```

### 3. Start development servers

```bash
npm run dev
```

This starts:
- **Frontend**: http://localhost:3000
- **Agent**: http://localhost:8000

---

## Key Features

**Multi-File PDF Support:**
- Upload up to 10 PDFs (150MB each)
- Files ≤4.5MB sent as native PDFs to preserve formatting
- Files >4.5MB automatically use text extraction
- Combined analysis across all documents

**Real-Time UI Updates:**
- Dashboard panels update as agent processes documents
- Key findings, redacted content speculation, tweet generation
- Executive summary with markdown formatting

**Conversational Interface:**
- Chat with the agent about uploaded documents
- Tool calls render as custom UI components in the chat

---

## How CopilotKit Powers This App

### `useCoAgent` - State Synchronization

Keeps frontend and Python agent in sync automatically:

```typescript
const { state, setState } = useCoAgent({
  name: "file_investigator",
  initialState: INITIAL_STATE
});
```

When you upload files on the frontend, they're instantly available to the Python agent. When the agent updates findings, the UI updates immediately.

**Why this matters:** No manual API calls or state management - CopilotKit handles the bidirectional sync via AG-UI Protocol.

### `CopilotChat` - Conversational UI

Provides the chat interface with built-in tool call rendering:

```typescript
<CopilotChat
  labels={{
    title: "File Investigator",
    initial: "Upload a PDF to begin..."
  }}
/>
```

**Why this matters:** You get a production-quality chat UI out of the box, with streaming responses and tool call visualization.

### `useDefaultTool` - Custom Tool UI

Renders custom components when the agent calls tools:

```typescript
const defaultTools = [
  useDefaultTool({
    toolKey: "update_findings",
    Component: () => <FindingsCard findings={state.findings} />
  })
];
```

**Why this matters:** Instead of generic JSON displays, you control exactly how tool outputs appear in the chat.

---

## How Strands Agents Work Here

### What is Strands?

[Strands](https://strandsagents.com) is a Python framework for building AI agents. It handles the tool-calling loop, state management, and LLM integration.

### What is ag_ui_strands?

[ag_ui_strands](https://pypi.org/project/ag-ui-strands/) bridges Strands with CopilotKit. It:
- Wraps your Strands agent with FastAPI endpoints
- Emits state updates when tools are called
- Handles the AG-UI Protocol communication

### Basic Agent Setup

```python
from strands import Agent
from ag_ui_strands import StrandsAgent

# Create your Strands agent
strands_agent = Agent(
    system="You are the File Investigator...",
    model="anthropic/claude-haiku-4-5-20251001"
)

# Add tools
strands_agent.add_tool(update_findings)
strands_agent.add_tool(update_summary)

# Wrap with ag_ui_strands
app = StrandsAgent(
    agent=strands_agent,
    name="file_investigator",
    description="AI document analyst"
).mount(FastAPI())
```

**Why this matters:** You write standard Strands tools in Python, and ag_ui_strands automatically makes them work with CopilotKit's frontend.

### Tools Update the UI

When you attach a `state_from_args` callback to a tool, the frontend UI updates automatically:

```python
def update_findings(findings: dict, context) -> str:
    """Agent calls this to update findings panel."""
    return "Updated findings"

# This callback syncs state to frontend
update_findings.state_from_args = lambda args, context: {
    **get_current_state(context),
    "findings": args.get("findings", [])
}
```

**Why this matters:** One tool call updates both the agent's logic and the user's UI - no separate API calls needed.

---

## Multi-File PDF Strategy

### The Challenge

AWS Bedrock has limits:
- 4.5MB per document
- 5 documents per message

But users want to upload large files and multiple files together.

### The Solution

Intelligent processing based on file size:

1. **Small files (≤4.5MB)**: Sent as native PDFs → preserves formatting and images
2. **Large files (>4.5MB)**: Text extracted via pypdf → enables large file support
3. **Beyond 5 files**: Additional files use text extraction → respects Bedrock limit

The agent sees all files and analyzes them together, regardless of how they were processed.

---

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                     Next.js Frontend                         │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────────────┐  │
│  │ File Upload │  │  Dashboard  │  │   CopilotKit Chat   │  │
│  │  (multi)    │  │   Panels    │  │                     │  │
│  └─────────────┘  └─────────────┘  └─────────────────────┘  │
│                           │                                  │
│                    useCoAgent (state sync)                   │
└───────────────────────────┬─────────────────────────────────┘
                            │ AG-UI Protocol (HTTP + SSE)
┌───────────────────────────┴─────────────────────────────────┐
│                     Python Agent                             │
│                                                              │
│              Strands + ag_ui_strands + FastAPI               │
│                           │                                  │
│         Tools: update_findings, update_redacted,             │
│                update_tweets, update_summary                 │
│                           │                                  │
│                    Amazon Bedrock                            │
│               (Claude Haiku)                                 │
└─────────────────────────────────────────────────────────────┘
```

### Data Flow

1. User uploads PDFs → Frontend state updates via `useCoAgent`
2. State syncs to Python agent automatically
3. User sends chat message → "Analyze these documents"
4. Agent reads PDFs from state, calls Bedrock
5. Agent calls tools → `update_findings`, `update_tweets`, etc.
6. Tool callbacks emit state updates
7. Frontend receives updates → Dashboard panels re-render

---

## Project Structure

```
├── src/
│   ├── app/
│   │   ├── page.tsx                 # Main page with useCoAgent + CopilotChat
│   │   ├── layout.tsx               # CopilotKit provider
│   │   └── api/copilotkit/route.ts  # Runtime configuration
│   ├── components/
│   │   ├── dashboard-panels.tsx     # Dashboard UI components
│   │   ├── file-upload.tsx          # Multi-file upload
│   │   └── tool-cards.tsx           # Tool UI renderers
│   └── types/
│       └── investigator.ts          # TypeScript interfaces
├── agent/
│   ├── main.py                      # Strands agent + ag_ui_strands
│   ├── pdf_utils.py                 # PDF text extraction
│   └── pyproject.toml               # Python dependencies
└── package.json
```

---

## Environment Variables

### Agent (`agent/.env`)

| Variable | Description |
|----------|-------------|
| `AWS_ACCESS_KEY_ID` | AWS access key for Bedrock |
| `AWS_SECRET_ACCESS_KEY` | AWS secret key |
| `AWS_REGION` | AWS region (default: `us-west-1`) |

### Frontend (optional)

| Variable | Description |
|----------|-------------|
| `AGENT_URL` | Agent URL (default: `http://localhost:8000`) |

---

## Tech Stack

**Frontend:**
- Next.js 16
- React 19
- CopilotKit 1.10
- Tailwind CSS 4

**Backend:**
- Python 3.12
- Strands Agents 1.15+
- ag_ui_strands 0.1.0b12
- FastAPI + Uvicorn
- pypdf 4.0+
- Amazon Bedrock (Claude Haiku)

---

## Commands

| Command | Description |
|---------|-------------|
| `npm run dev` | Start both frontend and agent |
| `npm run dev:ui` | Start frontend only |
| `npm run dev:agent` | Start agent only |
| `npm run build` | Build for production |
| `npm run lint` | Run ESLint |

---

## Troubleshooting

**Agent not connecting:**
- Verify agent is running on port 8000
- Check AWS credentials in `agent/.env`
- Ensure Bedrock model access is enabled

**PDF not processing:**
- Large PDFs (>4.5MB) automatically use text extraction
- Check agent logs for errors
- Verify PDF is not corrupted or encrypted

**State not syncing:**
- Ensure both servers are running
- Check browser console for errors
- Verify agent name matches in both frontend and backend

---

## Learning Resources

**CopilotKit:**
- [CopilotKit Docs](https://docs.copilotkit.ai)
- [useCoAgent Hook](https://docs.copilotkit.ai/reference/hooks/useCoAgent)
- [AG-UI Protocol](https://docs.copilotkit.ai/coagents/ag-ui-protocol)

**Strands Agents:**
- [Strands Documentation](https://strandsagents.com)
- [ag_ui_strands Package](https://pypi.org/project/ag-ui-strands/)

**AWS Bedrock:**
- [Bedrock API Reference](https://docs.aws.amazon.com/bedrock/latest/APIReference/welcome.html)

---

## License

MIT

Built by Mark Morgan
