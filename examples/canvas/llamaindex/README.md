# CopilotKit <> LlamaIndex AG-UI Canvas Starter

This is a starter template for building AI-powered canvas applications using [LlamaIndex](https://llamaindex.com) and [CopilotKit](https://copilotkit.ai). It provides a modern Next.js application with an integrated LlamaIndex agent that manages a visual canvas of interactive cards with real-time AI synchronization.

https://github.com/user-attachments/assets/2a4ec718-b83b-4968-9cbe-7c1fe082e958

## 🚀 Key Features

- **Visual Canvas Interface**: Drag-free canvas displaying cards in a responsive grid layout
- **Four Card Types**: 
  - **Project**: Includes text fields, dropdown, date picker, and checklist
  - **Entity**: Features text fields, dropdown, and multi-select tags
  - **Note**: Simple rich text content area
  - **Chart**: Visual metrics with percentage-based bar charts
- **Real-time AI Sync**: Bidirectional synchronization between the AI agent and UI canvas
- **Multi-step Planning**: AI can create and execute plans with visual progress tracking
- **Human-in-the-Loop (HITL)**: Intelligent interrupts for clarification when needed
- **JSON View**: Toggle between visual canvas and raw JSON state
- **Responsive Design**: Optimized for both desktop (sidebar chat) and mobile (popup chat)

## Prerequisites

- Node.js 18+ 
- Python 3.8+
- OpenAI API Key (for the LlamaIndex agent)
- [uv](https://docs.astral.sh/uv/getting-started/installation/)
- Any of the following package managers:
  - [pnpm](https://pnpm.io/installation) (recommended)
  - npm
  - [yarn](https://classic.yarnpkg.com/lang/en/docs/install/#mac-stable)
  - [bun](https://bun.sh/)

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

2. Install Python dependencies for the LlamaIndex agent (requires uv).
   If you don't have uv installed, install it first using one of the following:
   - macOS (Homebrew): `brew install uv`
   - macOS/Linux (official installer): `curl -LsSf https://astral.sh/uv/install.sh | sh`
   - Or with pipx: `pipx install uv`
```bash
# Using pnpm
pnpm install:agent

# Using npm
npm run install:agent

# Using yarn
yarn install:agent

# Using bun
bun run install:agent
```

> **Note:** This will automatically setup a `.venv` (virtual environment) inside the `agent` directory.  
>
> To activate the virtual environment manually, you can run:
> ```bash
> source agent/.venv/bin/activate
> ```

3. Set up your OpenAI API key:
```bash
export OPENAI_API_KEY="your-openai-api-key-here"
```

4. Start the development server:
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

This will start both the UI and agent servers concurrently.

## Getting Started with the Canvas

Once the application is running, you can:

1. **Create Cards**: Use the "New Item" button or ask the AI to create cards
   - "Create a new project"
   - "Add an entity and a note"
   - "Create a chart with sample metrics"

2. **Edit Cards**: Click on any field to edit directly, or ask the AI
   - "Set the project field1 to 'Q1 Planning'"
   - "Add a checklist item 'Review budget'"
   - "Update the chart metrics"

3. **Execute Plans**: Give the AI multi-step instructions
   - "Create 3 projects with different priorities and add 2 checklist items to each"
   - The AI will create a plan and execute it step by step with visual progress

4. **View JSON**: Toggle between the visual canvas and JSON view using the button at the bottom

## Available Scripts
The following scripts can also be run using your preferred package manager:
- `dev` - Starts both UI and agent servers in development mode
- `dev:debug` - Starts development servers with debug logging enabled
- `dev:ui` - Starts only the Next.js UI server
- `dev:agent` - Starts only the LlamaIndex agent server
- `install:agent` - Installs Python dependencies for the agent
- `build` - Builds the Next.js application for production
- `start` - Starts the production server
- `lint` - Runs ESLint for code linting

## Architecture Overview

```mermaid
graph TB
    subgraph "Frontend (Next.js)"
        UI[Canvas UI<br/>page.tsx]
        Actions[Frontend Actions<br/>useCopilotAction]
        State[State Management<br/>useCoAgent]
        Chat[CopilotChat]
    end
    
    subgraph "Backend (Python)"
        Agent[LlamaIndex Agent<br/>agent.py]
        Tools[Backend Tools<br/>- set_plan<br/>- update_plan_progress<br/>- complete_plan]
        AgentState[Workflow Context<br/>State Management]
        Model[LLM<br/>GPT-4o]
    end
    
    subgraph "Communication"
        Runtime[CopilotKit Runtime<br/>:9000]
    end
    
    UI <--> State
    State <--> Runtime
    Chat <--> Runtime
    Actions --> Runtime
    Runtime <--> Agent
    Agent --> Tools
    Agent --> AgentState
    Agent --> Model
    
    style UI fill:#e1f5fe
    style Agent fill:#fff3e0
    style Runtime fill:#f3e5f5
    
    click UI "https://github.com/CopilotKit/CopilotKit/blob/main/examples/canvas/llamaindex/src/app/page.tsx"
    click Agent "https://github.com/CopilotKit/CopilotKit/blob/main/examples/canvas/llamaindex/agent/agent/agent.py"
```

### Frontend (Next.js + CopilotKit)
The main UI component is in [`src/app/page.tsx`](https://github.com/CopilotKit/CopilotKit/blob/main/examples/canvas/llamaindex/src/app/page.tsx). It includes:
- **Canvas Management**: Visual grid of cards with create, read, update, and delete operations
- **State Synchronization**: Uses `useCoAgent` hook for real-time state sync with the agent
- **Frontend Actions**: Exposed as tools to the AI agent via `useCopilotAction`
- **Plan Visualization**: Shows multi-step plan execution with progress indicators
- **HITL (Tool-based)**: Uses `useCopilotAction` with `renderAndWaitForResponse` for disambiguation prompts (e.g., choosing an item or card type)

### Backend (LlamaIndex Agent)
The agent logic is in [`agent/agent/agent.py`](https://github.com/CopilotKit/CopilotKit/blob/main/examples/canvas/llamaindex/agent/agent/agent.py). It features:
- **Workflow Context**: Uses LlamaIndex's Context for state management and event streaming
- **Tool Integration**: Backend tools for planning, frontend tools integration via CopilotKit
- **Strict Grounding**: Enforces data consistency by always using shared state as truth
- **Loop Control**: Prevents infinite loops and redundant operations
- **Planning System**: Can create and execute multi-step plans with status tracking
- **FastAPI Router**: Uses `get_ag_ui_workflow_router` for seamless integration

### Card Field Schema
Each card type has specific fields defined in the agent:
- **Project**: field1 (text), field2 (select), field3 (date), field4 (checklist)
- **Entity**: field1 (text), field2 (select), field3 (tags), field3_options (available tags)
- **Note**: field1 (textarea content)
- **Chart**: field1 (array of metrics with label and value 0-100)

### Data Flow

```mermaid
sequenceDiagram
    participant User
    participant UI as Canvas UI
    participant CK as CopilotKit
    participant Agent as LlamaIndex Agent
    participant Tools
    
    User->>UI: Interact with canvas
    UI->>CK: Update state via useCoAgent
    CK->>Agent: Send state + message
    Agent->>Agent: Process with GPT-4o
    Agent->>Tools: Execute tools
    Tools-->>Agent: Return results
    Agent->>CK: Return updated state
    CK->>UI: Sync state changes
    UI->>User: Display updates
    
    Note over Agent: Maintains ground truth
    Note over UI,CK: Real-time bidirectional sync
```

## Customization Guide

### Adding New Card Types
1. Define the data schema in [`src/lib/canvas/types.ts`](https://github.com/CopilotKit/CopilotKit/blob/main/examples/canvas/llamaindex/src/lib/canvas/types.ts)
2. Add the card type to the `CardType` union
3. Create rendering logic in [`src/components/canvas/CardRenderer.tsx`](https://github.com/CopilotKit/CopilotKit/blob/main/examples/canvas/llamaindex/src/components/canvas/CardRenderer.tsx)
4. Update the agent's field schema in [`agent/agent/agent.py`](https://github.com/CopilotKit/CopilotKit/blob/main/examples/canvas/llamaindex/agent/agent/agent.py)
5. Add corresponding frontend actions in [`src/app/page.tsx`](https://github.com/CopilotKit/CopilotKit/blob/main/examples/canvas/llamaindex/src/app/page.tsx)

### Modifying Existing Cards
- Field definitions are in the agent's FIELD_SCHEMA constant
- UI components are in [`CardRenderer.tsx`](https://github.com/CopilotKit/CopilotKit/blob/main/examples/canvas/llamaindex/src/components/canvas/CardRenderer.tsx)
- Frontend actions follow the pattern: `set[Type]Field[Number]`

### Styling
- Global styles: [`src/app/globals.css`](https://github.com/CopilotKit/CopilotKit/blob/main/examples/canvas/llamaindex/src/app/globals.css)
- Component styles use Tailwind CSS with shadcn/ui components
- Theme colors can be modified via CSS custom properties

## 📚 Documentation

- [LlamaIndex Documentation](https://docs.llamaindex.com/introduction) - Learn more about LlamaIndex and its features
- [CopilotKit Documentation](https://docs.copilotkit.ai) - Explore CopilotKit's capabilities
- [Next.js Documentation](https://nextjs.org/docs) - Learn about Next.js features and API

## Contributing

Feel free to submit issues and enhancement requests! This starter is designed to be easily extensible.

## License

This project is licensed under the MIT License - see the LICENSE file for details.

## Troubleshooting

### Agent Connection Issues
If you see "I'm having trouble connecting to my tools", make sure:
1. The LlamaIndex agent is running on port 9000 (check terminal output)
2. Your OpenAI API key is set correctly as an environment variable
3. Both servers started successfully (UI and agent)

### Port Already in Use
If you see "[Errno 48] Address already in use":
1. The agent might still be running from a previous session
2. Kill the process using the port: `lsof -ti:9000 | xargs kill -9`
3. For the UI port: `lsof -ti:3000 | xargs kill -9`

### State Synchronization Issues
If the canvas and AI seem out of sync:
1. Check the browser console for errors
2. Ensure all frontend actions are properly registered
3. Verify the agent is using the latest shared state (not cached values)

### Python Dependencies
If you encounter Python import errors:
```bash
cd agent
uv sync
```

### Dependency Conflicts
If issues persist, recreate the virtual environment:
```bash
cd agent
rm -rf .venv
uv venv
uv sync
```
---

> [!IMPORTANT]
> Some features are still under active development and may not yet work as expected. If you encounter a problem using this template, please [report an issue](https://github.com/CopilotKit/CopilotKit/issues) to this repository.
