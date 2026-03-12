# CopilotKit + Microsoft Agent Framework — Kanban Demo

A Next.js + C# starter demonstrating **AG-UI protocol** integration between [CopilotKit](https://copilotkit.ai) (frontend) and [Microsoft Agent Framework](https://github.com/microsoft/agents) (backend).

https://github.com/user-attachments/assets/531c6a3b-e7ea-476a-8cbd-6c30f7245c4e

## What It Does

- **Multi-Board Kanban System** — Create and manage multiple project boards
- **4-Column Task Flow** — Tasks progress through New → In Progress → Review → Completed
- **Rich Task Cards** — Title, subtitle, description, and customizable tags
- **Natural Language Interface** — Create and manage tasks through conversational AI
- **Real-time State Sync** — Shared state between C# backend and TypeScript frontend via AG-UI

## Prerequisites

- **.NET 9.0 SDK** — [Install](https://dotnet.microsoft.com/download/dotnet/9.0) or `brew install dotnet@9`
- **Node.js 20+**
- **OpenAI API Key** — For GPT-4o-mini
- **pnpm** (recommended), npm, yarn, or bun

## Quick Start

```bash
# 1. Install dependencies
pnpm install

# 2. Set OpenAI API key
cd agent && dotnet user-secrets set OpenAIKey "sk-..." && cd ..

# 3. Start both servers (UI on :3000, agent on :8000)
pnpm dev
```

## Scripts

| Command | Description |
|---------|-------------|
| `pnpm dev` | Start UI + agent servers |
| `pnpm dev:ui` | Start only Next.js UI |
| `pnpm dev:agent` | Start only C# agent |
| `pnpm build` | Build for production |
| `pnpm lint` | Run ESLint |

## Project Structure

```
├── agent/                      # C# Backend (Microsoft Agent Framework)
│   ├── Program.cs              # Agent with 11 Kanban tools
│   ├── SharedStateAgent.cs     # AG-UI state synchronization wrapper
│   ├── Services/KanbanService.cs  # Board/task operations
│   └── Models/                 # AgentState, Board, KanbanTask types
│
├── src/
│   ├── app/
│   │   ├── page.tsx            # Main Kanban UI with useCoAgent hook
│   │   ├── layout.tsx          # CopilotKit provider
│   │   └── api/copilotkit/     # AG-UI integration endpoint
│   │
│   ├── components/kanban/      # KanbanBoard, BoardTabs, TaskCard
│   └── lib/kanban/             # Types and initial state
```

## Backend Tools

The C# agent provides 11 tools for Kanban management:

**State**: `get_state`
**Boards**: `create_board`, `delete_board`, `rename_board`, `switch_board`
**Tasks**: `create_task`, `update_task_field`, `add_task_tag`, `remove_task_tag`, `move_task_to_status`, `delete_task`

## Example Commands

```
"Create a board called Sprint Planning"
"Add a task: Implement user authentication"
"Move the auth task to in progress"
"Add urgent tag to the login bug"
"Show me all tasks in review"
```

## Architecture

- **Frontend**: Next.js 15 + React 19 + CopilotKit
- **Backend**: .NET 9 + Microsoft Agent Framework + OpenAI
- **Protocol**: AG-UI for state synchronization
- **Pattern**: Frontend is source of truth; backend hydrates state from `ag_ui_state` on each request

## Troubleshooting

**Agent won't connect**: Verify agent running on port 8000 (`curl http://localhost:8000/`)

**OpenAIKey not found**:
```bash
cd agent && dotnet user-secrets set OpenAIKey "sk-..."
```

**Port conflict**: Update port in `agent/Properties/launchSettings.json` and `src/app/api/copilotkit/route.ts`

## Documentation

- [Microsoft Agent Framework](https://github.com/microsoft/agents)
- [AG-UI Protocol](https://docs.ag-ui.com)
- [CopilotKit Docs](https://docs.copilotkit.ai)

## License

MIT

---

Built by Mark Morgan
