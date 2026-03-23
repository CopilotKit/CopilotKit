# A2UI Playground

https://github.com/user-attachments/assets/79ead351-f63c-4119-9d28-9d604e7f8876

A **CopilotKit + A2UI** demo: the Python A2A agent emits declarative A2UI JSON, and the Next.js app renders it with `A2UIRenderer`.

## Overview

| Piece        | Role                                                                 |
| ------------ | -------------------------------------------------------------------- |
| **Next.js**  | `CopilotKitProvider`, chat UI, A2UI theme, `/api/copilotkit-a2ui`    |
| **a2a-agent** | LangGraph + ChatOpenAI → A2UI JSON over the A2A protocol          |

## CopilotKit Features Used

- **CopilotKitProvider** — wired in `A2UIPage.tsx` to `/api/copilotkit-a2ui`
- **CopilotSidebar** / **CopilotPopup** — chat shell
- **A2UIRenderer** — renders A2UI declarative JSON from agent activity messages
- **A2AAgent** (`@ag-ui/a2a`) — talks to the Python A2A server

## Setup

### Prerequisites

- Node.js 18+
- Python 3.11+
- LLM keys for **a2a-agent**: DashScope (`DASHSCOPE_API_KEY`) and/or `OPENAI_API_KEY` (see `a2a-agent/CLAUDE.md`)

### Installation

This folder includes **`.npmrc`** with `legacy-peer-deps=true` so plain `npm install` succeeds when peer ranges conflict.

```bash
cd examples/showcases/generative-ui-playground
npm install

cd a2a-agent
pip install -e .
cd ..
```

### Environment Variables

Copy the template if present and set:

```bash
A2A_AGENT_URL=http://localhost:10002
```

LLM keys belong in **`a2a-agent`** (or your process env), e.g.:

```bash
DASHSCOPE_API_KEY=sk-...
# or
OPENAI_API_KEY=sk-...
# Optional: QWEN_LITELLM_MODEL=dashscope/qwen-plus, LITELLM_MODEL=openai/gpt-5.2
```

### Running

```bash
# Terminal 1: Python A2A agent (port 10002)
cd a2a-agent && python -m agent

# Terminal 2: Next.js (port 3000)
npm run dev
```

Open http://localhost:3000.

## Try in Chat

- Example pills on the page (restaurant / booking style prompts)
- **Widget Builder** (header link) — https://a2ui-composer.ag-ui.com/

## Architecture

```
Next.js (A2UIPage + A2UIRenderer)
        │
        ▼
/api/copilotkit-a2ui  →  A2AAgent  →  Python a2a-agent :10002
```

## Project Structure

```
generative-ui-playground/
├── src/app/
│   ├── page.tsx
│   ├── theme.ts
│   ├── api/copilotkit-a2ui/
│   └── components/
└── a2a-agent/
```

## Learn More

- [CopilotKit Documentation](https://docs.copilotkit.ai)
- [Generative UI](https://www.copilotkit.ai/generative-ui)
- [A2UI Specification](https://a2ui.org)
